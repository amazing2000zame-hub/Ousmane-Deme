/**
 * Intent-based message router.
 *
 * Replaces the brittle keyword-matching needsTools() approach with a
 * multi-stage decision tree that evaluates message intent to determine
 * whether Claude (agentic + tools) or Qwen (conversational) should
 * handle the request.
 *
 * Routing priority (first match wins):
 *  1. Override passkey detected           → CLAUDE
 *  2. Explicit cluster action keywords    → CLAUDE
 *  3. References specific cluster entity  → CLAUDE
 *  4. Follow-up to a tool conversation    → CLAUDE
 *  5. Daily budget cap exceeded            → QWEN (cost fallback)
 *  6. Claude unavailable                  → QWEN (fallback)
 *  7. Default conversational              → QWEN
 */

import { claudeAvailable } from './claude.js';
import { checkDailyBudget } from './cost-tracker.js';

export interface RoutingDecision {
  provider: 'claude' | 'qwen';
  reason: string;
}

// ---- Stage 2: Explicit cluster action keywords ----
const ACTION_KEYWORDS = [
  'start', 'stop', 'restart', 'reboot', 'shutdown',
  'wake', 'wol',
  'execute', 'ssh',
  'update', 'upgrade',
  'migrate', 'backup', 'restore', 'snapshot',
  'restart service', 'systemctl',
];

// ---- Stage 3: Cluster entity references ----
const ENTITY_PATTERNS = [
  // Node names
  /\b(home|pve|agent1|agent)\b/i,
  // VM/container IDs
  /\bvm\s*\d+/i,
  /\bvmid\s*\d+/i,
  /\bct\s*\d+/i,
  /\b(100|101|103|300|301|302|303)\b/,
  // Named VMs/CTs
  /\b(ubuntu.?desktop|displayvm|management|twingate|adguard|homeassistant)\b/i,
  // Infrastructure concepts that need tools
  /\b(cluster|quorum|corosync|ceph|storage|lvm|zfs|nfs|samba)\b/i,
  /\b(node status|cluster status|node temp|temperature)\b/i,
  /\b(vm|vms|container|containers|lxc|qemu)\b/i,
  /\b(docker|portainer|nginx|guacamole)\b/i,
];

// ---- Stage 2 refinement: query keywords that pair with entities ----
const QUERY_KEYWORDS = [
  'status', 'check', 'show', 'list', 'get', 'fetch',
  'how is', 'how are', 'what is', 'what are',
  'monitor', 'health', 'uptime', 'load',
  'disk', 'cpu', 'memory', 'ram', 'temp',
  'backup', 'backups', 'task', 'tasks',
  'resource', 'resources',
];

/**
 * Route a user message to the appropriate LLM provider.
 *
 * @param message     - The user's raw message text
 * @param override    - Whether the override passkey was detected
 * @param lastProvider - The provider used for the previous message in this session (for follow-up detection)
 */
export function routeMessage(
  message: string,
  override: boolean,
  lastProvider?: string,
): RoutingDecision {
  const lower = message.toLowerCase();

  // Stage 1: Override passkey always routes to Claude (bypasses budget check)
  if (override) {
    return { provider: 'claude', reason: 'override passkey detected' };
  }

  // Compute intent-based routing decision
  const intentDecision = resolveIntent(lower, lastProvider);

  // If intent says Claude, apply budget and availability checks
  if (intentDecision) {
    // Stage 5: Budget cap enforcement
    try {
      const budget = checkDailyBudget();
      if (budget.exceeded) {
        console.log(`[Router] Budget exceeded: $${budget.spent.toFixed(4)}/$${budget.limit}`);
        return {
          provider: 'qwen',
          reason: `daily budget cap reached ($${budget.spent.toFixed(2)}/$${budget.limit})`,
        };
      }
    } catch {
      // If budget check fails, don't block routing
    }

    // Stage 6: Claude unavailable → Qwen fallback
    if (!claudeAvailable) {
      return { provider: 'qwen', reason: 'Claude API unavailable, using local fallback' };
    }

    return intentDecision;
  }

  // Stage 7: Default conversational → Qwen
  return { provider: 'qwen', reason: 'conversational message' };
}

/**
 * Resolve message intent to determine if Claude is needed.
 * Returns a RoutingDecision for Claude, or null if conversational.
 */
function resolveIntent(lower: string, lastProvider?: string): RoutingDecision | null {
  // Stage 2: Explicit action keywords → Claude
  for (const kw of ACTION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { provider: 'claude', reason: `explicit cluster action: "${kw}"` };
    }
  }

  // Stage 3: References specific cluster entities → Claude
  for (const pattern of ENTITY_PATTERNS) {
    if (pattern.test(lower)) {
      const match = lower.match(pattern)?.[0] ?? 'entity';
      return { provider: 'claude', reason: `references cluster entity: "${match}"` };
    }
  }

  // Stage 3b: Query keywords (status, check, show, etc.) → Claude
  for (const kw of QUERY_KEYWORDS) {
    if (lower.includes(kw)) {
      return { provider: 'claude', reason: `query keyword: "${kw}"` };
    }
  }

  // Stage 4: Follow-up to a tool conversation → Claude
  if (lastProvider === 'claude') {
    const followUpPatterns = [
      /^(yes|no|ok|okay|sure|do it|go ahead|proceed|confirm|deny|cancel)/i,
      /^(and |also |what about |how about |now |then )/i,
      /^(that|this|it|those|them)\b/i,
      /\?$/, // Questions are likely follow-ups
    ];
    for (const pattern of followUpPatterns) {
      if (pattern.test(lower.trim())) {
        return { provider: 'claude', reason: 'follow-up to tool conversation' };
      }
    }
  }

  return null;
}

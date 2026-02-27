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
import { openaiAvailable } from './providers/openai-provider.js';
import { checkDailyBudget } from './cost-tracker.js';

/** Whether any Claude-capable provider is available (direct API or Max proxy) */
const smartProviderAvailable = claudeAvailable || openaiAvailable;

export interface RoutingDecision {
  provider: 'claude' | 'openai' | 'qwen';
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
  // UI/dashboard actions
  'close', 'open', 'pull', 'read', 'find',
  // Phase 32: Web browsing and video
  'search', 'google', 'look up', 'browse',
  'youtube', 'play', 'watch', 'video',
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
  // Files and planning
  /\b(file|files|roadmap|plan|config|log|logs)\b/i,
  // Smart home / Camera / Presence (Phase 26-28)
  /\b(camera|cameras|snapshot|live\s*stream|frigate|nvr|detection|detections)\b/i,
  /\b(driveway|front.?door|side.?house|doorbell|yard)\b/i,
  /\b(car|cars|vehicle|person|people|visitor|visitors|package)\b/i,
  /\bwho('s|s|\s+is)\s*(home|at\s*(the\s*)?(door|front))\b/i,
  /\b(anyone|somebody|someone)\s*(home|there|at)\b/i,
  /\b(presence|arrived|left|away|home)\b/i,
  /\b(thermostat|ecobee|lock|unlock|door\s*lock)\b/i,
  // Phase 32: Web browsing and video patterns
  /\b(website|webpage|url|https?:\/\/|\.com|\.org|\.net)\b/i,
  /\b(youtube|video|videos|mp4|webm)\b/i,
  /\b(search|google|bing|duckduckgo|look\s*up)\b/i,
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
 * @param source      - Message source (e.g. 'telegram', 'voice', 'web')
 */
export function routeMessage(
  message: string,
  override: boolean,
  lastProvider?: string,
  source?: string,
): RoutingDecision {
  // ALL messages go to Claude (via Max proxy). No Qwen, no GPT, Claude only.
  return { provider: pickSmartProvider(), reason: 'all messages route to Claude' };
}

/**
 * Pick the best Claude-capable provider.
 * Prefers openai (Claude Max proxy) since it's flat-rate; falls back to direct Claude API.
 */
function pickSmartProvider(): 'openai' | 'claude' {
  if (openaiAvailable) return 'openai';
  return 'claude';
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

  // Stage 4: Follow-up to a tool conversation → Claude/OpenAI (smart provider)
  if (lastProvider === 'claude' || lastProvider === 'openai') {
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

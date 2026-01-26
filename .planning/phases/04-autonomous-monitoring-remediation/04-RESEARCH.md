# Phase 4: Autonomous Monitoring & Remediation - Research

**Researched:** 2026-01-26
**Domain:** Background monitoring, threshold alerting, autonomous remediation, audit logging, real-time activity feed
**Confidence:** HIGH (all patterns leverage existing codebase infrastructure; no new libraries needed)

## Summary

Phase 4 builds an autonomous monitoring and remediation layer on top of the existing Jarvis backend. The monitoring loop polls cluster state (already being polled by the emitter), detects threshold violations and state changes, executes predefined runbooks via the existing MCP tool pipeline, and reports all activity through the existing Socket.IO event system and email infrastructure.

The key architectural insight is that **almost all infrastructure already exists**. The emitter already polls nodes/VMs/storage on timed intervals. The MCP executeTool() pipeline already enforces safety tiers. The events table already stores alerts and actions. Socket.IO /events namespace already pushes events to the frontend. The email agent on agent1 already sends HTML notifications. What Phase 4 adds is: (1) a monitor service that evaluates polled data against thresholds and previous state, (2) a runbook engine that maps detected conditions to remediation actions, (3) guardrails (rate limiting, blast radius, escalation), (4) a kill switch persisted in preferences, and (5) an audit trail table for autonomous actions.

No new npm packages are required. The entire phase can be built with Node.js setInterval timers, the existing better-sqlite3/Drizzle stack, existing Socket.IO namespaces, existing MCP tools, and SSH-based email sending to agent1.

**Primary recommendation:** Build the monitor as a standalone service module (`src/monitor/`) with a clear separation between detection (threshold checks), decision (autonomy level + kill switch + rate limits), and execution (runbook actions via executeTool). Use setInterval-based polling that reads from the same Proxmox API the emitter uses, but maintains its own state tracking for change detection.

## Standard Stack

### Core (Already in Codebase -- No New Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js setInterval | built-in | Tiered polling intervals (10s/30s/5min/30min) | Already used by emitter.ts; lightweight, in-process, no external scheduler needed |
| better-sqlite3 + Drizzle ORM | 12.6.2 / 0.45.1 | Audit log table, preferences for kill switch | Already initialized; WAL mode supports concurrent reads |
| Socket.IO (server) | 4.8.3 | Emit monitor events to /events namespace | Already set up with JWT auth on all namespaces |
| MCP executeTool() | existing | Execute remediation actions through safety pipeline | Already handles tier checks, sanitization, logging |
| node-ssh | 13.2.1 | SSH commands for email sending (to agent1) | Already pooled with auto-reconnect |
| Proxmox REST client | existing | Poll cluster state for threshold detection | Already built with timeout and error handling |

### Supporting (No New Dependencies)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| EventEmitter (node:events) | built-in | Internal monitor event bus for decoupling detection from action | When monitor detects a condition, emit an internal event that the runbook engine listens to |
| crypto.randomUUID() | built-in (Node 19+) | Generate unique IDs for remediation incidents | Each detected issue gets a unique incident ID for tracking |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| setInterval | node-cron | node-cron is better for calendar-based scheduling (daily at 2pm); setInterval is better for high-frequency polling (every 10s). Monitor needs high-frequency polling, so setInterval wins. |
| Custom rate limiter | rate-limiter-flexible | External library is overkill for a single-process monitor with ~5 rate limit keys. A simple Map<string, timestamp[]> sliding window is sufficient. |
| Custom state machine | XState or typescript-fsm | Full FSM libraries add complexity for what is essentially a linear workflow (detect -> decide -> act -> verify -> report). Use a simple enum-based state tracker instead. |
| Direct Proxmox polling | Re-use emitter data | The emitter already polls and emits data, but it does not retain the last-known state for comparison. The monitor needs both current state and previous state for change detection. Options: (A) monitor subscribes to emitter data via internal events, or (B) monitor polls independently. Recommendation: (B) poll independently -- cleaner separation, monitor owns its own polling cadence. |

**Installation:**
```bash
# No new packages needed -- all dependencies already in package.json
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  monitor/
    index.ts           # startMonitor() / stopMonitor() -- lifecycle management
    poller.ts          # Tiered polling functions that check cluster state
    thresholds.ts      # Threshold definitions and evaluation logic
    state-tracker.ts   # Previous state storage for change detection
    runbooks.ts        # Remediation runbook definitions and execution engine
    guardrails.ts      # Rate limiter, blast radius control, escalation logic
    reporter.ts        # Email report generation and sending via agent1
    types.ts           # Shared types for monitor domain
  db/
    schema.ts          # ADD: autonomy_actions table for audit log
    memory.ts          # ADD: autonomy action CRUD operations
```

### Pattern 1: Monitor Service with Tiered Polling
**What:** A background service that runs multiple polling loops at different frequencies, each evaluating a category of cluster health.
**When to use:** When different metrics have different urgency levels and acceptable detection latencies.

```typescript
// src/monitor/index.ts
// Tiered polling intervals per requirement REQ-MONITOR
const POLL_INTERVALS = {
  critical: 10_000,    // Node reachability, VM status (must detect in <30s)
  important: 30_000,   // Resource thresholds (disk, RAM, CPU)
  routine: 300_000,    // Service health checks, temperature trends
  background: 1_800_000, // Storage capacity planning, backup freshness
} as const;

// Each tier has its own setInterval, calling a dedicated poll+evaluate function
export function startMonitor(eventsNs: Namespace): void {
  intervals.push(setInterval(() => pollCritical(eventsNs), POLL_INTERVALS.critical));
  intervals.push(setInterval(() => pollImportant(eventsNs), POLL_INTERVALS.important));
  intervals.push(setInterval(() => pollRoutine(eventsNs), POLL_INTERVALS.routine));
  intervals.push(setInterval(() => pollBackground(eventsNs), POLL_INTERVALS.background));
}
```

### Pattern 2: State Change Detection via Diffing
**What:** Compare current poll results against previous known state to detect transitions (running -> stopped, online -> offline).
**When to use:** When you need to detect state changes (not just current values) to trigger remediation.

```typescript
// src/monitor/state-tracker.ts
interface TrackedState {
  nodes: Map<string, { status: string; lastSeen: number }>;
  vms: Map<number, { status: string; node: string; lastSeen: number }>;
}

// Compare current poll with tracked state, return list of changes
function detectChanges(current: PollResult, previous: TrackedState): StateChange[] {
  const changes: StateChange[] = [];
  // Example: VM was 'running', now 'stopped' -> VM_CRASHED event
  for (const vm of current.vms) {
    const prev = previous.vms.get(vm.vmid);
    if (prev && prev.status === 'running' && vm.status === 'stopped') {
      changes.push({ type: 'VM_CRASHED', vmid: vm.vmid, node: vm.node, ... });
    }
  }
  return changes;
}
```

### Pattern 3: Runbook Engine with Autonomy Levels
**What:** Each detected condition maps to a runbook. The runbook specifies what action to take and what autonomy level is required. The engine checks the current autonomy level (and kill switch) before executing.
**When to use:** When you need a declarative mapping from conditions to remediation actions with safety controls.

```typescript
// src/monitor/runbooks.ts
interface Runbook {
  id: string;
  name: string;
  trigger: ConditionType;          // What condition activates this
  autonomyLevel: AutonomyLevel;    // Minimum level required to execute
  action: RunbookAction;           // What to do (tool name + args builder)
  verify: VerifyFn;                // How to verify success after action
  cooldownMs: number;              // Minimum time between executions
}

const RUNBOOKS: Runbook[] = [
  {
    id: 'vm-crashed-restart',
    name: 'Restart crashed VM',
    trigger: 'VM_CRASHED',
    autonomyLevel: AutonomyLevel.L3_ACT_REPORT,
    action: { tool: 'start_vm', argsBuilder: (ctx) => ({ node: ctx.node, vmid: ctx.vmid, confirmed: true }) },
    verify: async (ctx) => { /* re-poll VM status, check running */ },
    cooldownMs: 60_000,
  },
  {
    id: 'node-unreachable-wol',
    name: 'Wake unreachable node',
    trigger: 'NODE_UNREACHABLE',
    autonomyLevel: AutonomyLevel.L3_ACT_REPORT,
    action: { tool: 'wake_node', argsBuilder: (ctx) => ({ node: ctx.node }) },
    verify: async (ctx) => { /* re-poll node status after wait */ },
    cooldownMs: 120_000,
  },
  {
    id: 'service-down-restart',
    name: 'Restart failed service',
    trigger: 'SERVICE_DOWN',
    autonomyLevel: AutonomyLevel.L3_ACT_REPORT,
    action: { tool: 'restart_service', argsBuilder: (ctx) => ({ node: ctx.node, service: ctx.service }) },
    verify: async (ctx) => { /* check systemctl is-active */ },
    cooldownMs: 60_000,
  },
];
```

### Pattern 4: Guardrails as Pre-execution Checks
**What:** Before any runbook executes, a chain of guardrail checks must pass: kill switch off, rate limit not exceeded, blast radius within bounds, escalation threshold not reached.
**When to use:** Always -- every autonomous action must pass guardrails.

```typescript
// src/monitor/guardrails.ts
interface GuardrailResult {
  allowed: boolean;
  reason?: string;
}

function checkGuardrails(incident: Incident, runbook: Runbook): GuardrailResult {
  // 1. Kill switch
  if (isKillSwitchActive()) return { allowed: false, reason: 'Kill switch is active' };

  // 2. Rate limit: max 3 attempts per issue per hour
  if (getAttemptCount(incident.key, 3600_000) >= 3) {
    triggerEscalation(incident);
    return { allowed: false, reason: 'Rate limit exceeded (3/hour), escalating to operator' };
  }

  // 3. Blast radius: never act on >1 node simultaneously
  if (getActiveRemediationCount() > 0) {
    return { allowed: false, reason: 'Another remediation is in progress (blast radius control)' };
  }

  // 4. Autonomy level check
  if (getCurrentAutonomyLevel() < runbook.autonomyLevel) {
    return { allowed: false, reason: `Current autonomy level insufficient for ${runbook.name}` };
  }

  return { allowed: true };
}
```

### Pattern 5: executeTool() with 'monitor' Source
**What:** The existing executeTool() pipeline already accepts a `source` parameter ('llm' | 'monitor' | 'user' | 'api'). Autonomous actions use `source: 'monitor'` which flows through the same safety checks.
**When to use:** For all autonomous remediation actions -- this ensures safety tier enforcement is consistent.

```typescript
// Remediation uses the existing pipeline
const result = await executeTool(
  runbook.action.tool,
  runbook.action.argsBuilder(context),
  'monitor',        // source = monitor (already defined in ToolSource type)
  false,            // no override -- monitor never uses override
);
```

**Critical note:** The safety tier system needs a modification for autonomous actions. Currently, RED tier tools (start/stop VM) require `confirmed: true`. For autonomous remediation, the runbook must pass `confirmed: true` in the args when the guardrails have approved the action. This is already supported by the args builder pattern above.

### Pattern 6: Kill Switch via Preferences Table
**What:** Store the kill switch state in the existing `preferences` table using memoryStore.setPreference('autonomy.killSwitch', 'true'|'false'). Expose via REST API endpoint.
**When to use:** The kill switch must be checkable on every polling cycle with near-zero latency. SQLite reads from WAL-mode database are fast enough (<1ms).

### Anti-Patterns to Avoid
- **DO NOT poll Proxmox API from both emitter and monitor at the same frequency** -- this doubles API load. The monitor should use staggered offsets or slightly different intervals to avoid thundering herd. Use a 1-2 second offset from emitter intervals.
- **DO NOT use the emitter's Socket.IO emit as the source of truth for monitor state** -- the emitter broadcasts to clients but does not retain state. The monitor needs its own state tracker.
- **DO NOT execute remediation tools without going through executeTool()** -- bypassing the safety pipeline removes tier enforcement, protected resource checks, and audit logging.
- **DO NOT block the event loop with synchronous operations in the monitoring loop** -- all polling and remediation must be fully async with proper error handling. A hung SSH connection must not block other monitors.
- **DO NOT retry remediation indefinitely** -- the 3-attempt escalation rule is a hard requirement. After 3 failures, stop and email the operator.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool execution with safety | Custom SSH/API calls for remediation | `executeTool()` from `src/mcp/server.ts` | Already has sanitization, tier checks, protected resource guards, and audit logging |
| Event persistence | Custom file logging | `memoryStore.saveEvent()` from `src/db/memory.ts` | Already has the events table with timestamp, type, severity, source, node, details, resolved/resolvedBy fields |
| Real-time client notification | Custom WebSocket messages | `eventsNs.emit('event', data)` via existing /events namespace | Frontend already listens for 'event' and 'alert' messages and renders them in ActivityFeed |
| Email sending | Nodemailer setup | SSH to agent1 and run emailService.sendNotification() | Already configured with Gmail credentials, tested, and working |
| Kill switch storage | Custom config file | `memoryStore.setPreference()` / `getPreference()` | Already has upsert semantics, timestamps, and REST API exposure |
| Protected resource checks | Custom guard for management VM | `isProtectedResource()` from `src/safety/protected.ts` | Already blocks VMID 103 and docker.service -- the monitor inherits this via executeTool() |

**Key insight:** Phase 4 is primarily a composition phase. It composes existing primitives (polling, tool execution, event logging, Socket.IO emission, email sending) into a new monitoring workflow. The only genuinely new code is the threshold evaluation logic, runbook definitions, guardrail enforcement, and the audit log table.

## Common Pitfalls

### Pitfall 1: Restart Loop (VM crashes on start, monitor retries indefinitely)
**What goes wrong:** A VM has a boot error. Monitor detects it as crashed, restarts it, it crashes again immediately. Without rate limiting, this repeats forever.
**Why it happens:** The monitor doesn't track remediation history per-issue.
**How to avoid:** Implement per-issue rate limiting with a sliding window. Key = `${conditionType}:${target}` (e.g., `VM_CRASHED:100`). Max 3 attempts per hour. After 3 failures, mark the issue as escalated and send email.
**Warning signs:** Same event appearing repeatedly in the activity feed. CPU usage spiking from rapid polling + action cycles.

### Pitfall 2: Thundering Herd on Proxmox API
**What goes wrong:** Monitor polls at 10s, emitter polls at 10s, chat tools query on-demand. Proxmox API gets overwhelmed.
**Why it happens:** Multiple consumers polling the same API without coordination.
**How to avoid:** Offset monitor polling by 5 seconds from emitter intervals. Consider a shared data cache that both emitter and monitor read from (future optimization). For now, stagger is sufficient given the 4-node cluster size.
**Warning signs:** Proxmox API timeout errors increasing. Dashboard data updates becoming sluggish.

### Pitfall 3: Acting on Multiple Nodes Simultaneously
**What goes wrong:** Two nodes go offline at the same time (e.g., power event). Monitor tries to WOL both simultaneously, potentially overwhelming the network or causing unexpected behavior.
**Why it happens:** No blast radius control.
**How to avoid:** Track active remediations in a Set. Before executing any runbook, check that no other remediation is currently in progress. Queue additional remediations and process them sequentially.
**Warning signs:** Multiple "remediation started" events with overlapping timestamps.

### Pitfall 4: Kill Switch State Not Checked Frequently Enough
**What goes wrong:** Operator toggles kill switch, but a remediation action that was already queued still executes.
**Why it happens:** Kill switch checked at detection time but not at execution time.
**How to avoid:** Check kill switch at TWO points: (1) when the condition is detected and a runbook is selected, and (2) immediately before calling executeTool(). Double-check pattern.
**Warning signs:** Action executes after kill switch was toggled on dashboard.

### Pitfall 5: Email Flooding
**What goes wrong:** Monitor detects many issues simultaneously and sends an email for each one. Operator's inbox is flooded.
**Why it happens:** No email rate limiting or batching.
**How to avoid:** Batch email notifications. Collect all events from a polling cycle and send a single digest email. Rate limit emails to max 1 per 5 minutes (configurable). Use severity to determine email urgency.
**Warning signs:** Dozens of emails in quick succession from the same monitoring cycle.

### Pitfall 6: Monitor Crashes Kill the Entire Backend
**What goes wrong:** An unhandled exception in the monitoring loop propagates and crashes the Express server.
**Why it happens:** Monitor code not wrapped in try/catch at the top level.
**How to avoid:** Every setInterval callback must be wrapped in try/catch. Every async operation must have error handling. Use `Promise.allSettled()` instead of `Promise.all()` for parallel operations. Log errors but never crash.
**Warning signs:** Backend process restarts unexpectedly. Docker container restart count increasing.

### Pitfall 7: SQLite Audit Log Growing Unbounded
**What goes wrong:** Over weeks/months, the autonomy_actions table grows very large, slowing down queries.
**Why it happens:** No retention policy.
**How to avoid:** Add a cleanup routine in the background polling tier (30min) that deletes audit records older than 30 days. Add indexes on timestamp and incident_key columns.
**Warning signs:** SQLite database file size growing continuously. Audit log queries taking >100ms.

## Code Examples

### Monitor Lifecycle Integration (in index.ts)

```typescript
// src/index.ts -- add alongside startEmitter()
import { startMonitor, stopMonitor } from './monitor/index.js';

// After startEmitter(clusterNs):
startMonitor(eventsNs);
console.log('[Monitor] Autonomous monitoring service started');

// In shutdown():
stopMonitor();
```

### Threshold Definitions

```typescript
// src/monitor/thresholds.ts
export interface Threshold {
  metric: string;
  operator: '>' | '<' | '==' | '!=';
  value: number;
  severity: 'warning' | 'error' | 'critical';
  condition: string;  // Human-readable condition name
}

export const THRESHOLDS: Threshold[] = [
  // Disk usage
  { metric: 'disk_percent', operator: '>', value: 90, severity: 'error', condition: 'DISK_HIGH' },
  { metric: 'disk_percent', operator: '>', value: 95, severity: 'critical', condition: 'DISK_CRITICAL' },

  // RAM usage
  { metric: 'mem_percent', operator: '>', value: 95, severity: 'critical', condition: 'RAM_CRITICAL' },
  { metric: 'mem_percent', operator: '>', value: 85, severity: 'warning', condition: 'RAM_HIGH' },

  // CPU usage (sustained)
  { metric: 'cpu_percent', operator: '>', value: 95, severity: 'warning', condition: 'CPU_HIGH' },
];
```

### Sliding Window Rate Limiter (No Library Needed)

```typescript
// src/monitor/guardrails.ts
const attemptLog = new Map<string, number[]>();

function getAttemptCount(key: string, windowMs: number): number {
  const now = Date.now();
  const timestamps = attemptLog.get(key) ?? [];
  // Filter to only timestamps within the window
  const recent = timestamps.filter(t => now - t < windowMs);
  attemptLog.set(key, recent);
  return recent.length;
}

function recordAttempt(key: string): void {
  const timestamps = attemptLog.get(key) ?? [];
  timestamps.push(Date.now());
  attemptLog.set(key, timestamps);
}
```

### Autonomy Level Enum

```typescript
// src/monitor/types.ts
export enum AutonomyLevel {
  L0_OBSERVE = 0,      // Only observe, no alerts
  L1_ALERT = 1,        // Observe + emit alerts to activity feed
  L2_RECOMMEND = 2,    // Alert + suggest remediation in feed
  L3_ACT_REPORT = 3,   // Execute remediation + report via feed and email
  L4_ACT_SILENT = 4,   // Execute remediation silently (only log to audit)
}
```

### Audit Log Schema Addition

```typescript
// Addition to src/db/schema.ts
export const autonomyActions = sqliteTable('autonomy_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  incidentKey: text('incident_key').notNull(),       // e.g., 'VM_CRASHED:100'
  incidentId: text('incident_id').notNull(),          // UUID for this specific incident
  runbookId: text('runbook_id').notNull(),             // e.g., 'vm-crashed-restart'
  condition: text('condition').notNull(),               // What was detected
  action: text('action').notNull(),                     // What tool was executed
  actionArgs: text('action_args'),                      // JSON of tool args
  result: text('result', { enum: ['success', 'failure', 'blocked', 'escalated'] }).notNull(),
  resultDetails: text('result_details'),                // JSON of tool result
  verificationResult: text('verification_result'),      // JSON of verify outcome
  autonomyLevel: integer('autonomy_level').notNull(),
  node: text('node'),
  attemptNumber: integer('attempt_number').notNull().default(1),
  escalated: integer('escalated', { mode: 'boolean' }).notNull().default(false),
  emailSent: integer('email_sent', { mode: 'boolean' }).notNull().default(false),
});
```

### Email Report via agent1

```typescript
// src/monitor/reporter.ts
import { execOnNode } from '../clients/ssh.js';

const AGENT1_HOST = '192.168.1.61';

async function sendRemediationEmail(incident: Incident, result: RemediationResult): Promise<void> {
  const subject = `[Jarvis] ${result.success ? 'Resolved' : 'ESCALATION'}: ${incident.condition} on ${incident.node}`;
  const html = buildEmailHtml(incident, result);

  // Escape single quotes in the HTML for shell embedding
  const escapedHtml = html.replace(/'/g, "'\\''");
  const escapedSubject = subject.replace(/'/g, "'\\''");

  const script = `
    cd /opt/agent && node -e "
      require('dotenv').config();
      const es = require('./src/services/emailService');
      es.init();
      es.sendNotification(
        'amazing2000zame@gmail.com',
        '${escapedSubject}',
        \`${escapedHtml}\`
      ).then(() => console.log('sent')).catch(e => console.error(e));
    "
  `;

  try {
    await execOnNode(AGENT1_HOST, script, 30_000);
  } catch (err) {
    console.warn('[Monitor] Failed to send email:', err instanceof Error ? err.message : err);
    // Email failure is non-fatal -- log but continue
  }
}
```

### Kill Switch REST API Endpoint

```typescript
// Addition to src/api/routes.ts
router.get('/api/monitor/status', (_req: Request, res: Response) => {
  const killSwitch = memoryStore.getPreference('autonomy.killSwitch');
  const autonomyLevel = memoryStore.getPreference('autonomy.level');
  res.json({
    killSwitch: killSwitch?.value === 'true',
    autonomyLevel: parseInt(autonomyLevel?.value ?? '3', 10),
  });
});

router.put('/api/monitor/killswitch', (req: Request, res: Response) => {
  const { active } = req.body as { active: boolean };
  memoryStore.setPreference('autonomy.killSwitch', String(active));

  // Emit kill switch state change to all connected event clients
  eventsNs.emit('event', {
    id: crypto.randomUUID(),
    type: 'status',
    severity: active ? 'warning' : 'info',
    title: active ? 'KILL SWITCH ACTIVATED' : 'Kill switch deactivated',
    message: active
      ? 'All autonomous actions disabled by operator'
      : 'Autonomous actions re-enabled',
    timestamp: new Date().toISOString(),
  });

  res.json({ killSwitch: active });
});
```

### Frontend Kill Switch Component

```typescript
// Kill switch toggle in dashboard TopBar or a dedicated monitor panel
// Reads /api/monitor/status, toggles via PUT /api/monitor/killswitch
// Styled as a prominent red/green toggle matching the eDEX-UI aesthetic
// Shows current autonomy level and active remediation count
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cron-based health checks with email-only alerts | Event-driven monitoring with autonomous remediation and live dashboard feed | 2024-2025 (AIOps 2.0 movement) | Reduces MTTR from minutes to seconds for well-understood issues |
| Monolithic monitoring scripts | Composable runbook engine with pluggable actions | 2024 (GitOps + IaC patterns) | Each runbook is independently testable and auditable |
| Human-in-the-loop for all actions | Tiered autonomy model (observe/alert/recommend/act/silent) | 2024-2025 | Allows gradual trust-building; operator controls autonomy level |
| External monitoring tools (Nagios, Zabbix) | Integrated monitoring within the application | 2023-2025 | Single deployment, shared state, consistent UI |

**Deprecated/outdated:**
- External monitoring services like Uptime Kuma (already on management VM) are complementary but not sufficient -- they cannot remediate, only alert
- Polling-only monitoring without state change detection is insufficient -- threshold alerts alone miss state transitions like VM crashes

## Open Questions

Things that could not be fully resolved:

1. **Should the monitor share polling data with the emitter?**
   - What we know: Both poll the Proxmox API. The emitter polls nodes/VMs/storage at 10s/15s/30s. The monitor needs similar data at 10s/30s/5min/30min.
   - What is unclear: Whether a shared data layer would reduce API load significantly or add unnecessary coupling.
   - Recommendation: Start with independent polling (simpler, better separation of concerns). If Proxmox API load becomes an issue, introduce a shared cache in a future optimization. The 4-node cluster is unlikely to stress the API.

2. **How to handle the monitor needing `confirmed: true` for RED tier tools**
   - What we know: executeTool() checks `confirmed` flag for RED tier. Autonomous actions should bypass human confirmation when guardrails approve.
   - What is unclear: Whether to add an `autonomousConfirmed` flag to executeTool() or pass `confirmed: true` in args from the runbook engine.
   - Recommendation: Pass `confirmed: true` in the tool args from the runbook engine. The guardrails are the autonomous equivalent of human confirmation. The executeTool() pipeline already handles this case -- the args builder includes `confirmed: true` when the runbook is approved by guardrails. No modifications needed to executeTool().

3. **Should the monitor emit to /events or to a new /monitor namespace?**
   - What we know: The /events namespace already carries events and alerts. The frontend ActivityFeed already renders them.
   - What is unclear: Whether mixing user-initiated events with autonomous monitor events in the same namespace/feed creates confusion.
   - Recommendation: Use the existing /events namespace. The event `source` field ('monitor' vs 'user' vs 'jarvis') already distinguishes the origin. The ActivityFeed can optionally filter by source. A new namespace adds unnecessary complexity.

4. **Email sending reliability when agent1 is offline**
   - What we know: Email is sent via SSH to agent1 (192.168.1.61). If agent1 is offline, email fails.
   - What is unclear: Whether to queue failed emails for retry.
   - Recommendation: Log failed email attempts but do not retry. The activity feed is the primary notification channel. Email is supplementary. If agent1 is the subject of the issue being remediated (node unreachable), email will naturally fail -- the operator should see this in the activity feed when they check the dashboard.

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis: src/realtime/emitter.ts, src/mcp/server.ts, src/safety/tiers.ts, src/db/memory.ts, src/db/schema.ts, src/clients/ssh.ts, src/clients/proxmox.ts, src/api/routes.ts, src/index.ts
- Frontend analysis: jarvis-ui/src/components/center/ActivityFeed.tsx, jarvis-ui/src/stores/cluster.ts, jarvis-ui/src/hooks/useEventsSocket.ts, jarvis-ui/src/types/events.ts
- Socket.IO v4 documentation: https://socket.io/docs/v4/namespaces/

### Secondary (MEDIUM confidence)
- Autonomous remediation patterns: https://moss.sh/reviews/automated-remediation-strategies/
- CNCF AIOps 2.0 forecast: https://www.cncf.io/blog/2026/01/23/the-autonomous-enterprise-and-the-four-pillars-of-platform-control-2026-forecast/
- Node.js setInterval vs cron comparison: https://www.sabbir.co/blogs/68e2852ae6f20e639fc2c9bc
- TypeScript state machine patterns: https://medium.com/@robinviktorsson/a-guide-to-the-state-design-pattern-in-typescript-and-node-js-with-practical-examples-20e92ff472df

### Tertiary (LOW confidence)
- Rate limiter patterns: https://medium.com/@learnbackend/3-rate-limiting-strategies-for-your-api-endpoints-in-node-js-0e3794b49d43

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- entire stack is already in the codebase; no new libraries needed
- Architecture: HIGH -- patterns follow established monitoring system design; well-understood domain
- Pitfalls: HIGH -- derived from direct analysis of the existing codebase's architecture and known issues
- Code examples: HIGH -- based on actual types and function signatures from the codebase

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (stable -- no external dependency changes expected)

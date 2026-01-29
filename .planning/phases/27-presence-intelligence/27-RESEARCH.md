# Phase 27: Presence Intelligence - Research

**Researched:** 2026-01-29
**Domain:** Presence detection state machine, multi-signal fusion, SQLite logging
**Confidence:** HIGH

## Summary

Phase 27 builds a presence intelligence system that combines three signals (network presence, camera face recognition, Frigate events) into a unified "Who's home?" answer. The implementation requires a SQLite presence_logs table for historical tracking, a state machine for per-person presence states (home/away/just_arrived/just_left/extended_away), and context injection into the system prompt so JARVIS knows who is home during conversations.

The existing codebase provides strong foundations: `frigate.ts` already has face recognition parsing via `parseFaceSubLabel()` and `getRecentFaceEvents()`, `smarthome.ts` has a working `get_who_is_home` tool that combines network scan and car detection, and `system-prompt.ts` has a `buildClusterSummary()` pattern for injecting live context.

**Primary recommendation:** Implement a 5-state presence state machine (home, away, just_arrived, just_left, extended_away) with SQLite-backed logging, extend `get_who_is_home` to include face recognition signals, and add a `<presence_context>` section to the system prompt built from current state.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.1 | SQLite schema + queries | Already used in codebase, TypeScript-native |
| better-sqlite3 | 12.6.2 | SQLite driver | Already used, sync API for WAL mode |
| zod | 4.3.6 | Tool argument validation | Already used for MCP tools |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | State machine library | NOT NEEDED - simple enum-based state is sufficient |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom state machine | xstate/robot | Over-engineering for 5-state system |
| SQLite polling | Event-driven MQTT | Higher complexity, Phase 29 scope |
| Frigate HTTP | MQTT subscription | Real-time but complex, deferred to v1.7 |

**Installation:** No new packages required. All dependencies already installed.

## Architecture Patterns

### Recommended Project Structure
```
jarvis-backend/src/
├── db/
│   ├── schema.ts           # ADD: presenceLogs table
│   └── migrate.ts          # ADD: presence_logs CREATE TABLE
├── presence/
│   ├── state.ts            # NEW: presence state machine
│   ├── tracker.ts          # NEW: PresenceTracker class
│   └── types.ts            # NEW: PresenceState enum, Person interface
├── mcp/tools/
│   └── smarthome.ts        # MODIFY: enhance get_who_is_home, add get_presence_history
└── ai/
    └── system-prompt.ts    # MODIFY: add buildPresenceContext()
```

### Pattern 1: Presence State Machine

**What:** 5-state enum with transition rules and hysteresis timers to prevent rapid state flapping.

**When to use:** Every presence state change evaluation.

**State Definitions:**
```typescript
// Source: Home Assistant community best practices
export enum PresenceState {
  JUST_ARRIVED = 'just_arrived',  // Transient: detected, waiting 10min
  HOME = 'home',                  // Stable: confirmed at home
  JUST_LEFT = 'just_left',        // Transient: departed, waiting 10min
  AWAY = 'away',                  // Stable: confirmed away
  EXTENDED_AWAY = 'extended_away', // After 24h away
}
```

**Transition Rules:**
```
                              +10 min
AWAY -----> JUST_ARRIVED -----> HOME
  ^              |                |
  |              | (flap guard)   |
  |              v                |
  |            HOME               |
  |                               |
  +------- JUST_LEFT <------------+
              |                 +10 min
              v
            AWAY
              | +24 hours
              v
        EXTENDED_AWAY
```

### Pattern 2: Multi-Signal Fusion

**What:** Combine three independent signals with confidence weighting.

**When to use:** Every `get_who_is_home` call and presence state update.

**Signals and Weights:**
| Signal | Confidence | Source | Indicates |
|--------|------------|--------|-----------|
| Network presence (phone MAC) | HIGH | arp-scan | At home |
| Face recognition (entry camera) | HIGH | Frigate sub_label | Arrived |
| Car detection (driveway camera) | MEDIUM | Frigate label=car | At home (indirect) |

**Fusion Logic:**
```typescript
// Pseudo-code for signal fusion
function evaluatePresence(person: TrackedPerson): PresenceSignal {
  const signals: Signal[] = [];

  // 1. Network presence (strongest for "at home")
  if (person.phoneOnNetwork) {
    signals.push({ type: 'network', confidence: 'high', indicates: 'home' });
  }

  // 2. Face recognition at entry (strongest for "arrived")
  const faceEvent = await frigate.getRecentFaceEvents({
    camera: 'front_door',
    after: tenMinutesAgo,
  }).find(e => e.face.name === person.name);

  if (faceEvent) {
    signals.push({ type: 'face', confidence: 'high', indicates: 'arrived' });
  }

  // 3. Network absence + no camera sightings (strongest for "left")
  if (!person.phoneOnNetwork && !recentCameraSighting(person, 30)) {
    signals.push({ type: 'combined_absence', confidence: 'high', indicates: 'away' });
  }

  return fuseSignals(signals);
}
```

### Pattern 3: SQLite Presence Log Schema

**What:** Append-only event log for presence transitions.

**Schema Design:**
```typescript
// Source: Drizzle ORM SQLite patterns
export const presenceLogs = sqliteTable('presence_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  personId: text('person_id').notNull(),        // "user_1", matches config
  personName: text('person_name').notNull(),    // "John" for display
  previousState: text('previous_state'),        // null on first log
  newState: text('new_state').notNull(),        // PresenceState enum value
  trigger: text('trigger').notNull(),           // 'network' | 'face' | 'timer' | 'manual'
  triggerDetails: text('trigger_details'),      // JSON: { camera, eventId, mac, etc }
});

// Indexes for common queries
CREATE INDEX idx_presence_person ON presence_logs(person_id);
CREATE INDEX idx_presence_timestamp ON presence_logs(timestamp);
CREATE INDEX idx_presence_state ON presence_logs(new_state);
```

### Pattern 4: Context Injection

**What:** Build a `<presence_context>` block and inject into system prompt.

**When to use:** Every chat interaction (similar to existing `buildClusterSummary()`).

**Example Output:**
```typescript
// Source: Existing system-prompt.ts patterns
function buildPresenceContext(): string {
  const states = presenceTracker.getCurrentStates();
  const lines = ['--- Presence Status ---'];

  for (const person of states) {
    lines.push(`${person.name}: ${person.state} (since ${person.since})`);
  }

  return lines.join('\n');
}

// Injected into system prompt:
// <presence_context>
// --- Presence Status ---
// John: home (since 2:30 PM)
// Sarah: away (since 9:15 AM)
// </presence_context>
```

### Anti-Patterns to Avoid

- **No hysteresis:** Rapid state flapping when phone WiFi reconnects. MUST have 10-minute delay timers.
- **Polling too frequently:** arp-scan every second is expensive. 30-60 second intervals sufficient.
- **Trusting single signal:** Phone on network but user at neighbor's house. Combine multiple signals.
- **No state persistence:** Losing presence state on backend restart. Store current state in DB or file.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State machine | Custom transition logic scattered across code | Centralized `PresenceTracker` class | Single source of truth for state |
| Timing delays | `setTimeout` chains | Timestamp comparison in state evaluation | Survives process restart |
| Network scan | Raw arp-scan parsing | Existing `scan_network_devices` tool output | Already handles MAC matching |
| Face events | Direct Frigate API calls | Existing `frigate.getRecentFaceEvents()` | Already parses sub_label |

**Key insight:** The existing codebase already has 80% of the pieces. Don't rebuild network scanning or face event parsing -- wrap them in a presence-aware layer.

## Common Pitfalls

### Pitfall 1: WiFi Flapping Causes Spurious Arrivals

**What goes wrong:** Phone temporarily disconnects from WiFi (deep sleep, range), reconnects 30 seconds later. System marks user as "just_left" then "just_arrived" triggering arrival automations.

**Why it happens:** Binary presence detection without debounce.

**How to avoid:**
- 10-minute delay before transitioning from `home` to `away`
- "Flap guard" - if returning from `just_left`, skip `just_arrived` and go direct to `home`
- Don't trigger arrival automations if previous state was `just_left`

**Warning signs:** Logs showing rapid state oscillation within minutes.

### Pitfall 2: Camera-Only Detection is Unreliable

**What goes wrong:** Relying solely on face recognition for presence misses when person enters through garage or stays in areas without cameras.

**Why it happens:** Camera coverage is incomplete.

**How to avoid:**
- Camera events are "arrival trigger" not "presence proof"
- Network presence is the authoritative "at home" signal
- Face recognition helps with WHO arrived, not IF someone is home

**Warning signs:** Person shows as "away" when their phone is on network.

### Pitfall 3: State Lost on Backend Restart

**What goes wrong:** Backend restarts, presence state resets to unknown, causes false "arrival" events.

**Why it happens:** State held only in memory.

**How to avoid:**
- Store current state in SQLite (simple key-value or dedicated table)
- On startup, load last known state from DB
- Consider startup state as "unknown" until first signal confirms

**Warning signs:** False arrival notifications after deployments.

### Pitfall 4: Stale System Prompt Context

**What goes wrong:** User asks "Who's home?" and system prompt says "John: away" but tool returns "John: home".

**Why it happens:** Context cached too long or not refreshed.

**How to avoid:**
- Presence context TTL of 30 seconds max (matches existing cluster summary cache)
- Build context fresh for each chat, don't cache across sessions

**Warning signs:** Contradiction between JARVIS's statement and tool output.

### Pitfall 5: Query Performance on Large Log Table

**What goes wrong:** `get_presence_history` becomes slow as presence_logs grows to millions of rows.

**Why it happens:** Missing indexes, unbounded queries.

**How to avoid:**
- Add indexes on `person_id`, `timestamp`, `new_state`
- Default limit of 100 results
- Consider 90-day retention purge (similar to Home Assistant)

**Warning signs:** Query times >100ms for history lookup.

## Code Examples

Verified patterns from official sources and existing codebase:

### Schema Definition (Drizzle ORM)
```typescript
// Source: Existing schema.ts patterns + Drizzle docs
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const presenceLogs = sqliteTable('presence_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  personId: text('person_id').notNull(),
  personName: text('person_name').notNull(),
  previousState: text('previous_state'),
  newState: text('new_state').notNull(),
  trigger: text('trigger').notNull(),
  triggerDetails: text('trigger_details'),
});
```

### Migration (Direct SQL Fallback)
```typescript
// Source: Existing migrate.ts pattern
// Add to runMigrations() function:

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS presence_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    person_id TEXT NOT NULL,
    person_name TEXT NOT NULL,
    previous_state TEXT,
    new_state TEXT NOT NULL,
    trigger TEXT NOT NULL,
    trigger_details TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_presence_person ON presence_logs(person_id);
  CREATE INDEX IF NOT EXISTS idx_presence_timestamp ON presence_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_presence_state ON presence_logs(new_state);
`);
```

### Presence State Types
```typescript
// Source: Home Assistant community patterns adapted to TypeScript
export enum PresenceState {
  JUST_ARRIVED = 'just_arrived',
  HOME = 'home',
  JUST_LEFT = 'just_left',
  AWAY = 'away',
  EXTENDED_AWAY = 'extended_away',
  UNKNOWN = 'unknown',
}

export interface TrackedPerson {
  id: string;          // Matches config.presenceDevices entry
  name: string;        // Display name
  phoneMac: string;    // For network detection
  state: PresenceState;
  stateChangedAt: Date;
  lastSeenCamera?: Date;
  lastFaceEvent?: string;  // Frigate event ID
}
```

### Presence Tracker Class Skeleton
```typescript
// Source: Adaptation of existing service patterns
export class PresenceTracker {
  private people: Map<string, TrackedPerson> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Load tracked people from config.presenceDevices
    for (const device of config.presenceDevices) {
      this.people.set(device.mac, {
        id: device.mac,
        name: device.owner,
        phoneMac: device.mac,
        state: PresenceState.UNKNOWN,
        stateChangedAt: new Date(),
      });
    }
  }

  async evaluatePresence(): Promise<void> {
    // 1. Run network scan
    // 2. Check recent face events
    // 3. Apply state machine transitions
    // 4. Log state changes to presence_logs
  }

  getCurrentStates(): TrackedPerson[] {
    return Array.from(this.people.values());
  }

  start(intervalMs: number = 60000): void {
    this.pollInterval = setInterval(() => this.evaluatePresence(), intervalMs);
  }

  stop(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }
}
```

### Enhanced get_who_is_home Tool
```typescript
// Source: Existing smarthome.ts get_who_is_home, extended
server.tool(
  'get_who_is_home',
  'Detect who is currently home using network presence, camera AI, and face recognition',
  {},
  async () => {
    const tracker = getPresenceTracker();
    const states = tracker.getCurrentStates();

    const results = {
      people: states.map(p => ({
        name: p.name,
        state: p.state,
        since: p.stateChangedAt.toISOString(),
        signals: [] as string[],
      })),
      summary: '',
    };

    // Build human-readable summary
    const home = states.filter(p => p.state === 'home' || p.state === 'just_arrived');
    const away = states.filter(p => p.state === 'away' || p.state === 'extended_away');

    if (home.length > 0) {
      results.summary = `${home.map(p => p.name).join(', ')} ${home.length === 1 ? 'is' : 'are'} home`;
    } else {
      results.summary = 'No one appears to be home';
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
    };
  },
);
```

### get_presence_history Tool
```typescript
// Source: New tool following existing patterns
server.tool(
  'get_presence_history',
  'Query arrival and departure history for tracked people',
  {
    personName: z.string().optional().describe('Filter by person name'),
    limit: z.number().min(1).max(100).optional().describe('Max results (default: 20)'),
    withinDays: z.number().min(1).max(90).optional().describe('Look back N days (default: 7)'),
  },
  async ({ personName, limit, withinDays }) => {
    const days = withinDays ?? 7;
    const after = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let query = db
      .select()
      .from(presenceLogs)
      .where(gte(presenceLogs.timestamp, after.toISOString()))
      .orderBy(desc(presenceLogs.timestamp))
      .limit(limit ?? 20);

    if (personName) {
      query = query.where(eq(presenceLogs.personName, personName));
    }

    const logs = await query;

    // Format for display
    const formatted = logs.map(log => ({
      person: log.personName,
      transition: `${log.previousState ?? 'unknown'} -> ${log.newState}`,
      time: log.timestamp,
      trigger: log.trigger,
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify({ logs: formatted }, null, 2) }],
    };
  },
);
```

### Presence Context for System Prompt
```typescript
// Source: Adaptation of existing buildClusterSummary pattern
let cachedPresenceContext: string | null = null;
let cachedPresenceTimestamp = 0;
const PRESENCE_CACHE_TTL = 30_000; // 30 seconds

export function buildPresenceContext(): string {
  if (cachedPresenceContext && Date.now() - cachedPresenceTimestamp < PRESENCE_CACHE_TTL) {
    return cachedPresenceContext;
  }

  const tracker = getPresenceTracker();
  const states = tracker.getCurrentStates();

  if (states.length === 0) {
    return 'No people configured for presence tracking.';
  }

  const lines = ['Current household presence:'];
  for (const person of states) {
    const since = formatTimeAgo(person.stateChangedAt);
    lines.push(`- ${person.name}: ${person.state} (since ${since})`);
  }

  const context = lines.join('\n');
  cachedPresenceContext = context;
  cachedPresenceTimestamp = Date.now();

  return context;
}

// Inject into buildClaudeSystemPrompt:
// <presence_context>
// ${buildPresenceContext()}
// </presence_context>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Binary home/away | 5-state machine with hysteresis | 2020+ | Prevents automation misfires |
| Single signal (router) | Multi-signal fusion | 2022+ | Higher accuracy |
| Polling-only | Event-driven (MQTT) | 2023+ | Lower latency (NOT IMPLEMENTED YET - Phase 29/v1.7) |

**Deprecated/outdated:**
- None for this phase. HTTP polling is acceptable for v1.6 single-user scope.

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal poll interval**
   - What we know: 30-60 seconds is common for network scans
   - What's unclear: Best balance between responsiveness and CPU load
   - Recommendation: Start with 60 seconds, make configurable via env var

2. **Retention period for presence_logs**
   - What we know: Home Assistant defaults to 10 days for short-term stats
   - What's unclear: User needs for "When did John arrive last Tuesday?"
   - Recommendation: 90-day retention with nightly purge, like existing events table

3. **Handling multiple phones per person**
   - What we know: Some users have work phone + personal phone
   - What's unclear: How common, how to model in config
   - Recommendation: Defer to v1.7 - single device per person for now

## Sources

### Primary (HIGH confidence)
- Existing codebase: `jarvis-backend/src/db/schema.ts`, `frigate.ts`, `smarthome.ts`, `system-prompt.ts`
- Drizzle ORM documentation: https://orm.drizzle.team/docs/sql-schema-declaration
- Existing migration pattern: `jarvis-backend/src/db/migrate.ts`

### Secondary (MEDIUM confidence)
- Home Assistant presence detection best practices: https://www.home-assistant.io/getting-started/presence-detection/
- Phil Hawthorne's 5-state presence machine: https://philhawthorne.com/making-home-assistants-presence-detection-not-so-binary/
- Home Assistant database schema patterns: https://www.home-assistant.io/docs/backend/database

### Tertiary (LOW confidence)
- Community discussions on multi-signal fusion: https://community.home-assistant.io/t/best-practice-for-presence-arrival-detection/37036

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, no new dependencies
- Architecture: HIGH - patterns adapted from existing codebase
- Pitfalls: HIGH - well-documented in Home Assistant community
- State machine design: MEDIUM - adapted from community patterns, needs validation

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days - stable domain, no fast-moving APIs)

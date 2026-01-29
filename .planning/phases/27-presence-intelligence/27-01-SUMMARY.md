---
phase: 27
plan: 01
subsystem: presence-intelligence
tags: [presence, state-machine, sqlite, face-recognition, network-detection]
depends_on:
  requires: [26-01, 26-02]
  provides: [presence-tracking, state-machine, presence-logs]
  affects: [27-02, 28-01]
tech-stack:
  added: []
  patterns: [state-machine, hysteresis, multi-signal-fusion, singleton]
key-files:
  created:
    - jarvis-backend/src/presence/types.ts
    - jarvis-backend/src/presence/tracker.ts
  modified:
    - jarvis-backend/src/db/schema.ts
    - jarvis-backend/src/db/migrate.ts
    - jarvis-backend/src/mcp/tools/smarthome.ts
decisions:
  - key: state-machine-states
    choice: 6 states (unknown, home, away, just_arrived, just_left, extended_away)
    rationale: Covers all presence scenarios with clear transitions
  - key: hysteresis-timers
    choice: 10 minutes for arrival/departure confirmation, 24 hours for extended_away
    rationale: Prevents WiFi flapping from causing spurious events
  - key: multi-signal-fusion
    choice: Combine network (arp-scan) + face recognition signals
    rationale: More reliable than single source, face recognition adds arrival detection
metrics:
  duration: ~3 minutes
  completed: 2026-01-29
---

# Phase 27 Plan 01: Presence Intelligence Core Summary

**One-liner:** 5-state presence tracker with 10-minute hysteresis combining network detection and face recognition, logging to SQLite.

## Objective

Create SQLite presence_logs table, implement 5-state presence tracker with hysteresis, and enhance get_who_is_home to return combined multi-signal presence data.

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Add presence_logs table schema and migration | ccf3650 | schema.ts, migrate.ts: presenceLogs table with 3 indexes |
| 2 | Create presence types and 5-state machine | cfa9ff1 | types.ts: PresenceState enum, TrackedPerson interface; tracker.ts: PresenceTracker class |
| 3 | Enhance get_who_is_home tool | 8c20d3f | smarthome.ts: Integrated PresenceTracker, returns state-aware presence |

## What Was Built

### 1. Presence Logs Table (SQLite)

```sql
CREATE TABLE presence_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  person_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  trigger TEXT NOT NULL,
  trigger_details TEXT
);
```

Indexes on `person_id`, `timestamp`, `new_state` for efficient queries.

### 2. PresenceState Enum (6 States)

- `unknown` - Initial state before first signal
- `just_arrived` - Transient: detected, waiting 10min to confirm
- `home` - Stable: confirmed at home
- `just_left` - Transient: departed, waiting 10min to confirm
- `away` - Stable: confirmed away
- `extended_away` - After 24h away

### 3. PresenceTracker Class

**Key methods:**
- `evaluatePresence()` - Scans network, gets face events, computes state transitions
- `getCurrentStates()` - Returns all tracked people with current states
- `getPersonState(name)` - Get state for specific person
- `start(intervalMs)` / `stop()` - Background polling control

**Multi-signal fusion:**
- Network presence: High confidence "home" signal via arp-scan
- Face recognition: High confidence "arrived" signal via Frigate
- Absence: Derived when no network presence for >10 minutes

**Hysteresis:**
- 10 minutes to confirm arrival (just_arrived -> home)
- 10 minutes to confirm departure (just_left -> away)
- 24 hours for extended away transition

### 4. Enhanced get_who_is_home Tool

Now returns structured presence data:
```json
{
  "people": [
    {
      "name": "User",
      "state": "home",
      "since": "2026-01-29T10:00:00Z",
      "lastNetworkSeen": "2026-01-29T14:15:00Z",
      "lastCameraSeen": "2026-01-29T10:00:00Z"
    }
  ],
  "summary": "User is home"
}
```

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

- Build passes with no TypeScript errors
- State machine handles all 6 states with proper transitions
- Flap guard: returning home signal during JUST_LEFT goes directly to HOME
- All state transitions logged with trigger details (JSON)

## Integration Points

| Component | Integration |
|-----------|-------------|
| frigate.ts | getRecentFaceEvents() for face recognition signals |
| ssh.ts | execOnNodeByName('Home', 'arp-scan') for network detection |
| db/index.ts | Drizzle ORM for presence_logs inserts |
| config.ts | presenceDevices array for tracked people |
| smarthome.ts | get_who_is_home calls PresenceTracker |

## Requirements Delivered

- **PRES-01:** Presence state machine (5 states + unknown) - DELIVERED
- **PRES-02:** Network + camera signal fusion - DELIVERED
- **PRES-03:** Hysteresis for WiFi flapping protection - DELIVERED

## Next Phase Readiness

**27-02 (Presence History Tools):**
- presence_logs table ready for querying
- State transitions being logged
- Can add get_presence_history, get_arrival_times tools

**Blockers:** None

**Notes:**
- PresenceTracker is a singleton (getPresenceTracker())
- Background polling not auto-started - call tracker.start() if needed
- Face library currently empty - need enrolled faces for face recognition signals

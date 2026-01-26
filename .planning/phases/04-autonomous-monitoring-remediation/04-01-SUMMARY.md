---
phase: 04-autonomous-monitoring-remediation
plan: 01
subsystem: monitoring
tags: [socket.io, sqlite, proxmox-api, state-tracking, threshold-detection, polling]

requires:
  - phase: 01-backend-foundation
    provides: "Express server, Socket.IO namespaces (/cluster, /events), Proxmox client, SQLite + drizzle-orm, emitter polling pattern"
provides:
  - "Monitor types (AutonomyLevel, ConditionType, StateChange, ThresholdViolation, Incident, MonitorEvent)"
  - "StateTracker for node/VM state change detection"
  - "ThresholdEvaluator for disk/RAM/CPU violation detection with dedup"
  - "4 tiered pollers (critical 12s, important 32s, routine 5min, background 30min)"
  - "Monitor lifecycle (startMonitor/stopMonitor) wired into server"
  - "autonomy_actions audit log table with CRUD operations"
affects:
  - "04-02 (runbooks + guardrails will consume detected incidents and write to autonomy_actions)"
  - "04-03 (dashboard integration will filter events by source: 'monitor')"

tech-stack:
  added: []
  patterns:
    - "Tiered polling with offset intervals to avoid API thundering herd"
    - "State tracking with initial-populate-no-emit pattern to prevent false alerts on startup"
    - "Threshold deduplication via active violation Set (only emit NEW violations)"
    - "Promise.allSettled for parallel API calls with independent failure handling"

key-files:
  created:
    - "src/monitor/types.ts"
    - "src/monitor/state-tracker.ts"
    - "src/monitor/thresholds.ts"
    - "src/monitor/poller.ts"
    - "src/monitor/index.ts"
  modified:
    - "src/db/schema.ts"
    - "src/db/migrate.ts"
    - "src/db/memory.ts"
    - "src/index.ts"

key-decisions:
  - "Threshold order: DISK_CRITICAL (95%) checked before DISK_HIGH (90%) so highest severity wins"
  - "5-second startup delay before first monitor poll to let emitter populate initial data"
  - "Polling offsets: 12s/32s vs emitter 10s/30s to avoid simultaneous API calls"
  - "State tracker in-memory only (not SQLite) for hot-path performance"
  - "Only emit VM_CRASHED/CT_CRASHED on running->stopped transition (not already-stopped VMs)"

patterns-established:
  - "Monitor source contract: all events emitted with source: 'monitor' literal for frontend filtering"
  - "Tiered polling: critical (12s state), important (32s thresholds), routine (5min services), background (30min cleanup)"
  - "Autonomous action audit trail: every remediation action logged with incident key, result, and attempt count"

duration: 4min
completed: 2026-01-26
---

# Phase 4 Plan 1: Autonomous Monitoring Detection Backbone Summary

**Tiered monitor service with state change detection, threshold violation tracking, and autonomy audit log for cluster-wide autonomous monitoring**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-26T13:00:57Z
- **Completed:** 2026-01-26T13:04:40Z
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments
- Built complete monitor type system (AutonomyLevel enum, ConditionType union, StateChange, ThresholdViolation, Incident, MonitorEvent interfaces)
- Created StateTracker that detects node/VM state transitions without false alerts on startup
- Built ThresholdEvaluator with deduplication (disk >90/95%, RAM >85/95%, CPU >95%)
- Implemented 4 tiered pollers with offset intervals (12s/32s/5min/30min) and Promise.allSettled for resilient parallel API calls
- Added autonomy_actions audit log table with 5 CRUD operations (save, list, filter by incident, count attempts, cleanup)
- Wired monitor lifecycle into server startup/shutdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Monitor types, audit log schema, and memory store extensions** - `7d54795` (feat)
2. **Task 2: State tracker, threshold evaluator, pollers, and monitor lifecycle** - `6d7f72a` (feat)

## Files Created/Modified
- `src/monitor/types.ts` - AutonomyLevel enum, ConditionType, StateChange, ThresholdViolation, Incident, MonitorEvent types
- `src/monitor/state-tracker.ts` - In-memory state tracker for node/VM transitions with initial-populate pattern
- `src/monitor/thresholds.ts` - Threshold definitions and evaluator with active violation deduplication
- `src/monitor/poller.ts` - 4 tiered poll functions (critical, important, routine, background) with source: 'monitor' events
- `src/monitor/index.ts` - Monitor lifecycle (startMonitor/stopMonitor) with offset polling intervals
- `src/db/schema.ts` - Added autonomyActions table schema (drizzle-orm)
- `src/db/migrate.ts` - Added CREATE TABLE IF NOT EXISTS for autonomy_actions with 3 indexes
- `src/db/memory.ts` - Added 5 CRUD functions for autonomy actions audit log
- `src/index.ts` - Wired startMonitor/stopMonitor into server lifecycle

## Decisions Made
- Threshold evaluation order places DISK_CRITICAL (95%) before DISK_HIGH (90%) so highest severity condition is checked first
- 5-second startup delay lets the emitter establish initial Proxmox API connections before monitor starts polling
- Polling intervals offset by 2s from emitter (12s vs 10s, 32s vs 30s) to avoid API thundering herd
- State tracker uses in-memory Maps (not SQLite) since this is hot-path data polled every 12 seconds
- Only running->stopped transitions trigger VM_CRASHED/CT_CRASHED (VMs already stopped at startup are silently tracked)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Monitor service detects state changes and threshold violations, ready for Plan 02 (runbooks + guardrails)
- Autonomy actions table ready for Plan 02 to write remediation audit records
- All events include source: 'monitor' field, ready for Plan 03 (dashboard integration)
- No blockers

---
*Phase: 04-autonomous-monitoring-remediation*
*Completed: 2026-01-26*

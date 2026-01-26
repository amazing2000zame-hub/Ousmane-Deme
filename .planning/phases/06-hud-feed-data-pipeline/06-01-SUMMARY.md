---
phase: 06-hud-feed-data-pipeline
plan: 01
subsystem: realtime, monitoring
tags: [socket.io, events, heartbeat, storage-alerts, activity-feed]

# Dependency graph
requires:
  - phase: 04-autonomous-monitoring-remediation
    provides: Poller infrastructure, eventsNs emission pattern, monitor service
  - phase: 03-ai-chat-claude-integration
    provides: Chat handler with tool execution callbacks
provides:
  - Chat tool executions emitted to /events namespace for ActivityFeed
  - JARVIS Online startup event on backend boot
  - 5-minute health heartbeat (Systems Nominal / Cluster Degraded)
  - 30-minute storage capacity alerts (warning at 85%, critical at 95%)
affects: [06-02, frontend-activity-feed]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual emission: save to DB via memoryStore.saveEvent + emit to eventsNs for live WebSocket clients"
    - "Parameter injection: eventsNs passed from index.ts to setupChatHandlers for cross-namespace emission"

key-files:
  created: []
  modified:
    - jarvis-backend/src/realtime/chat.ts
    - jarvis-backend/src/index.ts
    - jarvis-backend/src/monitor/poller.ts

key-decisions:
  - "eventsNs injected as second parameter to setupChatHandlers (same DI pattern as monitor routes)"
  - "Storage check wrapped in inner try/catch so failures don't block audit cleanup in pollBackground"
  - "One event per tool execution (onToolUse only) -- no events for onToolResult/onBlocked to avoid feed spam"

patterns-established:
  - "Cross-namespace emission: chat namespace handlers emit to events namespace via injected parameter"
  - "Startup event pattern: emit status event inside server.listen callback after all services initialized"

# Metrics
duration: 3min
completed: 2026-01-26
---

# Phase 6 Plan 01: Event Pipeline Summary

**Chat tool events, JARVIS Online startup event, 5-min health heartbeat, and storage capacity alerts wired to /events namespace for ActivityFeed display**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-26T16:39:09Z
- **Completed:** 2026-01-26T16:41:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Chat tool executions now appear as `action` events in the ActivityFeed with `source: 'jarvis'`
- Backend emits a "JARVIS Online" status event on startup, saved to DB and broadcast to connected clients
- pollRoutine replaced from placeholder to health heartbeat that counts online/total nodes and emits Systems Nominal or Cluster Degraded
- pollBackground now checks all storage pools for capacity, emitting warnings at 85% and critical alerts at 95%

## Task Commits

Each task was committed atomically:

1. **Task 1: Chat tool events and startup event emission** - `7683b0b` (feat)
2. **Task 2: Health heartbeat and storage capacity alerts** - `ec5fe74` (feat)

## Files Created/Modified
- `jarvis-backend/src/realtime/chat.ts` - setupChatHandlers now accepts eventsNs; onToolUse callbacks emit tool execution events to /events namespace
- `jarvis-backend/src/index.ts` - Added crypto + memoryStore imports; passes eventsNs to setupChatHandlers; emits JARVIS Online event in server.listen callback
- `jarvis-backend/src/monitor/poller.ts` - pollRoutine emits health heartbeat; pollBackground checks storage capacity before audit cleanup

## Decisions Made
- eventsNs injected as second parameter to setupChatHandlers following the same dependency injection pattern used by setupMonitorRoutes -- keeps cross-namespace coupling explicit
- Only one event per tool execution (onToolUse) to avoid flooding the ActivityFeed with redundant onToolResult events
- Storage check has its own try/catch inside pollBackground so a Proxmox API failure for storage doesn't prevent audit log cleanup from running

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All four event sources now flow to /events namespace: chat tool use, startup, heartbeat, storage alerts
- Plan 06-02 can proceed with any remaining HUD/feed pipeline work
- ActivityFeed will display these events via existing socket listener

---
*Phase: 06-hud-feed-data-pipeline*
*Completed: 2026-01-26*

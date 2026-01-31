---
phase: 29-proactive-alerts
plan: 01
subsystem: backend
tags: [socket.io, frigate, polling, alerts, real-time]

# Dependency graph
requires:
  - phase: 26-face-recognition-foundation
    provides: Frigate client and face recognition APIs
provides:
  - AlertMonitor service with Frigate polling
  - alert:notification Socket.IO event emission
  - 5-minute cooldown deduplication
affects: [29-02, presence-intelligence, camera-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Polling service with lock flag to prevent stacking"
    - "Map-based cooldown with expiry cleanup"

key-files:
  created:
    - jarvis-backend/src/services/alert-monitor.ts
  modified:
    - jarvis-backend/src/config.ts
    - jarvis-backend/src/index.ts

key-decisions:
  - "5-second poll interval balances latency vs API load"
  - "5-minute cooldown per camera prevents notification spam"
  - "Only process events with sub_label === null (unknown persons)"
  - "Clean expired cooldowns after each poll to prevent memory leak"

patterns-established:
  - "Services pattern: startXxx/stopXxx functions for lifecycle management"
  - "Alert notification structure: id, type, camera, timestamp, thumbnailUrl, snapshotUrl, message"

# Metrics
duration: 8min
completed: 2026-01-30
---

# Phase 29 Plan 01: AlertMonitor Service Summary

**Backend AlertMonitor service polls Frigate every 5 seconds for unknown person events at entry cameras and emits Socket.IO notifications with 5-minute cooldown**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-31T01:45:00Z
- **Completed:** 2026-01-31T01:53:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Created AlertMonitor service with polling and cooldown logic
- Added alert configuration to config.ts (poll interval, cooldown, entry cameras, TTS toggle)
- Integrated into application startup/shutdown lifecycle
- Emits `alert:notification` event on `/events` namespace

## Task Commits

Each task was committed atomically:

1. **Task 1: Add alert configuration options** - `a4b3bb1` (feat)
2. **Task 2: Create AlertMonitor service** - `a4b3bb1` (feat)
3. **Task 3: Wire AlertMonitor into lifecycle** - `a4b3bb1` (feat)

All 3 tasks committed together as single atomic feature.

## Files Created/Modified

- `jarvis-backend/src/services/alert-monitor.ts` - AlertMonitor polling service with cooldown dedup
- `jarvis-backend/src/config.ts` - Alert configuration (pollInterval, cooldown, cameras, TTS)
- `jarvis-backend/src/index.ts` - Startup/shutdown lifecycle integration

## Decisions Made

- **5-second poll interval:** Balances detection latency vs Frigate API load
- **5-minute cooldown per camera:** Prevents notification spam for continuous detections
- **Only unknown persons (sub_label === null):** Recognized faces don't need alerts
- **Entry cameras configurable:** Default front_door, can be extended via env var
- **Clean expired cooldowns:** Prevents memory leak from accumulating stale entries

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Docker build caching caused alert-monitor.ts to not be compiled - resolved by running local `npm run build` before docker build

## Next Phase Readiness

- AlertMonitor emitting `alert:notification` events on `/events` namespace
- Ready for 29-02 frontend integration to display toasts and play TTS

---
*Phase: 29-proactive-alerts*
*Completed: 2026-01-30*

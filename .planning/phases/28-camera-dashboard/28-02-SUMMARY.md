---
phase: 28-camera-dashboard
plan: 02
subsystem: ui
tags: [react, typescript, video-rtc, mse, go2rtc, frigate, zustand, camera]

# Dependency graph
requires:
  - phase: 28-01
    provides: Camera API, camera store, CameraPanel/Card/Modal components
provides:
  - EventList component with detection thumbnails and face labels
  - EventRow component with object badges and confidence display
  - EventFilters component with camera and label dropdowns
  - LiveStreamModal with MSE streaming via video-rtc.js
  - CameraPanel integration with Live buttons and events section
affects: [29-proactive-intelligence, camera-features]

# Tech tracking
tech-stack:
  added: [video-rtc.js]
  patterns: [module-augmentation-for-custom-elements, polling-with-filters]

key-files:
  created:
    - jarvis-ui/src/components/camera/EventList.tsx
    - jarvis-ui/src/components/camera/EventRow.tsx
    - jarvis-ui/src/components/camera/EventFilters.tsx
    - jarvis-ui/src/components/camera/LiveStreamModal.tsx
    - jarvis-ui/public/video-rtc.js
    - jarvis-ui/src/vendor/video-rtc.d.ts
  modified:
    - jarvis-ui/src/components/camera/CameraPanel.tsx
    - jarvis-ui/src/stores/camera.ts
    - jarvis-ui/index.html

key-decisions:
  - "Use module augmentation for video-rtc custom element type declarations"
  - "10-second polling interval for events (same as snapshots)"
  - "Direct Frigate URL for MSE streaming (no proxy needed for WebSocket)"

patterns-established:
  - "Custom element integration: .d.ts with module augmentation, script tag in index.html"
  - "Event filtering: URLSearchParams with optional filters, controlled select components"
  - "Live modal: video-rtc.js with attribute-based configuration, cleanup on unmount"

# Metrics
duration: 3min
completed: 2026-01-29
---

# Phase 28 Plan 02: Live Streaming and Events Summary

**Live MSE streaming via video-rtc.js, EventList with detection thumbnails and face labels, and filtering by camera/object type**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-29T14:48:47Z
- **Completed:** 2026-01-29T14:52:12Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Live streaming works via video-rtc.js custom element with auto-connect
- Events display thumbnails, object badges, and face labels with confidence
- Recognized faces show in green, unknown persons in gray
- Camera and object type filtering via dropdown menus
- Events auto-refresh every 10 seconds

## Task Commits

Each task was committed atomically:

1. **Task 1: Add video-rtc.js and TypeScript declarations** - `6710bc0` (feat)
2. **Task 2: Create EventRow, EventFilters, and EventList components** - `fd6e15e` (feat)
3. **Task 3: Create LiveStreamModal and integrate into CameraPanel** - `a23fe27` (feat)

## Files Created/Modified

- `jarvis-ui/public/video-rtc.js` - go2rtc MSE/WebRTC player (v1.6.0)
- `jarvis-ui/src/vendor/video-rtc.d.ts` - TypeScript declarations for video-rtc element
- `jarvis-ui/index.html` - Added script tag for video-rtc.js
- `jarvis-ui/src/stores/camera.ts` - Added FrigateEvent type and live modal state
- `jarvis-ui/src/components/camera/EventRow.tsx` - Event row with thumbnail, badge, face label
- `jarvis-ui/src/components/camera/EventFilters.tsx` - Camera and object type dropdowns
- `jarvis-ui/src/components/camera/EventList.tsx` - Event list with polling and filtering
- `jarvis-ui/src/components/camera/LiveStreamModal.tsx` - MSE live stream modal
- `jarvis-ui/src/components/camera/CameraPanel.tsx` - Integrated Live buttons and events section

## Decisions Made

1. **Module augmentation for custom element types** - Used `declare module 'react'` to extend JSX.IntrinsicElements for video-rtc. This avoids global namespace pollution and works correctly with TypeScript's module resolution.

2. **Direct Frigate URL for MSE streaming** - LiveStreamModal connects directly to `http://192.168.1.61:5000` rather than proxying through the backend. WebSocket connections don't need CORS protection and direct connection has lower latency.

3. **10-second polling for events** - Matches snapshot polling interval. Provides reasonable freshness without excessive API load.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed TypeScript declarations for video-rtc custom element**
- **Found during:** Task 3 (Build verification)
- **Issue:** Initial `declare global` approach didn't work with TypeScript's module resolution - JSX.IntrinsicElements wasn't being extended
- **Fix:** Changed to `declare module 'react'` with module augmentation pattern, added `import 'react'` to make it a proper module
- **Files modified:** jarvis-ui/src/vendor/video-rtc.d.ts
- **Verification:** npm run build succeeds
- **Committed in:** a23fe27 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (blocking issue)
**Impact on plan:** Essential fix for TypeScript compilation. No scope creep.

## Issues Encountered

None - plan executed as written after the TypeScript fix.

## User Setup Required

None - no external service configuration required. Frigate is already running on agent1:5000.

## Next Phase Readiness

- Camera dashboard complete with snapshots, live streaming, and events
- CAM-03, CAM-04, CAM-05 requirements addressed
- Phase 28 complete - ready for Phase 29: Proactive Intelligence

---
*Phase: 28-camera-dashboard*
*Completed: 2026-01-29*

---
phase: 31-web-ui-redesign
plan: 01
subsystem: ui
tags: [camera, voice, dismissal, inline-camera, close-feed]

# Dependency graph
requires:
  - phase: 28-camera-dashboard
    provides: InlineCameraCard component with onClose prop
  - phase: 30-mcp-reliability
    provides: close_live_feed MCP tool handler
provides:
  - Working click-to-dismiss for inline camera feeds
  - Voice command "close the camera" via close_live_feed tool
  - Claude tool definition for close_live_feed
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Store method access via getState() for event handlers

key-files:
  created: []
  modified:
    - jarvis-ui/src/components/center/ChatMessage.tsx
    - jarvis-backend/src/ai/tools.ts
    - jarvis-backend/src/ai/system-prompt.ts

key-decisions:
  - "Use useChatStore.getState().clearInlineCamera() pattern for onClose handler"

patterns-established:
  - "Inline camera dismissal via both click and voice command"

# Metrics
duration: 2min
completed: 2026-01-30
---

# Phase 31 Plan 01: Camera Dismissal Summary

**Wired camera dismissal via click and voice - X button calls clearInlineCamera(), Claude has close_live_feed tool**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-30T22:08:31Z
- **Completed:** 2026-01-30T22:10:46Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- InlineCameraCard X button now dismisses camera when clicked
- Claude tool definitions include close_live_feed for voice commands
- System prompt guides Claude to use close_live_feed for dismissal

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire onClose handler to InlineCameraCard** - `a8596e5` (feat)
2. **Task 2: Add close_live_feed Claude tool definition** - `d6d4150` (feat)
3. **Task 3: Update system prompt with close_live_feed guidance** - `5802616` (feat)

## Files Created/Modified
- `jarvis-ui/src/components/center/ChatMessage.tsx` - Added useChatStore import, wired onClose prop
- `jarvis-backend/src/ai/tools.ts` - Added close_live_feed tool definition
- `jarvis-backend/src/ai/system-prompt.ts` - Updated Smart Home section with close_live_feed

## Decisions Made
- Use `useChatStore.getState().clearInlineCamera()` pattern for onClose handler (consistent with existing codebase patterns)

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Camera dismissal fully functional via both click and voice
- Ready for remaining 31-xx plans (UI redesign)

---
*Phase: 31-web-ui-redesign*
*Completed: 2026-01-30*

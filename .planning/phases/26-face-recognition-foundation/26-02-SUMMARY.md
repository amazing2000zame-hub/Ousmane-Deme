---
phase: 26-face-recognition-foundation
plan: 02
subsystem: smart-home
tags: [face-recognition, mcp-tools, frigate, camera-ai]

# Dependency graph
requires:
  - phase: 26-01
    provides: frigate.ts parseFaceSubLabel, getRecentFaceEvents, getFaceLibrary
provides:
  - whos_at_door MCP tool for doorbell face queries
  - get_recognized_faces MCP tool for face event queries
  - get_unknown_visitors MCP tool for unknown person queries
  - GREEN tier safety classification for all 3 tools
affects: [phase-27-presence, phase-29-proactive-alerts]

# Tech tracking
tech-stack:
  added: []
  patterns: [face-aware-event-querying, sub_label-parsing]

key-files:
  created: []
  modified:
    - jarvis-backend/src/mcp/tools/smarthome.ts
    - jarvis-backend/src/safety/tiers.ts

key-decisions:
  - "All face tools are GREEN tier (read-only, auto-execute)"
  - "whos_at_door queries only front_door camera for specificity"
  - "Tools parse sub_label via frigate.parseFaceSubLabel() for consistent handling"

patterns-established:
  - "Face recognition tools return structured JSON with summary + detailed events"
  - "Unknown visitors filtered by checking sub_label === null"
  - "Recognized faces grouped by name in summary object"

# Metrics
duration: 2min
completed: 2026-01-29
---

# Phase 26 Plan 02: Face Recognition MCP Tools Summary

**3 MCP tools for face recognition queries: whos_at_door, get_recognized_faces, get_unknown_visitors - all GREEN tier**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-29T07:29:19Z
- **Completed:** 2026-01-29T07:31:13Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added `whos_at_door` tool for answering "Who's at the door?" queries
- Added `get_recognized_faces` tool for listing face-identified events
- Added `get_unknown_visitors` tool for finding unidentified person detections
- Registered all 3 tools as GREEN tier (auto-execute, read-only)
- Updated module to 12 smart home tools total

## Task Commits

Each task was committed atomically:

1. **Task 1: Add whos_at_door MCP tool** - `5a29d1a` (feat)
2. **Task 2: Add get_recognized_faces and get_unknown_visitors tools** - `f95b2a1` (feat)
3. **Task 3: Register tools in safety tiers** - `b4924d2` (feat)

## Files Created/Modified

- `jarvis-backend/src/mcp/tools/smarthome.ts` - Added 3 face recognition query tools, updated to 12 tools total
- `jarvis-backend/src/safety/tiers.ts` - Added GREEN tier mappings for new tools

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| All tools GREEN tier | Read-only queries with no side effects - safe for auto-execution |
| whos_at_door uses front_door camera only | Entry-specific query for "who's at the door" use case |
| Tools use frigate.parseFaceSubLabel() | Consistent sub_label parsing across all face queries |
| Configurable lookback windows | Flexibility: 5min default for door, 60min for history queries |

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 27: Presence Intelligence**
- Face recognition foundation complete (26-01 + 26-02)
- JARVIS can now answer face-related questions via MCP tools
- Next: Build presence tracking with face events + device detection

**Phase 26 Complete:**
- [x] 26-01: Enable Frigate face recognition, extend frigate.ts client
- [x] 26-02: Add 3 MCP tools for face recognition queries

**Requirements Delivered:**
- FACE-02: "Who's at door?" query via whos_at_door tool
- FACE-03: Face event history via get_recognized_faces tool

---
*Phase: 26-face-recognition-foundation*
*Completed: 2026-01-29*

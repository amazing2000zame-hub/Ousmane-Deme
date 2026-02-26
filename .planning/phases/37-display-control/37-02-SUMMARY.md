---
phase: 37-display-control
plan: 02
subsystem: display
tags: [mcp-tool, display-control, fire-and-forget, daemon-threads, fetch-api, http-client]

requires:
  - phase: 37-display-control
    provides: "Flask display daemon HTTP API at 192.168.1.65:8765 (Plan 01)"
  - phase: 35-backend-integration
    provides: "BackendClient with Socket.IO voice protocol and TTS events"
provides:
  - "control_display MCP tool for LLM-driven display commands (show_url, show_camera, show_dashboard, restore)"
  - "DisplayClient in jarvis-ear for automatic HUD state display on wake word, TTS start, and TTS done"
  - "Camera name mapping: front_door, side_house, birdseye -> go2rtc stream URLs"
  - "YELLOW safety tier for control_display (non-destructive, logged)"
affects: [37-03, 37-04, jarvis-ear service, jarvis-backend docker rebuild]

tech-stack:
  added: []
  patterns: [fire-and-forget-daemon-threads, mcp-tool-http-proxy, display-state-hooks]

key-files:
  created:
    - jarvis-backend/src/mcp/tools/display.ts
    - jarvis-ear/src/jarvis_ear/display.py
  modified:
    - jarvis-backend/src/mcp/server.ts
    - jarvis-backend/src/safety/tiers.ts
    - jarvis-ear/src/jarvis_ear/config.py
    - jarvis-ear/src/jarvis_ear/backend.py
    - jarvis-ear/src/jarvis_ear/__main__.py

key-decisions:
  - "Fire-and-forget daemon threads for display calls -- never block audio capture"
  - "TYPE_CHECKING import with __future__ annotations for DisplayClient forward reference"
  - "Display hook on first TTS chunk (idx==0) not on tts_start event"
  - "Camera mapping in TypeScript const object -- easy to extend with new cameras"

patterns-established:
  - "Display daemon proxy pattern: MCP tool proxies HTTP calls to Flask daemon"
  - "Fire-and-forget pattern: daemon thread + requests.post + catch-all exception handler"
  - "Display state hook pattern: on_wake_word -> on_tts_start -> on_tts_done lifecycle"

duration: 8min
completed: 2026-02-26
---

# Phase 37 Plan 02: Display Integration Summary

**control_display MCP tool for LLM voice commands and DisplayClient in jarvis-ear for automatic HUD state transitions on wake/talk/done**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-26T08:09:56Z
- **Completed:** 2026-02-26T08:17:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- MCP tool `control_display` registered in jarvis-backend with show_url, show_camera, show_dashboard, and restore actions
- Camera name mapping (front_door, side_house, birdseye) to go2rtc stream.html URLs on agent1
- DisplayClient in jarvis-ear with fire-and-forget daemon threads for non-blocking display calls
- Automatic HUD state transitions: wake word -> listening, first TTS chunk -> talking, TTS done -> restore cameras
- YELLOW safety tier for control_display (execute + log, no confirmation needed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add control_display MCP tool to jarvis-backend** - `afdf74a` (feat)
2. **Task 2: Add DisplayClient to jarvis-ear for automatic HUD display** - `866361b` (feat)

## Files Created/Modified
- `jarvis-backend/src/mcp/tools/display.ts` - MCP tool that proxies display commands to Flask daemon via fetch() (130 lines)
- `jarvis-backend/src/mcp/server.ts` - Registered registerDisplayTools, updated tool count to 33
- `jarvis-backend/src/safety/tiers.ts` - Added control_display as YELLOW tier
- `jarvis-ear/src/jarvis_ear/display.py` - DisplayClient with fire-and-forget daemon thread HTTP calls (68 lines)
- `jarvis-ear/src/jarvis_ear/config.py` - Added DISPLAY_DAEMON_URL constant
- `jarvis-ear/src/jarvis_ear/backend.py` - Added display hooks in _on_tts_chunk (first chunk) and _on_tts_done
- `jarvis-ear/src/jarvis_ear/__main__.py` - Import DisplayClient, create instance, pass to BackendClient, call on_wake_word

## Decisions Made
- **Fire-and-forget via daemon threads**: Display calls spawn daemon threads with 2s timeout and catch-all exception handling. This ensures the audio capture main loop is never blocked, even if the display daemon is down or slow.
- **TYPE_CHECKING import pattern**: Used `from __future__ import annotations` and `TYPE_CHECKING` guard for the DisplayClient forward reference in backend.py to avoid circular imports.
- **First TTS chunk triggers display**: The display transitions to "talking" state on the first TTS chunk (index==0) rather than on a separate event, since TTS chunks are the definitive signal that audio playback is about to begin.
- **Camera name mapping as const object**: Camera names are mapped to go2rtc stream.html URLs in a simple Record type, making it easy to add new cameras later.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
- **Rebuild jarvis-backend Docker container** to pick up the new MCP tool: `cd /root && docker compose up -d --build jarvis-backend`
- **Restart jarvis-ear service** (when running) to pick up the DisplayClient: `systemctl restart jarvis-ear`

## Next Phase Readiness
- Display control is now fully wired: LLM can command display via MCP tool, jarvis-ear auto-manages HUD state
- Ready for Plan 03 (animated HUD page) and Plan 04 (end-to-end testing)
- Backend Docker container needs rebuild before live testing

## Self-Check: PASSED

- FOUND: /root/jarvis-backend/src/mcp/tools/display.ts
- FOUND: /root/jarvis-ear/src/jarvis_ear/display.py
- FOUND: /root/jarvis-backend/src/mcp/server.ts (registerDisplayTools registered)
- FOUND: /root/jarvis-backend/src/safety/tiers.ts (control_display: YELLOW)
- FOUND: /root/jarvis-ear/src/jarvis_ear/config.py (DISPLAY_DAEMON_URL)
- FOUND: /root/jarvis-ear/src/jarvis_ear/backend.py (display hooks)
- FOUND: /root/jarvis-ear/src/jarvis_ear/__main__.py (DisplayClient wired)
- FOUND: commit afdf74a (Task 1)
- FOUND: commit 866361b (Task 2)
- TypeScript compilation: PASSED (npx tsc --noEmit)
- Python syntax validation: PASSED (all 4 files)

---
*Phase: 37-display-control*
*Completed: 2026-02-26*

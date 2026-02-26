---
phase: 37-display-control
plan: 01
subsystem: display
tags: [flask, chromium-cdp, xdotool, x11, kiosk, systemd, websockets]

requires:
  - phase: none
    provides: standalone deployment on management VM
provides:
  - "Flask HTTP API at 192.168.1.65:8765 for display state control"
  - "POST /display/hud - show Jarvis HUD page with state parameter"
  - "POST /display/show - navigate Chromium kiosk to any URL"
  - "POST /display/restore - close Chromium, restore mpv camera feeds"
  - "GET /display/status - current display mode and metadata"
  - "Chromium CDP navigation via websockets (no selenium/playwright)"
  - "mpv window minimize/restore via xdotool (processes stay alive)"
  - "systemd service jarvis-display.service (enabled, auto-starts)"
affects: [37-02, 37-03, 37-04, jarvis-ear display integration]

tech-stack:
  added: [python3-flask 3.0.2, python3-websockets 10.4, xdotool, chromium-cdp]
  patterns: [flask-http-daemon, cdp-websocket-navigation, xdotool-window-management, xhost-local-auth]

key-files:
  created:
    - /root/jarvis-display/display_daemon.py
    - /root/jarvis-display/requirements.txt
    - /root/jarvis-display/static/hud.html
    - /root/jarvis-display/jarvis-display.service
  modified: []

key-decisions:
  - "xhost +local: at daemon startup to allow Chromium snap X11 access (snap refuses non-owned Xauthority)"
  - "Chromium launched without XAUTHORITY env (uses xhost), only DISPLAY=:0 and HOME=/root"
  - "CDP retry loop (10 attempts, 500ms) handles slow Chromium snap startup"
  - "Flask development server sufficient for single-client kiosk use"

patterns-established:
  - "Display daemon HTTP API pattern: POST endpoints for state transitions, GET for status"
  - "xdotool windowminimize to hide mpv (not pkill), keeping watchdog happy"
  - "Chromium snap kiosk: xhost +local: required for root-launched snap on kiosk X session"
  - "CDP navigation: urllib for /json endpoint, websockets for Page.navigate"

duration: 19min
completed: 2026-02-26
---

# Phase 37 Plan 01: Display Control Daemon Summary

**Flask display daemon on management VM with Chromium CDP navigation, xdotool mpv management, and systemd auto-start**

## Performance

- **Duration:** 19 min
- **Started:** 2026-02-26T07:45:09Z
- **Completed:** 2026-02-26T08:04:12Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Flask HTTP daemon running on management VM (192.168.1.65:8765) with full display state machine (camera/hud/browser)
- Chromium kiosk launched via subprocess, navigated via Chrome DevTools Protocol over websockets
- mpv camera feed windows minimized/restored via xdotool (processes stay alive for kiosk-mpv-watchdog)
- XAUTHORITY auto-discovery with cache invalidation for X session restarts
- systemd service enabled and auto-starts after kiosk.service

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Flask display control daemon** - `1af10b9` (feat)
2. **Task 2: Install systemd service** - `0fe3ba1` (chore)

## Files Created/Modified
- `jarvis-display/display_daemon.py` - Flask daemon with display state machine, CDP navigation, mpv window management (344 lines)
- `jarvis-display/requirements.txt` - Python dependencies (flask>=3.0, websockets>=10.4)
- `jarvis-display/static/hud.html` - Placeholder HUD page with JARVIS title and state indicator (65 lines)
- `jarvis-display/jarvis-display.service` - systemd unit for auto-start on management VM

## Decisions Made
- **xhost +local: for Chromium snap**: The Chromium snap refuses to use an Xauthority file not owned by the current user (root). Running `xhost +local:` at startup allows any local user to connect to X11, solving the snap ownership issue without modifying X11 auth files.
- **Chromium env without XAUTHORITY**: After enabling xhost, Chromium is launched with only DISPLAY=:0 and HOME=/root (no XAUTHORITY), relying on xhost local access instead.
- **Flask dev server for kiosk**: The Flask development server is sufficient for a single-client kiosk display daemon. No need for gunicorn/uwsgi complexity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Chromium snap Xauthority ownership rejection**
- **Found during:** Task 1 (Chromium launch testing)
- **Issue:** Chromium snap (v145) rejects Xauthority files not owned by the current user (root). Error: "cannot copy user Xauthority file: Xauthority file isn't owned by the current user 0". Chromium failed to connect to X11 display.
- **Fix:** Added `enable_xhost_local()` function that runs `xhost +local:` using kiosk XAUTHORITY at daemon startup. Modified Chromium launch to omit XAUTHORITY from env, relying on xhost local access instead.
- **Files modified:** jarvis-display/display_daemon.py
- **Verification:** Chromium successfully launches and renders HUD page on physical display
- **Committed in:** 1af10b9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for Chromium snap to work with kiosk X11 session. No scope creep.

## Issues Encountered
- CDP not immediately available after Chromium launch (10-attempt retry loop handles this, Chromium snap takes ~2s to start)
- First Chromium launch attempt sometimes creates a zombie process if it fails before snap wrapper completes (close_chromium handles cleanup)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Display daemon API ready for jarvis-ear integration (Plan 02)
- HUD placeholder ready for animated replacement (Plan 03)
- All endpoints tested end-to-end from Home node
- Service survives restarts

## Self-Check: PASSED

- FOUND: /root/jarvis-display/display_daemon.py (10569 bytes, 344 lines)
- FOUND: /root/jarvis-display/requirements.txt (28 bytes)
- FOUND: /root/jarvis-display/static/hud.html (1771 bytes)
- FOUND: /root/jarvis-display/jarvis-display.service (341 bytes)
- FOUND: /root/.planning/phases/37-display-control/37-01-SUMMARY.md
- FOUND: commit 1af10b9 (Task 1)
- FOUND: commit 0fe3ba1 (Task 2)
- Service RUNNING on 192.168.1.65:8765

---
*Phase: 37-display-control*
*Completed: 2026-02-26*

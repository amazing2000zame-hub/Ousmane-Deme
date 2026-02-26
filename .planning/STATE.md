# Jarvis 3.1 Project State

**Last Updated:** 2026-02-26T08:13:00Z
**Current Milestone:** v1.8 Always-On Voice Assistant

---

## Project Reference

**Core Value:** AI-operated Proxmox cluster command center with JARVIS personality
**Current Focus:** Phase 37 -- Display Control (In Progress, 3/4 plans done)

**Active Files:**
- `/root/.planning/PROJECT.md` - Project context
- `/root/.planning/ROADMAP.md` - Master roadmap
- `/root/.planning/MILESTONES.md` - Milestone history

---

## Current Position

**Milestone:** v1.8 Always-On Voice Assistant (Phases 33-38)
**Phase:** 37 of 38 (Display Control) -- IN PROGRESS
**Plan:** 3 of 4 complete
**Status:** Plan 37-03 complete -- Animated arc reactor HUD with SSE state push
**Last activity:** 2026-02-26 -- Plan 37-03 deployed animated HUD page and SSE endpoint to management VM

Progress: [||||||||||||||||||||||||||||||||........] 82% (32/38 phases complete overall)

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 33 | Audio Hardware Foundation | 2/2 | Complete |
| 34 | Audio Capture Daemon Core | 3/3 | Complete |
| 35 | Backend Integration | 2/2 | Complete |
| 36 | Speaker Output & Loop | 0/2 | Not Started |
| 37 | Display Control | 3/4 | In Progress |
| 38 | Service Management | 0/2 | Not Started |

---

## Accumulated Context

### Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Systemd over Docker for voice agent | Direct ALSA access, no device passthrough complexity | 2026-02-25 |
| Python daemon (not Node.js) | pyalsaaudio, Silero VAD, openWakeWord ecosystem | 2026-02-25 |
| ONNX Runtime over PyTorch | ~50MB vs ~2GB, sufficient for VAD + wake word | 2026-02-25 |
| Two-stage pipeline (VAD then wake word) | Saves CPU by only running wake word on speech frames | 2026-02-25 |
| USB mic fallback strategy | SOF firmware may not work after reboot | 2026-02-25 |
| Raw ONNX inference over silero-vad package | silero-vad pulls PyTorch (~2GB); raw onnxruntime avoids it | 2026-02-26 |
| Bundled VAD model in repo | Ensures offline operation, no runtime downloads | 2026-02-26 |
| openwakeword pinned to >=0.4 | >=0.6 requires tflite-runtime unavailable on Python 3.13 | 2026-02-26 |
| Frame accumulation in capture loop | dsnoop period_size=256 returns 256-sample chunks; accumulate to 512 for VAD | 2026-02-26 |
| openwakeword 0.4.x wakeword_model_paths API | Correct API is wakeword_model_paths (file paths), not wakeword_models | 2026-02-26 |
| Single-threaded main loop | VAD/wake word/state machine in main thread; audio capture in daemon thread | 2026-02-26 |
| VAD reset at state transition boundaries | Prevents temporal state leakage between IDLE and CAPTURING phases | 2026-02-26 |
| Sync socketio.Client over AsyncClient | Daemon uses sync main loop; sync Client handles threading internally | 2026-02-26 |
| Single WAV chunk per utterance | Backend Buffer.concat breaks multi-WAV-header concatenation | 2026-02-26 |
| 6-day JWT token refresh interval | Token valid 7 days; lazy refresh in _get_token() before expiry | 2026-02-26 |
| threading.Event for health monitor shutdown | Clean signal handling vs blocking time.sleep | 2026-02-26 |
| Token refresh on reconnect event | Simpler than callable auth; refresh in _on_connect handler | 2026-02-26 |
| Non-blocking start() for backend connection | Main audio loop never blocked by Socket.IO connection | 2026-02-26 |
| xhost +local: for Chromium snap X11 access | Snap refuses Xauthority not owned by current user; xhost bypass | 2026-02-26 |
| Flask dev server for kiosk display daemon | Single-client kiosk, no need for gunicorn/uwsgi | 2026-02-26 |
| Chromium CDP via raw websockets (not selenium) | 20 lines vs 100MB install, websockets 10.4 already present | 2026-02-26 |
| SSE-only state updates when in HUD mode | CDP Page.navigate destroys EventSource; SSE preserves connection | 2026-02-26 |
| CSS custom properties for HUD animation control | State classes set variables; CSS/JS reads them for animations | 2026-02-26 |
| Flask threaded=True for SSE + HTTP concurrency | SSE generator blocks thread; threaded mode handles concurrent requests | 2026-02-26 |
| Fire-and-forget daemon threads for display calls | Never block audio capture main loop; display is non-critical | 2026-02-26 |
| First TTS chunk triggers display talking state | Definitive signal that audio playback begins; no separate event needed | 2026-02-26 |
| Camera name mapping in TypeScript const object | Easy to extend with new cameras, compile-time type safety | 2026-02-26 |

### Technical Notes

- **Built-in mics**: Intel HDA digital mics, SOF firmware installed, needs reboot
- **SOF probe failure**: i915 dependency on headless Proxmox, may not resolve after reboot
- **Existing voice protocol**: `/voice` Socket.IO namespace already implements audio_start/chunk/end
- **Zero backend changes needed**: jarvis-ear connects as a client to existing protocol
- **Speaker situation**: Only HDMI output currently; may need USB speaker
- **BackendClient**: backend.py manages Socket.IO connection, JWT auth, voice protocol; thread-safe via Lock
- **python-socketio[client]**: Declared in deps but must be pip-installed into venv (sandbox blocked install)
- **BackendClient resilience**: Non-blocking start(), auto-reconnect with backoff, voice:ping/pong health monitoring, token refresh on reconnect
- **Backend connection tested live**: Daemon connects to backend, receives JWT, disconnects cleanly -- verified 2026-02-26
- **Display daemon**: Flask HTTP API at 192.168.1.65:8765, controls DP-3 display via Chromium CDP and xdotool
- **Management VM display**: X11 :0, kiosk user, 2 mpv RTSP streams, Chromium 145 snap, xdotool, Python 3.12
- **control_display MCP tool**: YELLOW tier, proxies to Flask daemon at 192.168.1.65:8765 via fetch()
- **DisplayClient**: fire-and-forget daemon threads, hooks into wake word / TTS start / TTS done
- **Camera URLs**: go2rtc stream.html on agent1:1984 (front_door, side_house, birdseye)
- **HUD SSE**: GET /display/events streams JSON state updates; 30s keepalive; auto-reconnect in JS
- **HUD states**: idle (3s pulse, dim), listening (1.2s pulse, ripples), talking (0.5s pulse, flicker)

### Blockers

- **Reboot required**: SOF firmware installed but kernel needs fresh boot to probe audio hardware (Phase 33 prerequisite)

---

## Session Continuity

**Last session:** 2026-02-26T08:13:00Z
**Stopped at:** Completed 37-03-PLAN.md (Animated HUD Page)
**Resume:** Execute 37-04-PLAN.md (final display control plan -- integration test)

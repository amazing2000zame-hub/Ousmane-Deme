# Jarvis 3.1 Project State

**Last Updated:** 2026-02-26T20:00:00Z
**Current Milestone:** v1.8 Always-On Voice Assistant

---

## Project Reference

**Core Value:** AI-operated Proxmox cluster command center with JARVIS personality
**Current Focus:** v1.8 milestone complete -- all phases (33-38) shipped

**Active Files:**
- `/root/.planning/PROJECT.md` - Project context
- `/root/.planning/ROADMAP.md` - Master roadmap
- `/root/.planning/MILESTONES.md` - Milestone history

---

## Current Position

**Milestone:** v1.8 Always-On Voice Assistant (Phases 33-38)
**Phase:** 38 of 38 -- ALL COMPLETE
**Plan:** All plans shipped
**Status:** v1.8 milestone complete. All 6 phases (33-38) implemented and deployed.
**Last activity:** 2026-02-26 -- Phase 38 (Service Management) executed: systemd service, CPU optimization, voice agent dashboard panel

Progress: [||||||||||||||||||||||||||||||||||||||||] 100% (38/38 phases complete overall)

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 33 | Audio Hardware Foundation | 2/2 | Complete |
| 34 | Audio Capture Daemon Core | 3/3 | Complete |
| 35 | Backend Integration | 2/2 | Complete |
| 36 | Speaker Output & Loop | 2/2 | Complete |
| 37 | Display Control | 4/4 | Complete |
| 38 | Service Management | 2/2 | Complete |

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
| X11 as root on Home node (no kiosk user) | Simpler for headless Proxmox host; no security concern for single-user | 2026-02-26 |
| On-demand Chromium (not permanent kiosk) | Home display returns to blank desktop when idle; Chromium closes on restore | 2026-02-26 |
| Multi-display target routing in MCP tool | 'kiosk' and 'home' targets resolve to different daemon URLs | 2026-02-26 |
| jarvis-ear defaults to localhost:8766 | Home node eDP-1 is natural target since jarvis-ear runs on Home | 2026-02-26 |
| ffmpeg subprocess for TTS audio decode | Handles WAV and Opus uniformly; 5ms overhead acceptable | 2026-02-26 |
| ALSA device kept open for daemon lifetime | No per-chunk open/close overhead (5-10ms saved per chunk) | 2026-02-26 |
| amixer subprocess for speaker enable | 2ms latency; simpler than C ALSA mixer bindings | 2026-02-26 |
| Mic mute in playback thread (not main loop) | Synchronized with actual ALSA output timing for accurate mute/unmute | 2026-02-26 |
| Chime before mic mute (non-speech frequencies) | C5+E5 tones won't trigger wake word model; immediate audio feedback | 2026-02-26 |
| 60s safety timeout force-unmutes mic | Hardware resilience against amixer failures or stuck state | 2026-02-26 |

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
- **Home node display**: X11 :1 on eDP-1, root-owned, xinit+openbox, Chromium Debian package, display daemon at localhost:8766
- **Two-display architecture**: kiosk (management VM 192.168.1.65:8765, DP-3, camera feeds) + home (Home node localhost:8766, eDP-1, on-demand HUD)
- **MCP target routing**: control_display accepts 'target' param ('kiosk'|'home'), defaults to 'kiosk' for backward compat
- **jarvis-ear default display**: localhost:8766 (Home eDP-1) since jarvis-ear runs on Home node
- **Home display on-demand**: Chromium launches for HUD/URL, closes on restore; blank black desktop when idle
- **AudioPlayer**: speaker.py, ordered PriorityQueue, background daemon thread, ffmpeg decode to 48kHz stereo, ALSA write in period chunks
- **Speaker output path**: TTS chunk (WAV 24kHz mono) -> b64 decode -> ffmpeg (48kHz stereo S16LE) -> ALSA dmix -> hw:1,0 -> Realtek ALC245 speakers
- **Speaker enabled at startup**: amixer -c 1 sset Speaker on, Master on, 60% volume
- **Mic mute echo prevention**: amixer -c 1 sset Dmic0 nocap/cap during TTS playback; 60s safety timeout
- **Wake word chime**: C5+E5 ascending two-tone, ~350ms, 67200 bytes PCM at 48kHz stereo
- **CONVERSATION state**: 15s follow-up window after TTS; speech in window triggers CAPTURING without wake word
- **Conversation flow**: IDLE -> wake word -> CAPTURING -> silence -> send audio -> TTS playback -> CONVERSATION -> follow-up or timeout -> IDLE

### Blockers

- **Reboot required**: SOF firmware installed but kernel needs fresh boot to probe audio hardware (Phase 33 prerequisite)

---

## Session Continuity

**Last session:** 2026-02-26T20:00:00Z
**Stopped at:** v1.8 milestone complete
**Resume:** Plan v1.9 milestone or address remaining items (Phase 29 proactive alerts still planned in v1.6)
**Fixed bugs:** Whisper STT 400 error (multipart form-data Blob fix), ONNX 150% CPU (thread limit), speaker volume

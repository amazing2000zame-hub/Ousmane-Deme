# Jarvis 3.1 Project State

**Last Updated:** 2026-02-26T05:51:00Z
**Current Milestone:** v1.8 Always-On Voice Assistant

---

## Project Reference

**Core Value:** AI-operated Proxmox cluster command center with JARVIS personality
**Current Focus:** Phase 34 -- Audio Capture Daemon Core (COMPLETE)

**Active Files:**
- `/root/.planning/PROJECT.md` - Project context
- `/root/.planning/ROADMAP.md` - Master roadmap
- `/root/.planning/MILESTONES.md` - Milestone history

---

## Current Position

**Milestone:** v1.8 Always-On Voice Assistant (Phases 33-38)
**Phase:** 34 of 38 (Audio Capture Daemon Core)
**Plan:** 3 of 3 complete
**Status:** Phase 34 COMPLETE -- all 3 plans executed, verification: human_needed (11/11 code checks pass, 4 live tests)
**Last activity:** 2026-02-26 -- Phase 34 verified, awaiting human acoustic testing

Progress: [||||||||||||||||||||||||||||||..........] 77% (31/38 phases complete overall)

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 33 | Audio Hardware Foundation | 2/2 | Complete |
| 34 | Audio Capture Daemon Core | 3/3 | Complete |
| 35 | Backend Integration | 0/2 | Not Started |
| 36 | Speaker Output & Loop | 0/2 | Not Started |
| 37 | Display Control | 0/3 | Not Started |
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

### Technical Notes

- **Built-in mics**: Intel HDA digital mics, SOF firmware installed, needs reboot
- **SOF probe failure**: i915 dependency on headless Proxmox, may not resolve after reboot
- **Existing voice protocol**: `/voice` Socket.IO namespace already implements audio_start/chunk/end
- **Zero backend changes needed**: jarvis-ear connects as a client to existing protocol
- **Speaker situation**: Only HDMI output currently; may need USB speaker

### Blockers

- **Reboot required**: SOF firmware installed but kernel needs fresh boot to probe audio hardware (Phase 33 prerequisite)

---

## Session Continuity

**Last session:** 2026-02-26T05:51:00Z
**Stopped at:** Phase 34 verified (human_needed) -- 4 live acoustic tests pending
**Resume:** Run human verification tests, then begin Phase 35 (Backend Integration)

# Jarvis 3.1 Project State

**Last Updated:** 2026-02-26T05:45:01Z
**Current Milestone:** v1.8 Always-On Voice Assistant

---

## Project Reference

**Core Value:** AI-operated Proxmox cluster command center with JARVIS personality
**Current Focus:** Phase 34 -- Audio Capture Daemon Core (Plan 01 complete)

**Active Files:**
- `/root/.planning/PROJECT.md` - Project context
- `/root/.planning/ROADMAP.md` - Master roadmap
- `/root/.planning/MILESTONES.md` - Milestone history

---

## Current Position

**Milestone:** v1.8 Always-On Voice Assistant (Phases 33-38)
**Phase:** 34 of 38 (Audio Capture Daemon Core)
**Plan:** 2 of 3 complete
**Status:** Executing Phase 34 plans
**Last activity:** 2026-02-26 -- Completed 34-02 (Silero VAD integration)

Progress: [||||||||||||||||||||||||||||||..........] 77% (31/38 phases complete overall)

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 33 | Audio Hardware Foundation | 0/2 | Not Started |
| 34 | Audio Capture Daemon Core | 2/3 | In Progress |
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

**Last session:** 2026-02-26T05:45:01Z
**Stopped at:** Completed 34-01-PLAN.md (Audio Capture Foundation)
**Resume:** Execute 34-03-PLAN.md (Wake Word + State Machine)

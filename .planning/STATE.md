# Jarvis 3.1 Project State

**Last Updated:** 2026-02-25
**Current Milestone:** v1.8 Always-On Voice Assistant

---

## Project Reference

**Core Value:** AI-operated Proxmox cluster command center with JARVIS personality

**Current Focus:** Server-side always-on voice interaction

**Active Files:**
- `/root/.planning/PROJECT.md` - Project context
- `/root/.planning/ROADMAP.md` - Master roadmap
- `/root/.planning/MILESTONES.md` - Milestone history

---

## Current Position

**Milestone:** v1.8 Always-On Voice Assistant
**Phase:** Not started (defining requirements)
**Plan:** —
**Status:** Defining requirements
**Last activity:** 2026-02-25 — Milestone v1.8 started

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| TBD | TBD | — | Not started |

---

## Accumulated Context

### Key Decisions (from previous milestones)

| Decision | Rationale | Date |
|----------|-----------|------|
| Use Frigate native face recognition | Avoids duplicating ML, leverages optimized FaceNet | 2026-01-29 |
| HTTP polling over MQTT initially | Simpler setup, MQTT deferred | 2026-01-29 |
| SQLite for presence logs | Extends existing schema, single backup | 2026-01-29 |
| MSE streaming via go2rtc | Lower latency than HLS, built into Frigate | 2026-01-29 |
| Piper TTS fallback | 99%+ reliability, <200ms synthesis | 2026-01-30 |
| SearXNG for web search | Privacy-focused, self-hosted, aggregated | 2026-01-30 |

### Technical Notes

- **Home node hardware**: Acer i5-13500HX laptop, Intel Raptor Lake, 20 threads, 24GB RAM
- **Built-in mics**: Intel HDA digital mics detected by kernel ("Digital mics found on Skylake+ platform, using SOF driver")
- **SOF firmware**: `firmware-sof-signed 2025.01-1` installed but needs reboot to activate
- **SOF probe failure at boot**: "deferred probe pending: init of i915 and HDMI codec failed" (firmware was missing, now installed)
- **Webcam**: Acer FHD User Facing (USB 0408:4036) — video only, NO audio interface
- **Audio output**: Only NVidia HDMI (4 ports, playback only). No analog/USB speakers currently.
- **Bluetooth**: Intel AX201 present (could pair BT speaker)
- **Existing voice pipeline**: Browser → Web Speech API → Whisper STT → LLM → TTS → Browser audio
- **Whisper service**: faster-whisper medium.en model, int8, Docker on port 5051
- **TTS stack**: XTTS v2 (port 5050, GPU) + Piper fallback (port 5000, CPU)

### Blockers

- **Reboot required**: SOF firmware installed but kernel needs fresh boot to probe audio hardware

### TODO

- [ ] Define v1.8 requirements
- [ ] Create v1.8 roadmap
- [ ] Reboot Home node to activate SOF audio (after planning)
- [ ] Test built-in mic quality

---

## Session Continuity

### Previous Session
- Completed all v1.6 and v1.7 phases (26-32)
- Smart home intelligence fully operational
- Web browsing and video playback working
- All 31 phases across 7 milestones shipped

### This Session
- Installed `firmware-sof-signed 2025.01-1` for built-in laptop mics
- SOF driver needs reboot to activate (probe failed at boot without firmware)
- Updated GSD repo to latest
- Started v1.8 milestone: Always-On Voice Assistant
- Updated PROJECT.md and STATE.md

---

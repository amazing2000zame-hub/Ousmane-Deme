# Jarvis 3.1 Project State

**Last Updated:** 2026-01-30
**Current Milestone:** v1.6 Smart Home Intelligence

---

## Project Reference

**Core Value:** AI-operated Proxmox cluster command center with JARVIS personality

**Current Focus:** MCP reliability improvements and voice acknowledgment timing fixes

**Active Files:**
- `/root/.planning/milestones/v1.6-ROADMAP.md` - Current roadmap
- `/root/.planning/REQUIREMENTS-v1.6.md` - v1.6 requirements
- `/root/.planning/research/FEATURES.md` - Feature research
- `/root/.planning/research/ARCHITECTURE.md` - Architecture decisions

---

## Current Position

**Milestone:** v1.6 Smart Home Intelligence
**Phase:** 30 - MCP Reliability & Voice Acknowledgment
**Plan:** 1 of 2 complete
**Status:** In progress
**Last activity:** 2026-01-30 - Completed 30-01: Voice acknowledgment timing fix

```
[=============                 ] 55%
Phase 30/30 | Plan 7/8 | Req 9/20
```

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 26 | Face Recognition Foundation | 2 | Complete (2/2) |
| 27 | Presence Intelligence | 2 | Complete (2/2) |
| 28 | Camera Dashboard | 2 | Complete (2/2) |
| 29 | Proactive Intelligence | 2 | Pending |
| 30 | MCP Reliability & Voice Ack | 2 | In Progress (1/2) |

**Requirements Progress:**
- FACE: 2/5 complete (FACE-01, FACE-02)
- PRES: 3/5 complete (PRES-01, PRES-02, PRES-03)
- CAM: 5/5 complete (CAM-01, CAM-02, CAM-03, CAM-04, CAM-05)
- ALERT: 0/5 complete

---

## Phase 30 Plans

| Plan | Wave | Objective | Status |
|------|------|-----------|--------|
| 30-01 | 1 | Voice acknowledgment timing fix | Complete |
| 30-02 | 1 | MCP tool timeout guards | Pending |

**Wave Structure:**
- Wave 1: 30-01 (voice ack), 30-02 (tool timeouts) - IN PROGRESS

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Plans completed | 7 |
| Requirements delivered | 10 |
| Lines of code | ~1150 |
| Test coverage | N/A |

---

## Accumulated Context

### Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Use Frigate native face recognition | Avoids duplicating ML, leverages optimized FaceNet | 2026-01-29 |
| HTTP polling over MQTT initially | Simpler setup, MQTT deferred to v1.7 | 2026-01-29 |
| SQLite for presence logs | Extends existing schema, single backup | 2026-01-29 |
| MSE streaming via go2rtc | Lower latency than HLS, built into Frigate | 2026-01-29 |
| 5s poll interval for events | Balances latency vs API load | 2026-01-29 |
| model_size: small for face recognition | CPU-only inference on agent1, no GPU | 2026-01-29 |
| recognition_threshold: 0.8 | Balance accuracy vs false positives | 2026-01-29 |
| 6-state presence machine | unknown, home, away, just_arrived, just_left, extended_away | 2026-01-29 |
| 10-minute hysteresis timers | Prevents WiFi flapping from causing spurious events | 2026-01-29 |
| Multi-signal fusion | Network + face recognition for reliable presence | 2026-01-29 |
| Proxy Frigate through backend | Consistent auth, no CORS issues | 2026-01-29 |
| Blob URL lifecycle management | Revoke old URLs before creating new to prevent memory leaks | 2026-01-29 |
| 10-second snapshot polling | Balances freshness vs API load | 2026-01-29 |
| Direct Frigate URL for MSE streaming | WebSocket doesn't need CORS, lower latency | 2026-01-29 |
| Module augmentation for custom elements | TypeScript pattern for video-rtc JSX support | 2026-01-29 |
| Dedicated chat:acknowledge event | Bypasses progressive queue for instant playback | 2026-01-30 |
| Force Piper TTS for acknowledgments | <200ms synthesis vs 7-15s XTTS | 2026-01-30 |

### Technical Notes

- **LLM moved to Home node CPU** (192.168.1.50:8080) - frees RTX 4050 for XTTS
- XTTS now running on GPU with finetuned JARVIS voice (2847 MiB VRAM)
- Piper TTS fallback available for instant synthesis (<200ms)
- Frigate 0.16.4 running on agent1:5000 with face_recognition ENABLED (model_size: small)
- frigate.ts client extended with parseFaceSubLabel(), getFaceLibrary(), getRecentFaceEvents()
- FrigateEvent.sub_label now typed as `string | [string, number] | null`
- 2 cameras: front_door (192.168.1.204), side_house (192.168.1.27)
- go2rtc built into Frigate at ports 8555/1984
- PresenceTracker singleton in presence/tracker.ts
- presence_logs table with indexes on person_id, timestamp, new_state
- get_who_is_home now returns state-aware presence data
- Face library currently empty (no enrolled faces yet)
- Camera API at /api/cameras, /api/cameras/:camera/snapshot, /api/events
- Camera store uses blob URLs with automatic cleanup
- CameraPanel with 2-column grid, modal with keyboard/click close
- video-rtc.js v1.6.0 for MSE/WebRTC streaming
- EventList with 10s polling and camera/label filters
- LiveStreamModal connects directly to Frigate for WebSocket streaming
- **Voice acknowledgments use dedicated chat:acknowledge event**
- **playAcknowledgmentImmediate() bypasses progressive queue**

### Blockers

None currently.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Move LLM to agent1 CPU to free GPU for XTTS voice | 2026-01-30 | 7a1f849 | [001-move-llm-to-agent1-cpu-to-free-gpu-for-x](./quick/001-move-llm-to-agent1-cpu-to-free-gpu-for-x/) |

### TODO

- [x] Start Phase 26 planning with `/gsd:plan-phase 26`
- [x] Execute 26-01: Enable Frigate face recognition
- [x] Execute 26-02: Add face recognition MCP tools
- [x] Execute 27-01: Create presence tracker and state machine
- [x] Execute 27-02: Add presence history tools
- [x] Execute 28-01: Create camera API and snapshot grid
- [x] Execute 28-02: Add live streaming
- [x] Execute 30-01: Voice acknowledgment timing fix
- [ ] Execute 30-02: MCP tool timeout guards
- [ ] Start Phase 29 planning (Proactive Intelligence)
- [ ] Execute Phase 29 plans

---

## Session Continuity

### Previous Session
- Completed research phase
- Created FEATURES.md and ARCHITECTURE.md
- Verified Frigate 0.16.4 capabilities
- Created v1.6 roadmap with 4 phases (26-29)
- Defined 20 requirements across 4 categories
- Executed Phase 26-28 plans
- Phase 28 complete - Camera Dashboard fully functional

### This Session
- Executed 30-01-PLAN.md (Voice acknowledgment timing fix)
- Added playAcknowledgmentImmediate() function for instant audio
- Created chat:acknowledge Socket.IO event handler
- Backend now forces Piper TTS for acknowledgments
- Acknowledgments now play BEFORE tool execution

### Next Steps
- Execute 30-02: MCP tool timeout guards
- Test voice acknowledgments with actual tool calls
- Start Phase 29 planning (Proactive Intelligence)

---

## Quick Commands

```bash
# View summaries
cat /root/.planning/phases/30-mcp-reliability-voice-ack/30-01-SUMMARY.md

# Test voice acknowledgment (enable voice mode, ask a tool question)
# Open http://192.168.1.50:3004, enable voice, ask "What's the cluster status?"

# Check Frigate
curl -s http://192.168.1.61:5000/api/config | jq '.cameras | keys'
curl -s "http://192.168.1.61:5000/api/events?limit=5" | jq

# Build and restart
cd /root/jarvis-ui && npm run build
cd /root && docker compose up -d --build
```

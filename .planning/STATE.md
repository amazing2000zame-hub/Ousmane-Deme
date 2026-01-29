# Jarvis 3.1 Project State

**Last Updated:** 2026-01-29
**Current Milestone:** v1.6 Smart Home Intelligence

---

## Project Reference

**Core Value:** AI-operated Proxmox cluster command center with JARVIS personality

**Current Focus:** Give JARVIS eyes -- camera face recognition, presence tracking, and proactive alerts

**Active Files:**
- `/root/.planning/milestones/v1.6-ROADMAP.md` - Current roadmap
- `/root/.planning/REQUIREMENTS-v1.6.md` - v1.6 requirements
- `/root/.planning/research/FEATURES.md` - Feature research
- `/root/.planning/research/ARCHITECTURE.md` - Architecture decisions

---

## Current Position

**Milestone:** v1.6 Smart Home Intelligence
**Phase:** 26 - Face Recognition Foundation
**Plan:** 1 of 2 complete
**Status:** In progress
**Last activity:** 2026-01-29 - Completed 26-01-PLAN.md

```
[===                           ] 12%
Phase 26/29 | Plan 1/8 | Req 1/20
```

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 26 | Face Recognition Foundation | 2 | In Progress (1/2) |
| 27 | Presence Intelligence | 2 | Pending |
| 28 | Camera Dashboard | 2 | Pending |
| 29 | Proactive Intelligence | 2 | Pending |

**Requirements Progress:**
- FACE: 1/5 complete (FACE-01: Frigate face recognition enabled)
- PRES: 0/5 complete
- CAM: 0/5 complete
- ALERT: 0/5 complete

---

## Phase 26 Plans

| Plan | Wave | Objective | Status |
|------|------|-----------|--------|
| 26-01 | 1 | Enable Frigate face recognition, extend frigate.ts client | Complete |
| 26-02 | 2 | Add 3 MCP tools (whos_at_door, get_recognized_faces, get_unknown_visitors) | Ready |

**Wave Structure:**
- Wave 1: 26-01 (independent, no dependencies) - COMPLETE
- Wave 2: 26-02 (depends on 26-01 for frigate.ts extensions) - Ready to execute

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Plans completed | 1 |
| Requirements delivered | 1 |
| Lines of code | ~70 (frigate.ts extensions) |
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

### Technical Notes

- Frigate 0.16.4 running on agent1:5000 with face_recognition ENABLED (model_size: small)
- frigate.ts client extended with parseFaceSubLabel(), getFaceLibrary(), getRecentFaceEvents()
- FrigateEvent.sub_label now typed as `string | [string, number] | null`
- 2 cameras: front_door (192.168.1.204), side_house (192.168.1.27)
- go2rtc built into Frigate at ports 8555/1984
- Existing tools: get_who_is_home, query_nvr_detections, get_camera_snapshot, scan_network_devices
- Face library currently empty (no enrolled faces yet)
- /api/faces returns face library data

### Blockers

None currently.

### TODO

- [x] Start Phase 26 planning with `/gsd:plan-phase 26`
- [x] Execute 26-01: Enable Frigate face recognition
- [ ] Execute 26-02: Add face recognition MCP tools
- [ ] Continue to Phase 27: Presence Intelligence

---

## Session Continuity

### Previous Session
- Completed research phase
- Created FEATURES.md and ARCHITECTURE.md
- Verified Frigate 0.16.4 capabilities
- Created v1.6 roadmap with 4 phases (26-29)
- Defined 20 requirements across 4 categories
- Planned Phase 26: Face Recognition Foundation

### This Session
- Executed 26-01-PLAN.md
- Enabled Frigate face recognition (model_size: small)
- Extended frigate.ts with face recognition parsing functions
- Verified integration working

### Next Steps
- Execute 26-02-PLAN.md (3 MCP tools for face queries)
- Enroll faces in Frigate library for testing
- Continue to Phase 27

---

## Quick Commands

```bash
# View plans
cat /root/.planning/phases/26-face-recognition-foundation/26-01-SUMMARY.md
cat /root/.planning/phases/26-face-recognition-foundation/26-02-PLAN.md

# Check Frigate face recognition
curl -s http://192.168.1.61:5000/api/config | jq '.face_recognition'
curl -s http://192.168.1.61:5000/api/faces

# Check Frigate events
curl -s "http://192.168.1.61:5000/api/events?label=person&limit=5" | jq

# Build backend
cd /root/jarvis-backend && npm run build
```

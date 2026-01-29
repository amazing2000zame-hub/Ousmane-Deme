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
**Phase:** 27 - Presence Intelligence
**Plan:** 1 of 2 complete
**Status:** In progress
**Last activity:** 2026-01-29 - Completed 27-01-PLAN.md

```
[=====                         ] 25%
Phase 27/29 | Plan 2/8 | Req 4/20
```

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 26 | Face Recognition Foundation | 2 | Complete (2/2) |
| 27 | Presence Intelligence | 2 | In Progress (1/2) |
| 28 | Camera Dashboard | 2 | Pending |
| 29 | Proactive Intelligence | 2 | Pending |

**Requirements Progress:**
- FACE: 2/5 complete (FACE-01, FACE-02)
- PRES: 3/5 complete (PRES-01, PRES-02, PRES-03)
- CAM: 0/5 complete
- ALERT: 0/5 complete

---

## Phase 27 Plans

| Plan | Wave | Objective | Status |
|------|------|-----------|--------|
| 27-01 | 1 | Create presence_logs table, 5-state tracker, enhance get_who_is_home | Complete |
| 27-02 | 2 | Add presence history tools (get_presence_history, get_arrival_times) | Ready |

**Wave Structure:**
- Wave 1: 27-01 (depends on 26-01, 26-02 for frigate integration) - COMPLETE
- Wave 2: 27-02 (depends on 27-01 for presence_logs table) - Ready to execute

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Plans completed | 2 |
| Requirements delivered | 5 |
| Lines of code | ~370 (presence module, smarthome.ts) |
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

### Technical Notes

- Frigate 0.16.4 running on agent1:5000 with face_recognition ENABLED (model_size: small)
- frigate.ts client extended with parseFaceSubLabel(), getFaceLibrary(), getRecentFaceEvents()
- FrigateEvent.sub_label now typed as `string | [string, number] | null`
- 2 cameras: front_door (192.168.1.204), side_house (192.168.1.27)
- go2rtc built into Frigate at ports 8555/1984
- PresenceTracker singleton in presence/tracker.ts
- presence_logs table with indexes on person_id, timestamp, new_state
- get_who_is_home now returns state-aware presence data
- Face library currently empty (no enrolled faces yet)

### Blockers

None currently.

### TODO

- [x] Start Phase 26 planning with `/gsd:plan-phase 26`
- [x] Execute 26-01: Enable Frigate face recognition
- [x] Execute 26-02: Add face recognition MCP tools
- [x] Execute 27-01: Create presence tracker and state machine
- [ ] Execute 27-02: Add presence history tools
- [ ] Continue to Phase 28: Camera Dashboard

---

## Session Continuity

### Previous Session
- Completed research phase
- Created FEATURES.md and ARCHITECTURE.md
- Verified Frigate 0.16.4 capabilities
- Created v1.6 roadmap with 4 phases (26-29)
- Defined 20 requirements across 4 categories
- Executed Phase 26 plans

### This Session
- Executed 27-01-PLAN.md
- Created presence_logs SQLite table with schema and migration
- Implemented 5-state PresenceTracker with 10-minute hysteresis
- Enhanced get_who_is_home with multi-signal fusion

### Next Steps
- Execute 27-02-PLAN.md (presence history tools)
- Enroll faces in Frigate library for testing
- Continue to Phase 28

---

## Quick Commands

```bash
# View plans
cat /root/.planning/phases/27-presence-intelligence/27-01-SUMMARY.md
cat /root/.planning/phases/27-presence-intelligence/27-02-PLAN.md

# Check Frigate face recognition
curl -s http://192.168.1.61:5000/api/config | jq '.face_recognition'
curl -s http://192.168.1.61:5000/api/faces

# Check Frigate events
curl -s "http://192.168.1.61:5000/api/events?label=person&limit=5" | jq

# Build backend
cd /root/jarvis-backend && npm run build
```

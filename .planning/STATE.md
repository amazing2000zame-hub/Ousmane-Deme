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
**Phase:** 28 - Camera Dashboard
**Plan:** 1 of 2 complete
**Status:** In progress
**Last activity:** 2026-01-29 - Completed 28-01-PLAN.md

```
[========                      ] 37%
Phase 28/29 | Plan 4/8 | Req 6/20
```

---

## Milestone Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 26 | Face Recognition Foundation | 2 | Complete (2/2) |
| 27 | Presence Intelligence | 2 | Complete (2/2) |
| 28 | Camera Dashboard | 2 | In Progress (1/2) |
| 29 | Proactive Intelligence | 2 | Pending |

**Requirements Progress:**
- FACE: 2/5 complete (FACE-01, FACE-02)
- PRES: 3/5 complete (PRES-01, PRES-02, PRES-03)
- CAM: 2/5 complete (CAM-01, CAM-02)
- ALERT: 0/5 complete

---

## Phase 28 Plans

| Plan | Wave | Objective | Status |
|------|------|-----------|--------|
| 28-01 | 1 | Create camera API and snapshot grid UI | Complete |
| 28-02 | 2 | Add live streaming with MSE/go2rtc | Ready |

**Wave Structure:**
- Wave 1: 28-01 (camera API, snapshot grid, modal) - COMPLETE
- Wave 2: 28-02 (live streaming integration) - Ready to execute

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Plans completed | 4 |
| Requirements delivered | 7 |
| Lines of code | ~600 (camera API, store, components) |
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
- Camera API at /api/cameras, /api/cameras/:camera/snapshot, /api/events
- Camera store uses blob URLs with automatic cleanup
- CameraPanel with 2-column grid, modal with keyboard/click close

### Blockers

None currently.

### TODO

- [x] Start Phase 26 planning with `/gsd:plan-phase 26`
- [x] Execute 26-01: Enable Frigate face recognition
- [x] Execute 26-02: Add face recognition MCP tools
- [x] Execute 27-01: Create presence tracker and state machine
- [x] Execute 27-02: Add presence history tools
- [x] Execute 28-01: Create camera API and snapshot grid
- [ ] Execute 28-02: Add live streaming
- [ ] Continue to Phase 29: Proactive Intelligence

---

## Session Continuity

### Previous Session
- Completed research phase
- Created FEATURES.md and ARCHITECTURE.md
- Verified Frigate 0.16.4 capabilities
- Created v1.6 roadmap with 4 phases (26-29)
- Defined 20 requirements across 4 categories
- Executed Phase 26 plans
- Executed Phase 27 plans

### This Session
- Executed 28-01-PLAN.md
- Created backend camera API with 5 Frigate proxy endpoints
- Built camera Zustand store with blob URL lifecycle management
- Implemented 10-second polling hook with AbortController cleanup
- Created CameraPanel, CameraCard, CameraModal components
- Added CAM tab to CenterDisplay

### Next Steps
- Execute 28-02-PLAN.md (live streaming with MSE/go2rtc)
- Test camera dashboard in browser
- Continue to Phase 29

---

## Quick Commands

```bash
# View plans
cat /root/.planning/phases/28-camera-dashboard/28-01-SUMMARY.md
cat /root/.planning/phases/28-camera-dashboard/28-02-PLAN.md

# Test camera API
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H 'Content-Type: application/json' -d '{"password":"jarvis"}' | jq -r '.token')
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/cameras
curl -o /tmp/snap.jpg -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/cameras/front_door/snapshot

# Check Frigate
curl -s http://192.168.1.61:5000/api/config | jq '.cameras | keys'
curl -s "http://192.168.1.61:5000/api/events?limit=5" | jq

# Build and restart
cd /root/jarvis-backend && npm run build
cd /root && docker compose up -d --build
```

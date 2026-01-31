# Requirements: v1.6 Smart Home Intelligence

**Milestone:** Jarvis v1.6
**Created:** 2026-01-29
**Status:** In Progress

## v1 Requirements (Must Have)

### Face Recognition (FACE)

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| FACE-01 | Enable Frigate face recognition with `model_size: small` for CPU inference | Must Have | 26 |
| FACE-02 | Update frigate.ts client to parse sub_label field from events | Must Have | 26 |
| FACE-03 | New MCP tool `whos_at_door` - query recent person events with face labels at entry cameras | Must Have | 26 |
| FACE-04 | New MCP tool `get_recognized_faces` - list all face events with recognized names | Must Have | 26 |
| FACE-05 | New MCP tool `get_unknown_visitors` - query person events without face recognition | Must Have | 26 |

### Presence Tracking (PRES)

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| PRES-01 | SQLite presence_logs table for arrival/departure events with timestamps | Must Have | 27 |
| PRES-02 | Enhanced `get_who_is_home` combining network + camera + face signals | Must Have | 27 |
| PRES-03 | Per-person presence state tracker (home/away/unknown) | Must Have | 27 |
| PRES-04 | New MCP tool `get_presence_history` - query "When did X arrive/leave?" | Must Have | 27 |
| PRES-05 | Presence context injection into system prompt for conversation awareness | Must Have | 27 |

### Camera Dashboard (CAM)

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| CAM-01 | CameraPanel component showing snapshot grid for all cameras | Must Have | 28 |
| CAM-02 | Click-to-enlarge snapshot modal with full resolution image | Must Have | 28 |
| CAM-03 | EventList component with recent detection thumbnails and face labels | Must Have | 28 |
| CAM-04 | Event filtering by camera, object type, and time range | Must Have | 28 |
| CAM-05 | Live view integration using MSE stream from go2rtc | Must Have | 28 |

### Proactive Alerts (ALERT)

| ID | Requirement | Priority | Phase |
|----|-------------|----------|-------|
| ALERT-01 | Event subscription service polling Frigate every 5 seconds | Must Have | 29 |
| ALERT-02 | Unknown person detection - identify person events without sub_label at entry cameras | Must Have | 29 |
| ALERT-03 | Dashboard notification component for proactive alerts with snapshot thumbnail | Must Have | 29 |
| ALERT-04 | 5-minute cooldown to prevent repeated alerts for same person | Must Have | 29 |
| ALERT-05 | Optional TTS announcement for unknown person alerts | Must Have | 29 |

---

## v2 Requirements (Deferred)

### Enhanced Face Management

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| FACE-v2-01 | Face enrollment from chat ("learn this face as John") | Nice to Have | Complex UX, requires image upload |
| FACE-v2-02 | Dashboard face gallery with stats (last seen, frequency) | Nice to Have | High complexity |
| FACE-v2-03 | Recognition accuracy feedback (mark misidentifications) | Nice to Have | Frigate API for corrections |

### Advanced Presence

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| PRES-v2-01 | Historical presence patterns ("John usually arrives at 6pm") | Nice to Have | Needs data collection |
| PRES-v2-02 | Guest tracking (visitors as separate category) | Nice to Have | Complex state management |
| PRES-v2-03 | Presence-based automations (lights on when arriving) | Nice to Have | Needs automation engine |

### Camera Enhancements

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| CAM-v2-01 | Multi-camera live grid (2x2 layout) | Nice to Have | Bandwidth concerns |
| CAM-v2-02 | Event timeline scrubber with visual markers | Nice to Have | High complexity |
| CAM-v2-03 | Full-screen camera view mode | Nice to Have | Low priority |

### Alert Enhancements

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| ALERT-v2-01 | MQTT subscription for real-time events (<100ms latency) | Should Have | Requires MQTT broker setup |
| ALERT-v2-02 | Alert preferences UI (per-event-type settings) | Nice to Have | Over-engineering for single user |
| ALERT-v2-03 | Silent hours configuration (no alerts 11pm-7am) | Nice to Have | Low priority |
| ALERT-v2-04 | Package detection alerts | Nice to Have | Depends on Frigate model support |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FACE-01 | Phase 26 | Pending |
| FACE-02 | Phase 26 | Pending |
| FACE-03 | Phase 26 | Pending |
| FACE-04 | Phase 26 | Pending |
| FACE-05 | Phase 26 | Pending |
| PRES-01 | Phase 27 | Pending |
| PRES-02 | Phase 27 | Pending |
| PRES-03 | Phase 27 | Pending |
| PRES-04 | Phase 27 | Pending |
| PRES-05 | Phase 27 | Pending |
| CAM-01 | Phase 28 | Pending |
| CAM-02 | Phase 28 | Pending |
| CAM-03 | Phase 28 | Pending |
| CAM-04 | Phase 28 | Pending |
| CAM-05 | Phase 28 | Pending |
| ALERT-01 | Phase 29 | Pending |
| ALERT-02 | Phase 29 | Pending |
| ALERT-03 | Phase 29 | Pending |
| ALERT-04 | Phase 29 | Pending |
| ALERT-05 | Phase 29 | Pending |

**Total v1 Requirements:** 20
**Coverage:** 20/20 mapped to phases

---

## Dependencies

### External Dependencies

| Dependency | Version | Status | Notes |
|------------|---------|--------|-------|
| Frigate NVR | 0.16.4 | Running | face_recognition available, currently disabled |
| go2rtc | built-in | Running | WebRTC/MSE streaming via Frigate |
| Home Assistant | - | Running | Device control layer (locks, etc.) |

### Internal Dependencies

| Dependency | Component | Status |
|------------|-----------|--------|
| frigate.ts client | jarvis-backend | Exists, needs extension |
| smarthome.ts tools | jarvis-backend | Exists (9 tools), needs 4 new tools |
| SQLite + Drizzle | jarvis-backend | Exists, needs schema extension |
| Socket.IO smarthome namespace | jarvis-backend | Exists, needs event emitter |
| CenterDisplay | jarvis-ui | Exists, needs new tab/panel |

---

## Acceptance Criteria

### Phase 26 Complete When:
- [ ] Frigate face recognition enabled (`model_size: small` in config)
- [ ] At least 1 face enrolled in Frigate Face Library
- [ ] `whos_at_door` tool returns recognized face name from recent event
- [ ] `get_unknown_visitors` tool returns person events without sub_label
- [ ] Chat query "Who's at the door?" produces correct response

### Phase 27 Complete When:
- [ ] presence_logs table created with Drizzle migration
- [ ] `get_who_is_home` returns combined presence signals
- [ ] Arrival/departure events logged to SQLite
- [ ] `get_presence_history` returns timestamped arrival/departure data
- [ ] System prompt includes current presence context

### Phase 28 Complete When:
- [ ] Dashboard shows camera snapshot grid (2 cameras)
- [ ] Clicking camera opens full-size snapshot modal
- [ ] EventList shows recent detections with face labels
- [ ] Events filterable by camera and object type
- [ ] Live view button opens MSE stream in modal

### Phase 29 Complete When:
- [ ] Unknown person at front_door triggers notification within 10s
- [ ] Notification shows snapshot thumbnail
- [ ] 5-minute cooldown prevents repeat alerts
- [ ] TTS announcement works when enabled
- [ ] "What happened while I was away?" returns event summary

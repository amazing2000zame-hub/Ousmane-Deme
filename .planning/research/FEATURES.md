# Feature Landscape: v1.6 Smart Home Intelligence

**Domain:** AI-powered smart home surveillance with face recognition and presence tracking
**Project:** Jarvis 3.1 -- v1.6 Smart Home Intelligence Milestone
**Researched:** 2026-01-29
**Target:** Give JARVIS eyes -- camera integration, face recognition, and presence tracking

---

## Existing Foundation (Already Built)

These features are live and define what the v1.6 features build upon:

| Component | Status | Notes |
|-----------|--------|-------|
| Frigate NVR integration | Working | 2 cameras (front_door, side_house), person/car/dog/cat detection |
| Frigate client (`frigate.ts`) | Working | Events, snapshots, config, stats APIs implemented |
| `get_who_is_home` MCP tool | Working | Network presence (arp-scan) + car detection from cameras |
| `query_nvr_detections` MCP tool | Working | Query events by camera, object type, time range |
| `get_camera_snapshot` MCP tool | Working | Retrieve latest JPEG from any camera |
| `scan_network_devices` MCP tool | Working | Raw network scan with known device annotation |
| Home Assistant client (`homeassistant.ts`) | Working | Thermostat, locks via HA API |
| Socket.IO real-time events | Working | 4 namespaces for dashboard updates |
| MCP tool safety tiers | Working | GREEN/YELLOW/RED/BLACK tier system |
| SQLite event logging | Working | All tool executions logged with timestamps |

### Infrastructure Available

| Resource | Details |
|----------|---------|
| Frigate NVR | http://192.168.1.61:5000, Frigate 0.16.x, face_recognition available but disabled |
| go2rtc | Built into Frigate, WebRTC/MSE streaming at port 8555/1984 |
| Cameras | front_door (192.168.1.204), side_house (192.168.1.27) via RTSP |
| Object detection | CPU-based TFLite, person/car/dog/cat tracked |
| Recording | 30-day retention, 60-day for alerts/detections |
| Snapshots | Enabled on both cameras, available via Frigate API |

---

## Feature Domain 1: Face Recognition

### How Frigate Face Recognition Works

Frigate 0.16+ includes built-in face recognition that runs locally on the system. Key characteristics:

- **Detection**: When a person is detected, Frigate extracts faces and runs recognition
- **Training**: Faces learned via UI upload (reference photos) or from detected events
- **Sub-labels**: Recognized faces get a `sub_label` field added to events (e.g., `sub_label: "John"`)
- **Models**: `small` (CPU FaceNet) or `large` (GPU ArcFace) -- our setup requires `small`
- **Storage**: Face data stored locally in `/media/frigate/clips/faces`
- **Privacy**: All processing local, no cloud transmission

Sources: [Frigate Face Recognition Docs](https://docs.frigate.video/configuration/face_recognition/)

### Must-Have (Table Stakes)

| Feature | Why Expected | Complexity | Implementation |
|---------|--------------|------------|----------------|
| Enable Frigate face recognition | Core capability for "who's at the door" queries | Low | Enable in `frigate.yml`, set `model_size: small` |
| Face enrollment via photo upload | User must be able to add known faces manually | Low | Use Frigate's built-in Face Library UI at `/face-library` |
| Query recognized faces from events | JARVIS needs to access sub_label data from Frigate events | Low | Already in `FrigateEvent.sub_label`, just use it |
| Unknown face detection | System must distinguish known vs unknown persons | Low | Events with `label: person` but `sub_label: null` are unknowns |
| Face database for 5-10 people | Household members, regular visitors | Low | Frigate stores faces locally, 20-30 images per person recommended |

### Should-Have (Differentiators)

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Camera-based face learning workflow | Learn faces from detected events without manual photo upload | Medium | Frigate Train tab -- detected faces appear, manually assign to person |
| "Who's at the door?" MCP tool | Natural language query for recognized faces at cameras | Low | Query recent person events with sub_labels, filter by camera zone |
| Face confidence thresholds | Configurable recognition certainty (default 0.9) | Low | `recognition_threshold` in Frigate config |
| Multi-face detection per frame | Handle multiple people in doorbell view | Low | Frigate handles this natively |
| Unknown face logging with snapshots | Store unknown faces for later review | Medium | Query events where `label=person` and `sub_label=null`, store thumbnails |

### Nice-to-Have

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Dashboard face gallery | Show known faces with stats (last seen, frequency) | High | New React component, query Frigate face library API |
| Face enrollment from chat | "JARVIS, learn this face as John" with uploaded image | High | New MCP tool, Frigate POST to face library |
| Recognition accuracy feedback | Allow marking misidentifications to improve model | Medium | Frigate API for face corrections |
| Face-based automations | Trigger actions when specific person detected | High | Requires event subscription + automation engine |

### Anti-Features to Avoid

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Cloud-based face recognition | Privacy violation, latency, internet dependency | Use Frigate's local face recognition only |
| Large model on CPU | ArcFace requires GPU, CPU inference too slow | Use `model_size: small` (FaceNet on CPU) |
| Real-time face tracking overlays | CPU-intensive, adds complexity, minimal value | Rely on event-based recognition, not frame-by-frame |
| Automatic face learning without consent | Privacy concern, may learn visitors unintentionally | Require manual confirmation in Train tab |
| Push notifications for every face | Notification fatigue | Log to timeline, alert only for unknowns when configured |

---

## Feature Domain 2: Presence Tracking

### How Smart Home Presence Detection Works

Presence detection answers "who is home right now?" using multiple signals:

- **Network presence**: Phone/device MAC addresses detected via arp-scan (already implemented)
- **Camera-based**: Cars in driveway, people detected at entry points
- **Face recognition**: Specific person identified by face (new in v1.6)
- **Zones**: Room-level presence using camera zones (front door, side of house, etc.)

The key insight: combine multiple signals for higher confidence. Phone on network + car in driveway + face at door = high confidence someone is home.

Sources: [Home Assistant Presence Detection](https://www.home-assistant.io/getting-started/presence-detection/), [Better Presence Detection](https://www.homeautomationguy.io/blog/home-assistant-tips/better-presence-detection-in-home-assistant)

### Must-Have (Table Stakes)

| Feature | Why Expected | Complexity | Implementation |
|---------|--------------|------------|----------------|
| Combined presence query | "Who's home?" uses network + camera + face signals | Medium | Enhance existing `get_who_is_home` tool with face recognition data |
| Arrival detection | Detect when someone arrives home | Medium | Person detected at entry camera, optionally with face |
| Departure detection | Detect when someone leaves | Medium | Car detection + phone leaving network |
| Current occupancy state | Real-time "at home" vs "away" per person | Medium | Track last seen time + signal combination |
| Camera-to-location mapping | Know "front_door" means entrance, "side_house" means driveway | Low | Config mapping of camera names to locations |

### Should-Have (Differentiators)

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Presence timeline/history | "When did John arrive yesterday?" searchable | High | Store presence events in SQLite with timestamps, query API |
| Room-level presence | Which camera area someone is in (not just home/away) | Medium | Track person events per camera zone |
| Presence event notifications | Socket.IO events when presence changes | Medium | Emit `presence:changed` events to dashboard |
| Presence context in chat | JARVIS knows who's home during conversation | Low | Include presence in system prompt context |
| Multi-person tracking | Track presence for each household member independently | Medium | Per-person state machine (home/away/unknown) |

### Nice-to-Have

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Historical presence patterns | "John usually arrives home at 6pm" | High | Analyze presence history, build patterns |
| Guest tracking | Track visitors separately from household members | High | Unknown faces as "guests" with temporary tracking |
| Presence-based automations | Lights on when first person arrives, off when last leaves | High | Automation engine integration |
| Bluetooth beacon support | More accurate room-level tracking | High | Requires ESP32 + ESPresense setup |

### Anti-Features to Avoid

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| GPS/location tracking | Privacy invasive, requires phone apps, works outside home | Focus on home-only detection via network/camera |
| Continuous polling for presence | Battery drain on devices, unnecessary API load | Event-driven: check on motion, on face detect |
| Binary home/away only | Loses useful context about who specifically | Per-person presence tracking |
| Presence without retention policy | Indefinite tracking raises privacy concerns | 30-day retention default, configurable |

---

## Feature Domain 3: Smart Home Awareness (Proactive Intelligence)

### How Proactive AI Assistants Work

Beyond responding to queries, JARVIS should proactively share relevant information:

- **Event awareness**: Know when cameras detect something interesting
- **Contextual announcements**: "Sir, someone is at the front door"
- **Alerting**: Unknown person detected, package arrived, etc.
- **Status updates**: "Everyone has left for the day"

Key principle: Proactive but not annoying. Alert on exceptions, not routine.

Sources: [ADT Familiar Face Detection](https://help.adt.com/s/article/adt-Smart-Home-Security-Familiar-Face-Detection), [Home Surveillance with Facial Recognition](https://github.com/BrandonJoffe/home_surveillance)

### Must-Have (Table Stakes)

| Feature | Why Expected | Complexity | Implementation |
|---------|--------------|------------|----------------|
| Camera event subscription | Backend receives Frigate events in real-time | Medium | Frigate MQTT or polling recent events |
| Person detection alerts | Know when a person is detected at cameras | Low | Filter events for `label: person` |
| "Who's at the door?" query | Natural language query about current camera activity | Low | MCP tool checking recent person events at door cameras |
| Event context in chat | JARVIS can reference recent detections in conversation | Low | Include recent events in system prompt |

### Should-Have (Differentiators)

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Unknown person alert | "Sir, there's someone I don't recognize at the front door" | Medium | Detect person + no sub_label + at entry camera |
| Proactive announcement | Unprompted notification when significant event occurs | High | WebSocket push to dashboard, optional TTS |
| Activity summary on demand | "What happened while I was away?" | Medium | Summarize events since last interaction |
| Package detection alert | "A package was delivered to the front door" | Medium | Detect `package` label events (if model supports) |
| Cooldown/debounce | Don't alert on same person every 5 seconds | Low | 5-minute cooldown per person per camera |

### Nice-to-Have

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Alert preferences | User configures what triggers notifications | High | Settings UI, per-event-type preferences |
| Silent hours | No proactive alerts between 11pm-7am | Low | Time-based filter on announcements |
| Alert escalation | Unknown person lingers > 2 min = higher priority | Medium | Track event duration, escalate logic |
| Integration with TTS | JARVIS speaks alerts aloud | Medium | Connect event detection to voice pipeline |

### Anti-Features to Avoid

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Alert on every motion | Notification fatigue | Only alert on person detection, with cooldown |
| Immediate unknown alerts | Too many false positives during training | Log unknowns to timeline, manual review |
| Forced TTS for all alerts | Disruptive, especially at night | Dashboard notification default, optional TTS |
| Real-time video streaming alerts | Bandwidth, privacy, complexity | Snapshot-based alerts with option to view live |

---

## Feature Domain 4: Camera Integration

### How Camera Dashboards Work

Modern NVR interfaces provide:

- **Live view**: Real-time camera feeds with low latency (MSE/WebRTC)
- **Multi-camera grid**: View multiple cameras simultaneously
- **Event timeline**: Scrub through events and recordings
- **Snapshot on demand**: Quick capture current frame

Frigate + go2rtc provides all the streaming infrastructure. The Jarvis dashboard needs to surface it.

Sources: [Frigate Live View](https://docs.frigate.video/configuration/live/), [go2rtc](https://go2rtc.com/), [Camera.UI](https://github.com/seydx/camera.ui)

### Must-Have (Table Stakes)

| Feature | Why Expected | Complexity | Implementation |
|---------|--------------|------------|----------------|
| Camera list in dashboard | Show available cameras | Low | Query Frigate `/api/config` for camera list |
| Snapshot display | Show latest frame from each camera | Low | Fetch `/api/{camera}/latest.jpg`, display in UI |
| Event history view | See recent detections with timestamps | Medium | Query Frigate events API, display list |
| Event snapshot/thumbnail | View image for each detection event | Low | Frigate provides `/events/{id}/snapshot.jpg` |

### Should-Have (Differentiators)

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Live camera feed | Real-time video stream in dashboard | High | go2rtc MSE/WebRTC via `/api/{camera}/live` |
| Multi-camera dashboard panel | 2x2 or 2x1 grid view of all cameras | Medium | React component with video elements |
| Click event to view recording | Navigate from event to recorded clip | Medium | Frigate recording API, video player |
| Camera status indicators | Show if camera is online, recording, detecting | Low | Query Frigate stats API |

### Nice-to-Have

| Feature | Value Proposition | Complexity | Implementation |
|---------|-------------------|------------|----------------|
| Full-screen camera view | Expand single camera to full panel | Low | React modal/overlay |
| Event timeline scrubber | Visual timeline with event markers | High | Custom React component with Frigate recordings API |
| PTZ controls | Pan/tilt/zoom for supported cameras | High | ONVIF integration (cameras may not support) |
| Camera-specific MCP tools | "Show me the front door camera" | Low | Tool that returns camera URL/snapshot |

### Anti-Features to Avoid

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| HLS streaming in dashboard | Higher latency (2-10s vs <1s for WebRTC) | Use MSE or WebRTC via go2rtc |
| Always-on multiple live feeds | Bandwidth, CPU load, battery | Snapshot grid default, live on-demand |
| Custom RTSP player | Reinventing wheel, browser compatibility | Use Frigate's go2rtc streaming |
| Recording management UI | Frigate already has this | Link to Frigate UI for advanced features |

---

## Feature Dependencies

```
Feature Domain 1 (Face Recognition)
    |
    +--> Enable face recognition in Frigate config
    +--> Train faces via Frigate UI or photo upload
    |
    v
Feature Domain 2 (Presence Tracking)
    |
    +--> Depends on face recognition for per-person tracking
    +--> Combines with existing network presence
    |
    v
Feature Domain 3 (Smart Home Awareness)
    |
    +--> Depends on face recognition for "unknown person" alerts
    +--> Depends on presence for "who's home" context
    |
    v
Feature Domain 4 (Camera Integration)
    |
    +--> Depends on all above for meaningful dashboard
    +--> Can be done in parallel with basic features
```

Build order recommendation:
1. **Phase 1**: Enable Frigate face recognition + basic face MCP tools
2. **Phase 2**: Presence tracking with face + timeline storage
3. **Phase 3**: Dashboard camera panel + event viewing
4. **Phase 4**: Proactive alerts + announcements

---

## MVP Recommendation

For a focused v1.6 release, prioritize by impact-to-effort ratio:

### Phase 1: Face Recognition Foundation (Days 1-3)

1. **Enable Frigate face recognition** -- Config change, immediate capability
2. **"Who's at the door?" MCP tool** -- Query person events with face sub_labels
3. **Face enrollment documentation** -- Guide users to Frigate Face Library UI
4. **Unknown face query** -- Find person events without recognized faces

### Phase 2: Presence Intelligence (Days 4-6)

4. **Enhanced `get_who_is_home`** -- Add face recognition to presence signals
5. **Presence event logging** -- Store arrivals/departures in SQLite
6. **Presence timeline query** -- "When did X arrive/leave?" MCP tool
7. **Presence context in system prompt** -- JARVIS knows who's home

### Phase 3: Camera Dashboard (Days 7-9)

8. **Dashboard camera panel** -- Snapshot grid for all cameras
9. **Event list component** -- Recent detections with thumbnails
10. **Click to view event snapshot** -- Modal with full-size image
11. **Live view (single camera)** -- MSE stream for one camera at a time

### Phase 4: Proactive Intelligence (Days 10-12)

12. **Event subscription** -- Backend polls/subscribes to Frigate events
13. **Unknown person detection** -- Identify unrecognized faces at entry
14. **Dashboard notification** -- Push events to UI via Socket.IO
15. **Optional TTS announcement** -- "Sir, someone is at the door"

### Defer to Future (v1.7+)

- Face enrollment from chat (complex UX)
- Historical presence patterns (needs data collection)
- Presence-based automations (needs automation engine)
- Multi-camera live grid (bandwidth, complexity)
- PTZ camera controls (hardware dependent)
- Alert preferences UI (over-engineering for single user)

---

## Technical Constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| CPU-only inference | Face recognition must use `small` model | FaceNet is adequate for 5-10 faces |
| Frigate 0.16 required | Face recognition only available in recent versions | Already running 0.16.4 |
| No MQTT on Frigate | Need alternative event subscription | Poll recent events or enable MQTT |
| Single user system | Can skip multi-user permissions | Simplify implementation |
| LAN-only access | No remote viewing concern | All traffic local |
| 2 cameras only | Limited coverage | Sufficient for POC, expand later |

---

## Confidence Assessment

| Domain | Confidence | Rationale |
|--------|------------|-----------|
| Face Recognition | HIGH | Frigate docs comprehensive, feature exists in current version |
| Presence Tracking | HIGH | Combines existing tools with face data, well-understood pattern |
| Smart Home Awareness | MEDIUM | Event subscription method needs verification (MQTT vs polling) |
| Camera Integration | HIGH | go2rtc well-documented, MSE widely supported |
| Dashboard UI | MEDIUM | React components straightforward, but go2rtc integration needs testing |

---

## Sources

### Face Recognition
- [Frigate Face Recognition Docs](https://docs.frigate.video/configuration/face_recognition/) - Official configuration guide
- [Microsoft Face Enrollment Best Practices](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/enrollment-overview) - UX principles
- [Frigate Third Party Extensions](https://docs.frigate.video/integrations/third_party_extensions/) - Double Take for advanced face workflows

### Presence Detection
- [Home Assistant Presence Detection](https://www.home-assistant.io/getting-started/presence-detection/) - Zone and device tracking
- [Better Presence Detection Guide](https://www.homeautomationguy.io/blog/home-assistant-tips/better-presence-detection-in-home-assistant) - Multi-signal approach
- [Best Presence Sensors 2026](https://spicehometech.com/product-reviews/motion-sensors/best-presence-sensors/) - mmWave comparison

### Camera Integration
- [Frigate HTTP API](https://docs.frigate.video/integrations/api/frigate-http-api/) - Events, snapshots, recordings
- [Frigate Live View](https://docs.frigate.video/configuration/live/) - MSE/WebRTC configuration
- [Configuring go2rtc](https://docs.frigate.video/guides/configuring_go2rtc/) - Streaming setup
- [go2rtc GitHub](https://github.com/AlexxIT/go2rtc) - WebRTC/MSE streaming

### Privacy & Security
- [Privacy-Preserving Face Recognition Survey](https://dl.acm.org/doi/full/10.1145/3673224) - Academic overview
- [FTC Face Recognition Best Practices](https://www.ftc.gov/sites/default/files/documents/reports/facing-facts-best-practices-common-uses-facial-recognition-technologies/121022facialtechrpt.pdf) - Regulatory guidance
- [ADT Familiar Face Detection](https://help.adt.com/s/article/adt-Smart-Home-Security-Familiar-Face-Detection) - Consumer product UX patterns

### Unknown Person Alerts
- [Home Assistant Unknown Person Alert](https://community.home-assistant.io/t/alert-for-unknown-person-detected-not-a-household-member/749531) - Community implementation
- [Home Surveillance with Face Recognition](https://github.com/BrandonJoffe/home_surveillance) - Open source reference

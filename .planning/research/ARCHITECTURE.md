# Architecture Patterns: Jarvis v1.6 Smart Home Intelligence

**Domain:** Smart home AI assistant with face recognition and presence detection
**Researched:** 2026-01-29
**Confidence:** HIGH (verified with running systems and official docs)

## Executive Summary

The architecture recommendation is to **leverage Frigate's native face recognition** (v0.16+) rather than implementing separate face recognition in Jarvis. Frigate 0.16.4 is already running on agent1 with face recognition configured (though disabled). The integration pattern should be:

1. **Frigate** handles all face detection, recognition, and event storage
2. **Jarvis Backend** polls/subscribes to Frigate for events and manages automation logic
3. **Home Assistant** remains the device control layer (locks, lights, etc.)
4. **SQLite** stores presence logs, face metadata, and user-face mappings

This avoids duplicating ML inference, leverages battle-tested computer vision, and integrates cleanly with the existing Jarvis architecture.

---

## Recommended Architecture

```
+------------------+     MQTT/HTTP      +------------------+
|                  |<------------------>|                  |
|     FRIGATE      |                    |  JARVIS BACKEND  |
|   (agent1:5000)  |                    |   (Home:4000)    |
|                  |                    |                  |
| - Object detect  |    frigate/events  | - Event consumer |
| - Face recognize | -----------------> | - Presence logic |
| - Sub-label mgmt |                    | - Automation     |
| - Clip/snapshot  |    HTTP API        | - MCP tools      |
|                  | <----------------- | - WebSocket emit |
+------------------+                    +------------------+
        |                                        |
        | Camera streams                         | WebSocket
        v                                        v
+------------------+                    +------------------+
|    CAMERAS       |                    |   JARVIS UI      |
| (RTSP streams)   |                    |   (Home:3004)    |
+------------------+                    +------------------+
                                                 |
                                                 | User
        +------------------+                     | interactions
        |                  |                     v
        | HOME ASSISTANT   |<-------------- +----------+
        |  (agent1:8123)   |   Lock/unlock  |   USER   |
        |                  |   commands     +----------+
        | - Ecobee         |
        | - Smart locks    |
        | - Lights/sensors |
        +------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Frigate NVR | Object detection, face recognition, video storage, MQTT events | Cameras (RTSP), Jarvis (MQTT/HTTP) |
| Jarvis Backend | Event processing, presence logic, MCP tools, WebSocket | Frigate (HTTP), HA (HTTP), UI (WS) |
| Jarvis UI | Real-time display, notifications, face library management | Backend (WebSocket/REST) |
| Home Assistant | Device control (locks, HVAC, lights) | Jarvis (REST API) |
| SQLite | Presence logs, face metadata, user mappings | Jarvis Backend only |

---

## Data Flow

### Face Recognition Event Flow

```
Camera RTSP Stream
       |
       v
+------+-------+
| Frigate      |
| 1. Detect    |  <-- person object detected
|    person    |
| 2. Extract   |  <-- face cropped from frame
|    face      |
| 3. Generate  |  <-- 128-dim embedding via FaceNet/ArcFace
|    embedding |
| 4. Match     |  <-- compare to known face library
|    against   |
|    library   |
| 5. Assign    |  <-- sub_label = "John" (if match >= threshold)
|    sub_label |
+------+-------+
       |
       | MQTT: frigate/events
       | {
       |   "type": "update",
       |   "after": {
       |     "id": "1706540400.12345-abc",
       |     "label": "person",
       |     "sub_label": ["John", 0.92],
       |     "camera": "front_door",
       |     "start_time": 1706540400.12345
       |   }
       | }
       v
+------+-------+
| Jarvis       |
| Backend      |
| 1. Receive   |  <-- MQTT subscription or HTTP poll
|    event     |
| 2. Validate  |  <-- confidence >= threshold?
|    match     |
| 3. Log       |  <-- SQLite: presence_logs table
|    presence  |
| 4. Evaluate  |  <-- Is automation triggered?
|    rules     |
| 5. Execute   |  <-- Call Home Assistant API
|    action    |
| 6. Emit      |  <-- WebSocket to UI
|    event     |
+------+-------+
       |
       | WebSocket: smarthome namespace
       | {
       |   "event": "face_recognized",
       |   "person": "John",
       |   "camera": "front_door",
       |   "confidence": 0.92,
       |   "time": "2026-01-29T10:00:00Z"
       | }
       v
+------+-------+
| Jarvis UI    |
| 1. Display   |  <-- Notification toast
|    alert     |
| 2. Update    |  <-- Presence panel
|    presence  |
+------+-------+
```

### Latency Requirements

| Step | Target Latency | Notes |
|------|----------------|-------|
| Camera -> Frigate detection | < 500ms | Depends on frame rate, detection FPS |
| Face recognition | < 1s | Small model (CPU) ~500ms, Large model (GPU) ~200ms |
| Frigate -> Jarvis event | < 100ms | MQTT or HTTP poll interval |
| Presence logic evaluation | < 50ms | In-memory rules, simple conditions |
| HA action execution | < 500ms | REST API call + device response |
| WebSocket emit to UI | < 50ms | Local network |
| **Total end-to-end** | **< 2.5s** | From face visible to UI notification |

---

## Integration Patterns

### Pattern 1: MQTT Subscription (Recommended)

**What:** Jarvis subscribes to Frigate's MQTT topics for real-time events.

**When:** Primary integration method for low-latency event handling.

**Architecture:**
```
                    MQTT Broker
                   (Mosquitto)
                        |
        +---------------+---------------+
        |                               |
   Subscribe to:                   Publishes to:
   frigate/events                  frigate/events
   frigate/+/person/+              frigate/+/+/+
        |                               |
        v                               |
+---------------+               +---------------+
| Jarvis Backend|               |    Frigate    |
+---------------+               +---------------+
```

**Implementation:**
```typescript
// src/clients/mqtt.ts
import mqtt from 'mqtt';

const client = mqtt.connect(config.mqttBroker);

client.subscribe('frigate/events');

client.on('message', (topic, payload) => {
  const event = JSON.parse(payload.toString());
  if (event.after?.sub_label?.[0]) {
    // Face recognized
    handleFaceRecognition(event);
  }
});
```

**Pros:**
- Real-time (< 100ms latency)
- Native Frigate integration
- Decoupled architecture

**Cons:**
- Requires MQTT broker setup
- Additional dependency

### Pattern 2: HTTP Polling (Simpler Alternative)

**What:** Jarvis polls Frigate's REST API for recent events.

**When:** Fallback when MQTT is not available, or for non-critical updates.

**Implementation:**
```typescript
// Poll every 5 seconds for recent person events
setInterval(async () => {
  const events = await frigate.getEvents({
    label: 'person',
    after: lastPollTime,
    has_snapshot: true,
  });

  for (const event of events) {
    if (event.sub_label) {
      handleFaceRecognition(event);
    }
  }
  lastPollTime = Date.now() / 1000;
}, 5000);
```

**Pros:**
- No MQTT dependency
- Already implemented in Jarvis (`frigate.ts` client)

**Cons:**
- Higher latency (poll interval)
- More API calls

### Pattern 3: Hybrid (Recommended for Production)

**What:** MQTT for real-time events, HTTP for historical queries and face management.

**When:** Best of both worlds for production deployment.

**Implementation:**
```
Real-time events:     MQTT frigate/events
Face library mgmt:    HTTP /api/faces/*
Event history:        HTTP /api/events
Snapshots:            HTTP /api/{camera}/latest.jpg
```

---

## Storage Architecture

### Option A: SQLite Extension (Recommended)

Extend existing Jarvis SQLite database with smart home tables.

```sql
-- Face library metadata (Frigate stores actual embeddings)
CREATE TABLE faces (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  frigate_id TEXT,  -- Maps to Frigate face library folder
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  image_count INTEGER DEFAULT 0,
  notes TEXT
);

-- Presence logs
CREATE TABLE presence_logs (
  id INTEGER PRIMARY KEY,
  person TEXT NOT NULL,  -- FK to faces.name or 'unknown'
  camera TEXT NOT NULL,
  event_id TEXT NOT NULL,  -- Frigate event ID
  confidence REAL NOT NULL,
  timestamp TEXT NOT NULL,
  snapshot_path TEXT,
  INDEX idx_presence_time (timestamp),
  INDEX idx_presence_person (person)
);

-- Automation rules
CREATE TABLE automation_rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,  -- 'face_recognized', 'person_detected', etc.
  trigger_config TEXT NOT NULL,  -- JSON: {person: 'John', camera: 'front_door'}
  action_type TEXT NOT NULL,  -- 'unlock_door', 'notify', 'set_thermostat'
  action_config TEXT NOT NULL,  -- JSON: {lock_entity: 'lock.front_door'}
  enabled INTEGER DEFAULT 1,
  cooldown_seconds INTEGER DEFAULT 300,
  last_triggered_at TEXT
);
```

**Rationale:**
- Consistent with existing Jarvis data patterns
- Single database to backup
- Drizzle ORM already configured
- No additional dependencies

### Option B: Separate Face Database

Store face embeddings locally for custom recognition (NOT recommended).

**Reasons to avoid:**
- Frigate already handles this better
- Duplicates ML inference work
- More complexity, less accuracy
- face-api.js has known Node.js compatibility issues

---

## API Design

### New REST Endpoints

```
Presence & Recognition
----------------------
GET  /api/smarthome/presence         # Current presence status
GET  /api/smarthome/presence/history # Recent presence logs
POST /api/smarthome/presence/devices # Configure presence devices

Face Library (proxies to Frigate)
---------------------------------
GET    /api/smarthome/faces          # List all faces
GET    /api/smarthome/faces/:name    # Get face details
POST   /api/smarthome/faces/:name    # Add/update face
DELETE /api/smarthome/faces/:name    # Remove face
POST   /api/smarthome/faces/train    # Trigger Frigate retraining

Automation Rules
----------------
GET    /api/smarthome/rules          # List automation rules
POST   /api/smarthome/rules          # Create rule
PUT    /api/smarthome/rules/:id      # Update rule
DELETE /api/smarthome/rules/:id      # Delete rule

Camera Feeds
------------
GET /api/smarthome/cameras           # List cameras
GET /api/smarthome/cameras/:name/snapshot  # Current frame
```

### New WebSocket Events (smarthome namespace)

```typescript
// Client subscribes to /smarthome namespace
// Events emitted:

interface FaceRecognizedEvent {
  event: 'face_recognized';
  person: string;          // Face name or 'unknown'
  camera: string;
  confidence: number;      // 0-1
  timestamp: string;       // ISO 8601
  eventId: string;         // Frigate event ID
  snapshotUrl: string;     // /api/frigate/snapshot/...
}

interface PresenceChangedEvent {
  event: 'presence_changed';
  person: string;
  status: 'arrived' | 'departed';
  method: 'face' | 'network' | 'vehicle';
  timestamp: string;
}

interface AutomationTriggeredEvent {
  event: 'automation_triggered';
  ruleName: string;
  trigger: object;
  action: object;
  result: 'success' | 'failed';
  timestamp: string;
}
```

### New MCP Tools

Add to existing `smarthome.ts`:

```typescript
// 10. manage_face_library -- add/remove known faces
server.tool(
  'manage_face_library',
  'Add, remove, or list faces in the recognition library',
  {
    action: z.enum(['list', 'add', 'remove', 'retrain']),
    name: z.string().optional(),
    imageUrl: z.string().optional(),  // For 'add' action
  },
  async ({ action, name, imageUrl }) => { ... }
);

// 11. get_presence_history -- query presence logs
server.tool(
  'get_presence_history',
  'Get presence detection history for a person or time period',
  {
    person: z.string().optional(),
    since: z.string().optional(),  // ISO timestamp
    limit: z.number().optional(),
  },
  async ({ person, since, limit }) => { ... }
);

// 12. create_automation_rule -- set up face-based automations
server.tool(
  'create_automation_rule',
  'Create an automation rule triggered by presence or face recognition',
  {
    name: z.string(),
    triggerType: z.enum(['face_recognized', 'person_detected', 'presence_change']),
    triggerConfig: z.object({}).passthrough(),
    actionType: z.enum(['unlock_door', 'lock_door', 'notify', 'set_thermostat']),
    actionConfig: z.object({}).passthrough(),
  },
  async (params) => { ... }
);
```

---

## Component Diagrams

### System Context

```
+-------------------------------------------------------------------+
|                         JARVIS SYSTEM                              |
+-------------------------------------------------------------------+
|                                                                   |
|  +-------------+     +-------------+     +-------------+          |
|  |   FRIGATE   |     |   JARVIS    |     |  JARVIS UI  |          |
|  |    NVR      |     |   BACKEND   |     |   (React)   |          |
|  |  agent1     |     |    Home     |     |    Home     |          |
|  |   :5000     |     |   :4000     |     |   :3004     |          |
|  +------+------+     +------+------+     +------+------+          |
|         |                   |                   |                  |
|         |     HTTP/MQTT     |     WebSocket     |                  |
|         +--------+----------+---------+---------+                  |
|                  |                    |                            |
+------------------|--------------------|-+                          |
                   |                    |                            |
+------------------v---------+   +------v-----------+                |
|      HOME ASSISTANT        |   |      USER        |                |
|        (LXC 303)           |   | (Browser/Mobile) |                |
|        agent1:8123         |   +------------------+                |
+----------------------------+                                       |
```

### Backend Module Structure

```
jarvis-backend/src/
+-- clients/
|   +-- frigate.ts          # [EXISTING] HTTP client for Frigate API
|   +-- homeassistant.ts    # [EXISTING] HTTP client for HA API
|   +-- mqtt.ts             # [NEW] MQTT client for event subscription
|
+-- smarthome/
|   +-- presence.ts         # [NEW] Presence detection logic
|   +-- face-manager.ts     # [NEW] Face library management
|   +-- automation.ts       # [NEW] Rule evaluation engine
|   +-- events.ts           # [NEW] Event processing from Frigate
|
+-- mcp/tools/
|   +-- smarthome.ts        # [EXISTING] MCP tools (extend with new tools)
|
+-- realtime/
|   +-- smarthome-emitter.ts  # [NEW] WebSocket emitter for smarthome namespace
|
+-- db/
|   +-- schema.ts           # [MODIFY] Add faces, presence_logs, rules tables
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Local Face Recognition in Jarvis

**What:** Running face-api.js or TensorFlow.js in Jarvis backend for face recognition.

**Why bad:**
- Duplicates Frigate's work
- face-api.js has known Node.js version issues
- Increases backend CPU/memory usage
- Frigate already has optimized models (FaceNet, ArcFace)

**Instead:** Use Frigate's native face recognition via its API.

### Anti-Pattern 2: Direct Camera Access from Jarvis

**What:** Jarvis backend pulling RTSP streams directly from cameras.

**Why bad:**
- Duplicates Frigate's stream processing
- High bandwidth usage
- Complex to manage multiple camera feeds
- No object detection context

**Instead:** Request snapshots from Frigate which provides cropped, annotated images.

### Anti-Pattern 3: Polling Frigate for Every Frame

**What:** High-frequency polling (< 1s) of Frigate API for new events.

**Why bad:**
- Wastes resources
- Adds latency vs MQTT
- Can overwhelm Frigate API

**Instead:** Use MQTT subscription or reasonable poll interval (5-10s).

### Anti-Pattern 4: Storing Face Embeddings in Jarvis

**What:** Duplicating Frigate's face library in Jarvis SQLite.

**Why bad:**
- Sync complexity between two systems
- Frigate manages embeddings better
- Version mismatch issues

**Instead:** Jarvis stores metadata only (name, timestamps, notes). Frigate stores embeddings.

---

## Hardware Considerations

### Current Resources

| Node | Available for Smart Home | Notes |
|------|-------------------------|-------|
| Home (192.168.1.50) | 8-10 threads, 8GB RAM | Jarvis backend runs here |
| agent1 (192.168.1.61) | N/A | Frigate already using resources |

### Frigate Face Recognition Resource Impact

| Model | CPU Impact | GPU Required | Accuracy |
|-------|-----------|--------------|----------|
| small (FaceNet) | +5-10% per recognition | No | Good for home use |
| large (ArcFace) | +2-5% | Yes (iGPU OK) | Better for large libraries |

**Recommendation:** Start with `small` model. Home node has no GPU, but agent1 might have iGPU for future upgrade.

### MQTT Broker Options

1. **Run on existing node:** Mosquitto on Home or agent1
2. **HA Add-on:** Home Assistant can run MQTT broker
3. **Standalone container:** Lightweight, runs anywhere

**Recommendation:** Use Home Assistant's MQTT broker if HA is already configured with MQTT, otherwise run Mosquitto on agent1 alongside Frigate.

---

## Scalability Considerations

| Concern | Current (4 cameras) | 10 cameras | 20+ cameras |
|---------|---------------------|------------|-------------|
| Frigate events/min | ~20-50 | ~100-200 | Consider dedicated NVR |
| Face recognitions/min | ~5-10 | ~20-50 | Large model + GPU |
| SQLite writes/min | ~50 | ~200 | Consider PostgreSQL |
| WebSocket clients | ~2-3 | ~5-10 | No changes needed |

### Migration Path for Scale

1. **Current:** SQLite, HTTP polling, single backend
2. **Medium:** MQTT, face recognition enabled, rule engine
3. **Large:** PostgreSQL, dedicated Frigate hardware, clustering

---

## Security Considerations

### Face Data Privacy

- Face embeddings stored only in Frigate's `/media/frigate/clips/faces/`
- Jarvis stores only name mappings, not biometric data
- Access controlled via existing Jarvis JWT auth

### Automation Safety

- Door unlock automations should require high confidence (>= 0.9)
- Cooldown periods prevent rapid repeated triggers
- Audit log for all automation executions
- Override key required for RED tier actions (unlock)

### Network Security

- Frigate API is unauthenticated by default (internal network only)
- Consider reverse proxy with auth for external access
- MQTT should use TLS in production

---

## Sources

- [Frigate Face Recognition Documentation](https://docs.frigate.video/configuration/face_recognition/) - Configuration and setup guide
- [Frigate MQTT Integration](https://docs.frigate.video/integrations/mqtt/) - Event topic structure
- [Frigate HTTP API](https://docs.frigate.video/integrations/api/frigate-http-api/) - REST endpoint reference
- [Double Take GitHub](https://github.com/jakowenko/double-take) - Alternative face recognition UI
- [Frigate Third-Party Extensions](https://docs.frigate.video/integrations/third_party_extensions/) - Integration options
- Verified: Frigate 0.16.4 running on agent1:5000 with face_recognition config present
- Verified: Home Assistant on agent1 LXC 303 at 192.168.1.54:8123
- Verified: Existing Jarvis client implementations in `/root/jarvis-backend/src/clients/`

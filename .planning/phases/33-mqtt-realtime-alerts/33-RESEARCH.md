# Phase 33: MQTT Real-Time Alerts - Research

## Current State
- AlertMonitor polls Frigate REST API every 5 seconds
- Average latency: ~5000ms
- Frigate MQTT is DISABLED in config
- No MQTT broker on cluster

## Target State
- MQTT subscription for instant event notifications
- Target latency: <100ms
- Graceful fallback to REST API if MQTT fails

## Infrastructure Needed

### 1. Mosquitto MQTT Broker
- Deploy on agent1 (192.168.1.61) where Frigate runs
- Docker container: eclipse-mosquitto:latest
- Ports: 1883 (MQTT), 9001 (WebSocket)
- Authentication required

### 2. Frigate MQTT Configuration
Location: /opt/frigate/config/config.yml
```yaml
mqtt:
  enabled: true
  host: 192.168.1.61
  port: 1883
  topic_prefix: frigate
  client_id: frigate
  user: frigate
  password: <password>
```

### 3. Jarvis Backend
- Add `mqtt` package dependency
- Create MQTTAlertService alongside REST AlertMonitor
- Subscribe to `frigate/events` topic
- Process `type: "new"` events with `label: "person"`

## MQTT Topics

| Topic | Purpose |
|-------|---------|
| frigate/events | Main detection events (new/update/end) |
| frigate/available | Frigate online/offline status |
| frigate/{camera}/motion | Per-camera motion state |

## Event Payload Structure
```json
{
  "type": "new",
  "after": {
    "id": "event_id",
    "camera": "front_door",
    "label": "person",
    "sub_label": null,
    "score": 0.85,
    "start_time": 1704067200,
    "has_snapshot": true
  }
}
```

## Implementation Plan
1. Deploy Mosquitto on agent1
2. Enable MQTT in Frigate config
3. Add mqtt package to jarvis-backend
4. Create MQTTAlertService with subscription
5. Test latency improvement

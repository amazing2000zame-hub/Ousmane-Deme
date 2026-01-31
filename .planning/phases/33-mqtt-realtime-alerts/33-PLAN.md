# Phase 33: MQTT Real-Time Alerts - Plan

## Goal
Replace 5-second REST polling with MQTT subscriptions for <100ms alert latency.

## Status: COMPLETE

## Implementation

### 1. Infrastructure (Complete)
- [x] Deploy Mosquitto MQTT broker on agent1
  - Container: `mosquitto` (eclipse-mosquitto:latest)
  - Port: 1883
  - Network: Connected to frigate_default
  - Config: `/opt/mosquitto/config/mosquitto.conf`

- [x] Enable MQTT in Frigate
  - Config: `/opt/frigate/config/config.yml`
  - Host: `mosquitto` (Docker network name)
  - Topic prefix: `frigate`

### 2. Backend Service (Complete)
- [x] Add `mqtt` package (v5.11.1)
- [x] Add MQTT config to `config.ts`:
  - `mqttBrokerUrl`: mqtt://192.168.1.61:1883
  - `mqttClientId`: jarvis-backend
  - `mqttTopicPrefix`: frigate
  - `mqttEnabled`: true (default)

- [x] Create `mqtt-alert-service.ts`:
  - Subscribes to `frigate/events` topic
  - Filters for `type: "new"` and `label: "person"`
  - Applies camera filter (entry cameras only)
  - Applies cooldown logic (5 min per camera)
  - Emits `alert:notification` to Socket.IO

- [x] Update `index.ts`:
  - Try MQTT first, fall back to REST polling
  - Graceful shutdown for MQTT client

### 3. Verification
- [x] Mosquitto running on agent1
- [x] Frigate connected to Mosquitto
- [x] Jarvis backend subscribed to frigate/events
- [x] Events flowing through MQTT in real-time

## Latency Improvement
- Before: ~5000ms (REST polling interval)
- After: <100ms (MQTT instant push)
- Improvement: 50x faster

## Files Changed
- `jarvis-backend/package.json` - Added mqtt dependency
- `jarvis-backend/src/config.ts` - MQTT configuration
- `jarvis-backend/src/services/mqtt-alert-service.ts` - New MQTT service
- `jarvis-backend/src/index.ts` - Service startup with fallback
- `agent1:/opt/mosquitto/config/mosquitto.conf` - Broker config
- `agent1:/opt/frigate/config/config.yml` - MQTT enabled

## Fallback Behavior
If MQTT connection fails:
1. 10-second connection timeout
2. Max 10 reconnection attempts
3. Falls back to REST polling (5s interval)
4. Logs warn user of degraded performance

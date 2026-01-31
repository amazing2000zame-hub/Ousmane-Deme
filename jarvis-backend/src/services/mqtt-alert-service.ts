/**
 * MQTT Alert Service - Phase 33
 *
 * Subscribes to Frigate MQTT events for real-time alerts.
 * Replaces REST polling (5s latency) with instant MQTT notifications (<100ms).
 *
 * Falls back to REST polling if MQTT connection fails.
 */

import mqtt, { type MqttClient } from 'mqtt';
import type { Namespace } from 'socket.io';
import { config } from '../config.js';

// Cooldown map: key = `${camera}:person`, value = expiration timestamp (ms)
const cooldowns = new Map<string, number>();

// MQTT client state
let client: MqttClient | null = null;
let eventsNamespace: Namespace | null = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Frigate MQTT event payload structure.
 */
interface FrigateEventPayload {
  type: 'new' | 'update' | 'end';
  before?: FrigateEventData;
  after: FrigateEventData;
}

interface FrigateEventData {
  id: string;
  camera: string;
  label: string;
  sub_label: string | null;
  score: number;
  start_time: number;
  end_time: number | null;
  has_snapshot: boolean;
  has_clip: boolean;
  current_zones: string[];
}

/**
 * Process a Frigate MQTT event.
 */
function processEvent(payload: FrigateEventPayload): void {
  // Only process new events
  if (payload.type !== 'new') {
    return;
  }

  const event = payload.after;

  // Only process person detections
  if (event.label !== 'person') {
    return;
  }

  // Skip if not an entry camera
  if (!config.alertEntryCameras.includes(event.camera)) {
    return;
  }

  // Skip if face is recognized (sub_label is not null)
  if (event.sub_label !== null) {
    console.log(`[MQTT Alert] Recognized person at ${event.camera}: ${event.sub_label}`);
    return;
  }

  const cooldownKey = `${event.camera}:person`;
  const now = Date.now();

  // Check cooldown
  const cooldownExpiry = cooldowns.get(cooldownKey);
  if (cooldownExpiry && now < cooldownExpiry) {
    console.log(`[MQTT Alert] Skipping ${event.camera} - on cooldown`);
    return;
  }

  // Set new cooldown
  cooldowns.set(cooldownKey, now + config.alertCooldownMs);

  // Emit notification
  const notification = {
    id: event.id,
    type: 'unknown_person' as const,
    camera: event.camera,
    timestamp: event.start_time,
    thumbnailUrl: `/api/events/${event.id}/thumbnail`,
    snapshotUrl: `/api/events/${event.id}/snapshot`,
    message: `Unknown person detected at ${event.camera.replace(/_/g, ' ')}`,
  };

  console.log(`[MQTT Alert] Unknown person at ${event.camera} (event ${event.id})`);
  eventsNamespace?.emit('alert:notification', notification);

  // Clean up expired cooldowns
  for (const [key, expiry] of cooldowns) {
    if (now >= expiry) {
      cooldowns.delete(key);
    }
  }
}

/**
 * Start the MQTT alert service.
 * Returns true if connected successfully, false otherwise.
 */
export async function startMqttAlertService(eventsNs: Namespace): Promise<boolean> {
  if (!config.mqttEnabled) {
    console.log('[MQTT Alert] Disabled via config');
    return false;
  }

  if (client) {
    console.warn('[MQTT Alert] Already running');
    return isConnected;
  }

  eventsNamespace = eventsNs;

  return new Promise((resolve) => {
    const topic = `${config.mqttTopicPrefix}/events`;

    console.log(`[MQTT Alert] Connecting to ${config.mqttBrokerUrl}...`);

    client = mqtt.connect(config.mqttBrokerUrl, {
      clientId: config.mqttClientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 5000,
    });

    const connectionTimeout = setTimeout(() => {
      if (!isConnected) {
        console.warn('[MQTT Alert] Connection timeout - falling back to REST polling');
        resolve(false);
      }
    }, 10000);

    client.on('connect', () => {
      clearTimeout(connectionTimeout);
      isConnected = true;
      reconnectAttempts = 0;
      console.log('[MQTT Alert] Connected to broker');

      client!.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT Alert] Failed to subscribe to ${topic}:`, err.message);
          resolve(false);
          return;
        }
        console.log(`[MQTT Alert] Subscribed to ${topic}`);
        console.log(`[MQTT Alert] Entry cameras: ${config.alertEntryCameras.join(', ')}`);
        console.log(`[MQTT Alert] Cooldown: ${config.alertCooldownMs / 1000}s`);
        resolve(true);
      });
    });

    client.on('message', (_topic, message) => {
      try {
        const payload = JSON.parse(message.toString()) as FrigateEventPayload;
        processEvent(payload);
      } catch (err) {
        console.error('[MQTT Alert] Failed to parse message:', err);
      }
    });

    client.on('error', (err) => {
      console.error('[MQTT Alert] Error:', err.message);
    });

    client.on('close', () => {
      isConnected = false;
      console.log('[MQTT Alert] Disconnected from broker');
    });

    client.on('reconnect', () => {
      reconnectAttempts++;
      console.log(`[MQTT Alert] Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[MQTT Alert] Max reconnection attempts reached');
        stopMqttAlertService();
      }
    });
  });
}

/**
 * Stop the MQTT alert service.
 */
export function stopMqttAlertService(): void {
  if (client) {
    client.end(true);
    client = null;
  }
  isConnected = false;
  eventsNamespace = null;
  cooldowns.clear();
  reconnectAttempts = 0;
  console.log('[MQTT Alert] Stopped');
}

/**
 * Check if MQTT service is connected.
 */
export function isMqttConnected(): boolean {
  return isConnected;
}

/**
 * Get current cooldown status (for debugging/testing).
 */
export function getMqttAlertCooldowns(): Map<string, number> {
  return new Map(cooldowns);
}

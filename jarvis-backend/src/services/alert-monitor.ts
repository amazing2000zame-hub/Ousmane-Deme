/**
 * Alert Monitor Service - Phase 29
 *
 * Polls Frigate NVR for unknown person events at entry cameras
 * and emits proactive Socket.IO notifications.
 *
 * Features:
 * - 5-second poll interval (configurable)
 * - 5-minute cooldown per camera to prevent spam (configurable)
 * - Only processes person events with sub_label === null (unknown)
 * - Only processes events from configured entry cameras
 * - Memory-efficient: cleans expired cooldowns after each poll
 */

import type { Namespace } from 'socket.io';
import { config } from '../config.js';
import { getEvents, type FrigateEvent } from '../clients/frigate.js';

// Cooldown map: key = `${camera}:person`, value = expiration timestamp (ms)
const cooldowns = new Map<string, number>();

// Polling state
let pollInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;
let lastPollTimestamp = 0; // Unix timestamp in seconds
let eventsNamespace: Namespace | null = null;

/**
 * Process a single unknown person event.
 */
function processUnknownPersonEvent(event: FrigateEvent): void {
  const cooldownKey = `${event.camera}:person`;
  const now = Date.now();

  // Check cooldown
  const cooldownExpiry = cooldowns.get(cooldownKey);
  if (cooldownExpiry && now < cooldownExpiry) {
    console.log(`[Alert Monitor] Skipping ${event.camera} - on cooldown`);
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

  console.log(`[Alert Monitor] Unknown person at ${event.camera} (event ${event.id})`);
  eventsNamespace?.emit('alert:notification', notification);
}

/**
 * Poll Frigate for new unknown person events.
 */
async function poll(): Promise<void> {
  // Prevent poll stacking
  if (isPolling) {
    return;
  }
  isPolling = true;

  try {
    const now = Math.floor(Date.now() / 1000);

    // First poll: look back 30 seconds to catch any recent events
    const after = lastPollTimestamp || (now - 30);

    // Fetch person events from configured entry cameras with snapshots
    const events = await getEvents({
      label: 'person',
      after,
      has_snapshot: true,
      limit: 20,
    });

    // Update timestamp for next poll
    lastPollTimestamp = now;

    // Filter for unknown persons at entry cameras
    for (const event of events) {
      // Skip if not an entry camera
      if (!config.alertEntryCameras.includes(event.camera)) {
        continue;
      }

      // Skip if face is recognized (sub_label is not null)
      if (event.sub_label !== null) {
        continue;
      }

      // Process the unknown person event
      processUnknownPersonEvent(event);
    }

    // Clean up expired cooldowns to prevent memory leak
    const nowMs = Date.now();
    for (const [key, expiry] of cooldowns) {
      if (nowMs >= expiry) {
        cooldowns.delete(key);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Alert Monitor] Poll failed: ${message}`);
  } finally {
    isPolling = false;
  }
}

/**
 * Start the alert monitoring service.
 */
export function startAlertMonitor(eventsNs: Namespace): void {
  if (pollInterval) {
    console.warn('[Alert Monitor] Already running');
    return;
  }

  eventsNamespace = eventsNs;
  lastPollTimestamp = 0; // Reset on start

  // Initial poll
  poll().catch(() => {});

  // Start interval
  pollInterval = setInterval(() => {
    poll().catch(() => {});
  }, config.alertPollIntervalMs);

  console.log(`[Alert Monitor] Started polling every ${config.alertPollIntervalMs}ms`);
  console.log(`[Alert Monitor] Entry cameras: ${config.alertEntryCameras.join(', ')}`);
  console.log(`[Alert Monitor] Cooldown: ${config.alertCooldownMs / 1000}s`);
}

/**
 * Stop the alert monitoring service.
 */
export function stopAlertMonitor(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  eventsNamespace = null;
  cooldowns.clear();
  isPolling = false;
  console.log('[Alert Monitor] Stopped');
}

/**
 * Get current cooldown status (for debugging/testing).
 */
export function getAlertCooldowns(): Map<string, number> {
  return new Map(cooldowns);
}

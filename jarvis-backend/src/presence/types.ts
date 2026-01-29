/**
 * Presence tracking types for Phase 27.
 * 5-state machine with hysteresis to prevent WiFi flapping issues.
 */

export enum PresenceState {
  JUST_ARRIVED = 'just_arrived',   // Transient: detected, waiting 10min to confirm
  HOME = 'home',                   // Stable: confirmed at home
  JUST_LEFT = 'just_left',         // Transient: departed, waiting 10min to confirm
  AWAY = 'away',                   // Stable: confirmed away
  EXTENDED_AWAY = 'extended_away', // After 24h away
  UNKNOWN = 'unknown',             // Initial state before first signal
}

export interface TrackedPerson {
  id: string;              // MAC address from config.presenceDevices
  name: string;            // Display name (owner field from config)
  phoneMac: string;        // For network detection matching
  state: PresenceState;
  stateChangedAt: Date;
  lastNetworkSeen?: Date;  // Last time phone was on network
  lastCameraSeen?: Date;   // Last face recognition event
  lastFaceEventId?: string; // Frigate event ID for reference
}

export interface PresenceSignal {
  type: 'network' | 'face' | 'car' | 'absence';
  confidence: 'high' | 'medium' | 'low';
  indicates: 'home' | 'arrived' | 'away';
  details?: Record<string, unknown>;
}

// Hysteresis timers (in milliseconds)
export const PRESENCE_TIMERS = {
  ARRIVAL_CONFIRM_MS: 10 * 60 * 1000,      // 10 minutes to confirm arrival
  DEPARTURE_CONFIRM_MS: 10 * 60 * 1000,    // 10 minutes to confirm departure
  EXTENDED_AWAY_MS: 24 * 60 * 60 * 1000,   // 24 hours for extended_away
  POLL_INTERVAL_MS: 60 * 1000,             // 60 second poll interval
};

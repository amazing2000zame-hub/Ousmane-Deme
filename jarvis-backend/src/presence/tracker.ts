/**
 * PresenceTracker - 5-state presence machine with multi-signal fusion.
 *
 * Combines network presence (phone MAC via arp-scan) and face recognition
 * to determine who is home. Uses hysteresis timers to prevent rapid state
 * flapping when WiFi connections are unstable.
 */

import { config } from '../config.js';
import { db } from '../db/index.js';
import { presenceLogs } from '../db/schema.js';
import * as frigate from '../clients/frigate.js';
import { execOnNodeByName } from '../clients/ssh.js';
import {
  PresenceState,
  TrackedPerson,
  PresenceSignal,
  PRESENCE_TIMERS,
} from './types.js';

let instance: PresenceTracker | null = null;

export function getPresenceTracker(): PresenceTracker {
  if (!instance) {
    instance = new PresenceTracker();
  }
  return instance;
}

export class PresenceTracker {
  private people: Map<string, TrackedPerson> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Initialize tracked people from config.presenceDevices
    for (const device of config.presenceDevices) {
      this.people.set(device.mac.toLowerCase(), {
        id: device.mac.toLowerCase(),
        name: device.owner,
        phoneMac: device.mac.toLowerCase(),
        state: PresenceState.UNKNOWN,
        stateChangedAt: new Date(),
      });
    }
  }

  /**
   * Evaluate presence for all tracked people.
   * Called on poll interval or on-demand.
   */
  async evaluatePresence(): Promise<void> {
    const networkMacs = await this.scanNetwork();
    const faceEvents = await this.getRecentFaceEvents();

    for (const [, person] of this.people) {
      const signals = this.gatherSignals(person, networkMacs, faceEvents);
      const newState = this.computeNewState(person, signals);

      if (newState !== person.state) {
        await this.transitionState(person, newState, signals);
      }
    }
  }

  private async scanNetwork(): Promise<Set<string>> {
    const macs = new Set<string>();
    try {
      const result = await execOnNodeByName('Home', 'arp-scan -l --interface=vmbr0 2>/dev/null', 15000);
      const lines = result.stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i);
        if (match) {
          macs.add(match[1].toLowerCase());
        }
      }
    } catch (err) {
      console.error('[PresenceTracker] Network scan failed:', err);
    }
    return macs;
  }

  private async getRecentFaceEvents(): Promise<Array<{ name: string; camera: string; eventId: string; time: Date }>> {
    try {
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
      const events = await frigate.getRecentFaceEvents({
        camera: 'front_door',
        after: tenMinutesAgo,
        limit: 10,
      });
      return events.map(e => ({
        name: e.face.name,
        camera: e.camera,
        eventId: e.id,
        time: new Date(e.start_time * 1000),
      }));
    } catch (err) {
      console.error('[PresenceTracker] Face events fetch failed:', err);
      return [];
    }
  }

  private gatherSignals(
    person: TrackedPerson,
    networkMacs: Set<string>,
    faceEvents: Array<{ name: string; camera: string; eventId: string; time: Date }>,
  ): PresenceSignal[] {
    const signals: PresenceSignal[] = [];

    // Network presence signal (highest confidence for "at home")
    if (networkMacs.has(person.phoneMac)) {
      signals.push({
        type: 'network',
        confidence: 'high',
        indicates: 'home',
        details: { mac: person.phoneMac },
      });
      person.lastNetworkSeen = new Date();
    }

    // Face recognition signal (high confidence for "arrived")
    const faceMatch = faceEvents.find(e =>
      e.name.toLowerCase() === person.name.toLowerCase()
    );
    if (faceMatch) {
      signals.push({
        type: 'face',
        confidence: 'high',
        indicates: 'arrived',
        details: { camera: faceMatch.camera, eventId: faceMatch.eventId },
      });
      person.lastCameraSeen = faceMatch.time;
      person.lastFaceEventId = faceMatch.eventId;
    }

    // Absence signal (no network presence)
    if (!networkMacs.has(person.phoneMac)) {
      const timeSinceLastSeen = person.lastNetworkSeen
        ? Date.now() - person.lastNetworkSeen.getTime()
        : Infinity;

      if (timeSinceLastSeen > PRESENCE_TIMERS.DEPARTURE_CONFIRM_MS) {
        signals.push({
          type: 'absence',
          confidence: 'high',
          indicates: 'away',
        });
      }
    }

    return signals;
  }

  private computeNewState(person: TrackedPerson, signals: PresenceSignal[]): PresenceState {
    const hasHomeSignal = signals.some(s => s.indicates === 'home');
    const hasArrivedSignal = signals.some(s => s.indicates === 'arrived');
    const hasAwaySignal = signals.some(s => s.indicates === 'away');
    const timeSinceChange = Date.now() - person.stateChangedAt.getTime();

    switch (person.state) {
      case PresenceState.UNKNOWN:
        if (hasHomeSignal || hasArrivedSignal) return PresenceState.HOME;
        if (hasAwaySignal) return PresenceState.AWAY;
        return PresenceState.UNKNOWN;

      case PresenceState.HOME:
        if (!hasHomeSignal && !hasArrivedSignal) {
          return PresenceState.JUST_LEFT;
        }
        return PresenceState.HOME;

      case PresenceState.JUST_LEFT:
        // Flap guard: if home signal returns, go directly back to HOME
        if (hasHomeSignal || hasArrivedSignal) return PresenceState.HOME;
        // Confirm departure after timer
        if (timeSinceChange >= PRESENCE_TIMERS.DEPARTURE_CONFIRM_MS) {
          return PresenceState.AWAY;
        }
        return PresenceState.JUST_LEFT;

      case PresenceState.AWAY:
        if (hasHomeSignal || hasArrivedSignal) return PresenceState.JUST_ARRIVED;
        if (timeSinceChange >= PRESENCE_TIMERS.EXTENDED_AWAY_MS) {
          return PresenceState.EXTENDED_AWAY;
        }
        return PresenceState.AWAY;

      case PresenceState.JUST_ARRIVED:
        // If signal lost during arrival confirmation, go back to AWAY
        if (!hasHomeSignal && !hasArrivedSignal) return PresenceState.AWAY;
        // Confirm arrival after timer
        if (timeSinceChange >= PRESENCE_TIMERS.ARRIVAL_CONFIRM_MS) {
          return PresenceState.HOME;
        }
        return PresenceState.JUST_ARRIVED;

      case PresenceState.EXTENDED_AWAY:
        if (hasHomeSignal || hasArrivedSignal) return PresenceState.JUST_ARRIVED;
        return PresenceState.EXTENDED_AWAY;

      default:
        return person.state;
    }
  }

  private async transitionState(
    person: TrackedPerson,
    newState: PresenceState,
    signals: PresenceSignal[],
  ): Promise<void> {
    const previousState = person.state;
    person.state = newState;
    person.stateChangedAt = new Date();

    // Determine trigger from signals
    const trigger = signals.find(s =>
      (newState.includes('home') || newState.includes('arrived')) ? s.indicates !== 'away' : s.indicates === 'away'
    )?.type ?? 'timer';

    // Log to database
    try {
      await db.insert(presenceLogs).values({
        personId: person.id,
        personName: person.name,
        previousState: previousState,
        newState: newState,
        trigger: trigger,
        triggerDetails: JSON.stringify({
          signals: signals.map(s => ({ type: s.type, indicates: s.indicates })),
        }),
      });
    } catch (err) {
      console.error('[PresenceTracker] Failed to log state transition:', err);
    }

    console.log(`[PresenceTracker] ${person.name}: ${previousState} -> ${newState} (trigger: ${trigger})`);
  }

  getCurrentStates(): TrackedPerson[] {
    return Array.from(this.people.values());
  }

  getPersonState(name: string): TrackedPerson | undefined {
    return Array.from(this.people.values()).find(
      p => p.name.toLowerCase() === name.toLowerCase()
    );
  }

  start(intervalMs: number = PRESENCE_TIMERS.POLL_INTERVAL_MS): void {
    if (this.pollInterval) return;
    console.log(`[PresenceTracker] Starting with ${intervalMs}ms poll interval`);
    this.pollInterval = setInterval(() => this.evaluatePresence(), intervalMs);
    // Run initial evaluation
    this.evaluatePresence();
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('[PresenceTracker] Stopped');
    }
  }
}

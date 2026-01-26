/**
 * Monitor lifecycle management.
 *
 * Starts tiered polling loops that detect cluster state changes and
 * threshold violations. Polling intervals are offset from the emitter
 * to avoid API thundering herd:
 *  - Critical:   12s (emitter nodes: 10s)
 *  - Important:  32s (emitter storage: 30s)
 *  - Routine:    5 min
 *  - Background: 30 min
 */

import type { Namespace } from 'socket.io';
import { StateTracker } from './state-tracker.js';
import { ThresholdEvaluator } from './thresholds.js';
import { pollCritical, pollImportant, pollRoutine, pollBackground } from './poller.js';

const intervals: ReturnType<typeof setInterval>[] = [];
let running = false;

const POLL_INTERVALS = {
  critical: 12_000,      // 12s (offset from emitter's 10s)
  important: 32_000,     // 32s (offset from emitter's 30s)
  routine: 300_000,      // 5 min
  background: 1_800_000, // 30 min
};

/** Initial delay before first poll (let emitter populate first) */
const STARTUP_DELAY = 5_000;

/**
 * Start the autonomous monitoring service.
 * Creates state tracker and threshold evaluator instances, then begins
 * tiered polling loops with an initial 5-second delay.
 */
export function startMonitor(eventsNs: Namespace): void {
  if (running) {
    console.warn('[Monitor] Already running, skipping start');
    return;
  }

  const stateTracker = new StateTracker();
  const thresholdEvaluator = new ThresholdEvaluator();

  // Delay first poll to let the emitter populate initial data
  const startupTimer = setTimeout(() => {
    // Run initial polls immediately
    pollCritical(eventsNs, stateTracker).catch(err =>
      console.error('[Monitor] Initial critical poll error:', err)
    );
    pollImportant(eventsNs, thresholdEvaluator).catch(err =>
      console.error('[Monitor] Initial important poll error:', err)
    );

    // Start recurring intervals
    intervals.push(
      setInterval(() => {
        pollCritical(eventsNs, stateTracker).catch(err =>
          console.error('[Monitor] Critical poll error:', err)
        );
      }, POLL_INTERVALS.critical),
    );

    intervals.push(
      setInterval(() => {
        pollImportant(eventsNs, thresholdEvaluator).catch(err =>
          console.error('[Monitor] Important poll error:', err)
        );
      }, POLL_INTERVALS.important),
    );

    intervals.push(
      setInterval(() => {
        pollRoutine(eventsNs).catch(err =>
          console.error('[Monitor] Routine poll error:', err)
        );
      }, POLL_INTERVALS.routine),
    );

    intervals.push(
      setInterval(() => {
        pollBackground(eventsNs).catch(err =>
          console.error('[Monitor] Background poll error:', err)
        );
      }, POLL_INTERVALS.background),
    );
  }, STARTUP_DELAY);

  // Track the startup timer so stopMonitor can clear it
  intervals.push(startupTimer as unknown as ReturnType<typeof setInterval>);

  running = true;
  console.log('[Monitor] Autonomous monitoring service started');
  console.log('[Monitor]   Critical:   every 12s (state changes)');
  console.log('[Monitor]   Important:  every 32s (thresholds)');
  console.log('[Monitor]   Routine:    every 5min (service health)');
  console.log('[Monitor]   Background: every 30min (cleanup)');
}

/**
 * Stop the autonomous monitoring service.
 * Clears all polling intervals.
 */
export function stopMonitor(): void {
  for (const id of intervals) {
    clearInterval(id);
  }
  intervals.length = 0;
  running = false;
  console.log('[Monitor] Autonomous monitoring service stopped');
}

/**
 * Check if the monitor is currently running.
 */
export function isMonitorRunning(): boolean {
  return running;
}

/**
 * Memory cleanup service — periodically expires stale memories.
 * Runs on a configurable interval (default: every 60 minutes).
 */

import { config } from '../config.js';
import { memoryBank } from '../db/memories.js';

let intervalId: ReturnType<typeof setInterval> | null = null;

function runCleanup(): void {
  const deleted = memoryBank.deleteExpired();
  if (deleted > 0) {
    console.log(`[Memory] Cleanup: expired ${deleted} memories`);
  }
}

export function startMemoryCleanup(): void {
  // Run once immediately on startup
  runCleanup();

  const intervalMs = config.memoryCleanupIntervalMinutes * 60_000;
  intervalId = setInterval(runCleanup, intervalMs);
  console.log(`[Memory] Cleanup service started (every ${config.memoryCleanupIntervalMinutes} min)`);
}

export function stopMemoryCleanup(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Memory] Cleanup service stopped');
  }
}

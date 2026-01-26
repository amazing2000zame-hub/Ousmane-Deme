/**
 * Pre-execution safety guardrails for autonomous remediation.
 *
 * Enforces:
 *  - Kill switch: disables all autonomous actions via preference toggle
 *  - Rate limiting: sliding window (3 attempts per incident per hour)
 *  - Blast radius: only 1 node remediation at a time
 *  - Autonomy level: action blocked if current level < required level
 *
 * All functions are synchronous or lightweight -- safe for hot-path use.
 */

import { memoryStore } from '../db/memory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** Sliding window rate limiter: incident key -> array of attempt timestamps */
const attemptLog = new Map<string, number[]>();

/** Active remediations: node name -> start timestamp */
const activeRemediations = new Map<string, number>();

/** Stale remediation timeout (10 minutes) */
const STALE_REMEDIATION_MS = 600_000;

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

/**
 * Check if the kill switch is active.
 * Reads the `autonomy.killSwitch` preference from the database.
 */
export function isKillSwitchActive(): boolean {
  try {
    const pref = memoryStore.getPreference('autonomy.killSwitch');
    return pref?.value === 'true';
  } catch {
    // If DB is unavailable, fail-safe: treat kill switch as active
    return true;
  }
}

// ---------------------------------------------------------------------------
// Autonomy level
// ---------------------------------------------------------------------------

/**
 * Get the current autonomy level from preferences.
 * Defaults to 3 (L3_ACT_REPORT) if not set.
 */
export function getCurrentAutonomyLevel(): number {
  try {
    const pref = memoryStore.getPreference('autonomy.level');
    if (!pref?.value) return 3;
    const level = parseInt(pref.value, 10);
    return isNaN(level) ? 3 : level;
  } catch {
    return 3;
  }
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

/**
 * Get the number of attempts for a given key within a sliding time window.
 * Cleans up expired entries as a side effect.
 */
export function getAttemptCount(key: string, windowMs: number): number {
  const now = Date.now();
  const timestamps = attemptLog.get(key);
  if (!timestamps) return 0;

  // Filter to only entries within the window
  const valid = timestamps.filter(t => now - t < windowMs);

  // Update the stored array (cleanup old entries)
  if (valid.length === 0) {
    attemptLog.delete(key);
  } else {
    attemptLog.set(key, valid);
  }

  return valid.length;
}

/**
 * Record an attempt for a given incident key.
 */
export function recordAttempt(key: string): void {
  const timestamps = attemptLog.get(key) ?? [];
  timestamps.push(Date.now());
  attemptLog.set(key, timestamps);
}

// ---------------------------------------------------------------------------
// Blast radius control
// ---------------------------------------------------------------------------

/**
 * Mark a node as having an active remediation.
 */
export function markRemediationActive(node: string): void {
  activeRemediations.set(node, Date.now());
}

/**
 * Mark a node's remediation as complete.
 */
export function markRemediationComplete(node: string): void {
  activeRemediations.delete(node);
}

/**
 * Get the count of active remediations.
 * Cleans up stale entries older than 10 minutes (safety net for stuck remediations).
 */
export function getActiveRemediationCount(): number {
  const now = Date.now();

  // Clean up stale entries
  for (const [node, startTime] of activeRemediations.entries()) {
    if (now - startTime > STALE_REMEDIATION_MS) {
      console.warn(`[Guardrails] Cleaning up stale remediation on ${node} (started ${Math.round((now - startTime) / 1000)}s ago)`);
      activeRemediations.delete(node);
    }
  }

  return activeRemediations.size;
}

/**
 * Check if a specific node is currently being remediated.
 */
export function isNodeBeingRemediated(node: string): boolean {
  return activeRemediations.has(node);
}

// ---------------------------------------------------------------------------
// Combined guardrail check
// ---------------------------------------------------------------------------

/**
 * Run all guardrail checks in priority order.
 *
 * Check order:
 *  1. Kill switch active -> blocked
 *  2. Rate limit (3 attempts per hour for same incident) -> blocked + escalation
 *  3. Blast radius (another remediation in progress) -> blocked
 *  4. Autonomy level insufficient -> blocked
 *  5. All pass -> allowed
 */
export function checkGuardrails(
  incidentKey: string,
  node: string,
  requiredLevel: number,
): GuardrailResult {
  // 1. Kill switch
  if (isKillSwitchActive()) {
    return { allowed: false, reason: 'Kill switch is active' };
  }

  // 2. Rate limit: 3 attempts per hour per incident
  if (getAttemptCount(incidentKey, 3_600_000) >= 3) {
    return { allowed: false, reason: 'Rate limit exceeded (3/hour) -- escalating' };
  }

  // 3. Blast radius: only 1 node at a time
  if (getActiveRemediationCount() > 0) {
    return { allowed: false, reason: 'Another remediation is in progress (blast radius control)' };
  }

  // 4. Autonomy level
  if (getCurrentAutonomyLevel() < requiredLevel) {
    return { allowed: false, reason: 'Current autonomy level insufficient' };
  }

  // 5. All checks passed
  return { allowed: true };
}

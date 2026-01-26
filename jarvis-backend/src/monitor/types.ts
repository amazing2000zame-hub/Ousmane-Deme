// ---------------------------------------------------------------------------
// Autonomous monitoring domain types
// ---------------------------------------------------------------------------

/**
 * Autonomy levels define how aggressively Jarvis can act on detected conditions.
 * Higher levels require less human approval.
 */
export enum AutonomyLevel {
  /** Observe and log only -- no alerts, no action */
  L0_OBSERVE = 0,
  /** Alert the operator (email/notification) */
  L1_ALERT = 1,
  /** Recommend an action to the operator */
  L2_RECOMMEND = 2,
  /** Act autonomously and report after */
  L3_ACT_REPORT = 3,
  /** Act silently -- routine maintenance (log cleanup, temp file purge) */
  L4_ACT_SILENT = 4,
}

/**
 * Types of conditions the monitor can detect.
 */
export type ConditionType =
  | 'NODE_UNREACHABLE'
  | 'VM_CRASHED'
  | 'CT_CRASHED'
  | 'DISK_HIGH'
  | 'DISK_CRITICAL'
  | 'RAM_CRITICAL'
  | 'RAM_HIGH'
  | 'CPU_HIGH'
  | 'SERVICE_DOWN'
  | 'TEMP_HIGH';

/**
 * Represents a state transition detected by the StateTracker.
 * E.g. a node going from 'online' to 'offline', or a VM from 'running' to 'stopped'.
 */
export interface StateChange {
  type: ConditionType;
  target: string;
  node: string;
  previousState: string;
  currentState: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

/**
 * A threshold violation detected by the threshold evaluator.
 * E.g. disk usage exceeding 90%.
 */
export interface ThresholdViolation {
  type: ConditionType;
  node: string;
  metric: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'error' | 'critical';
  timestamp: string;
}

/**
 * An incident is a detected condition that may require action.
 * Each incident has a stable key for deduplication and rate limiting.
 */
export interface Incident {
  id: string;
  key: string;
  type: ConditionType;
  node: string;
  target: string;
  detectedAt: string;
  details: Record<string, unknown>;
}

/**
 * A monitor event wraps an incident with its detection context
 * (state change or threshold violation).
 */
export interface MonitorEvent {
  type: 'state_change' | 'threshold' | 'remediation';
  incident: Incident;
  change?: StateChange;
  violation?: ThresholdViolation;
}

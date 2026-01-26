/**
 * Threshold evaluator -- checks node metrics against defined thresholds
 * and returns violations. Uses a Set to track active violations so that
 * only NEW violations are emitted (not re-emitted every poll cycle).
 */

import type { NodeData } from '../realtime/emitter.js';
import type { ConditionType, ThresholdViolation } from './types.js';

interface Threshold {
  metric: string;
  operator: '>';
  value: number;
  severity: 'warning' | 'error' | 'critical';
  condition: ConditionType;
}

export const THRESHOLDS: Threshold[] = [
  { metric: 'disk_percent', operator: '>', value: 95, severity: 'critical', condition: 'DISK_CRITICAL' },
  { metric: 'disk_percent', operator: '>', value: 90, severity: 'error', condition: 'DISK_HIGH' },
  { metric: 'mem_percent', operator: '>', value: 95, severity: 'critical', condition: 'RAM_CRITICAL' },
  { metric: 'mem_percent', operator: '>', value: 85, severity: 'warning', condition: 'RAM_HIGH' },
  { metric: 'cpu_percent', operator: '>', value: 95, severity: 'warning', condition: 'CPU_HIGH' },
];

/**
 * ThresholdEvaluator maintains a set of active violations to avoid
 * re-emitting the same violation on every poll cycle. Violations are
 * cleared when the metric drops below the threshold.
 */
export class ThresholdEvaluator {
  /** Active violation keys: `${condition}:${node}` */
  private activeViolations = new Set<string>();

  /**
   * Evaluate all thresholds against current node data.
   * Returns only NEW violations (not already active).
   */
  evaluateThresholds(nodes: NodeData[]): ThresholdViolation[] {
    const newViolations: ThresholdViolation[] = [];
    const currentViolationKeys = new Set<string>();

    for (const node of nodes) {
      if (node.status !== 'online') continue;

      const metrics: Record<string, number> = {
        disk_percent: node.maxdisk > 0 ? (node.disk / node.maxdisk) * 100 : 0,
        mem_percent: node.maxmem > 0 ? (node.mem / node.maxmem) * 100 : 0,
        cpu_percent: node.cpu * 100,
      };

      for (const threshold of THRESHOLDS) {
        const value = metrics[threshold.metric] ?? 0;
        const key = `${threshold.condition}:${node.name}`;

        if (value > threshold.value) {
          currentViolationKeys.add(key);

          // Only emit if not already active
          if (!this.activeViolations.has(key)) {
            this.activeViolations.add(key);
            newViolations.push({
              type: threshold.condition,
              node: node.name,
              metric: threshold.metric,
              value: Math.round(value * 10) / 10,
              threshold: threshold.value,
              severity: threshold.severity,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }

    // Clear violations that are no longer active
    for (const key of this.activeViolations) {
      if (!currentViolationKeys.has(key)) {
        this.activeViolations.delete(key);
      }
    }

    return newViolations;
  }

  /** Check if a specific violation is currently active */
  isActive(condition: ConditionType, node: string): boolean {
    return this.activeViolations.has(`${condition}:${node}`);
  }

  /** Get count of active violations */
  getActiveCount(): number {
    return this.activeViolations.size;
  }
}

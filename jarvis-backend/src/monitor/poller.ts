/**
 * Tiered polling functions for autonomous monitoring.
 *
 * Each poll function is independently try/catch-wrapped so errors never
 * propagate or crash the backend. All events emitted include
 * `source: 'monitor'` for frontend filtering and visual distinction.
 *
 * Tiers:
 *  - Critical (12s): Node & VM state changes
 *  - Important (32s): Threshold violations (disk, RAM, CPU)
 *  - Routine (5min): Service health, temperature (placeholder)
 *  - Background (30min): Audit log cleanup, capacity planning (placeholder)
 */

import crypto from 'node:crypto';
import type { Namespace } from 'socket.io';
import { getAnyClient } from '../clients/proxmox.js';
import type { NodeData, VMData } from '../realtime/emitter.js';
import { StateTracker } from './state-tracker.js';
import { ThresholdEvaluator } from './thresholds.js';
import { memoryStore } from '../db/memory.js';
import type { StateChange, ThresholdViolation, Incident } from './types.js';
import { config, type ClusterNode } from '../config.js';
import { executeRunbook } from './runbooks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityForStateChange(change: StateChange): 'warning' | 'error' | 'critical' {
  if (change.type === 'NODE_UNREACHABLE') return 'critical';
  if (change.currentState === 'stopped' && change.previousState === 'running') return 'error';
  return 'warning';
}

function titleForStateChange(change: StateChange): string {
  switch (change.type) {
    case 'NODE_UNREACHABLE':
      return `Node ${change.node} ${change.currentState}`;
    case 'VM_CRASHED':
      return `VM ${change.target} crashed`;
    case 'CT_CRASHED':
      return `Container ${change.target} crashed`;
    default:
      return `${change.type}: ${change.target}`;
  }
}

function titleForViolation(v: ThresholdViolation): string {
  const metricLabel: Record<string, string> = {
    disk_percent: 'Disk usage',
    mem_percent: 'RAM usage',
    cpu_percent: 'CPU usage',
  };
  return `${metricLabel[v.metric] ?? v.metric} ${v.severity} on ${v.node}`;
}

// ---------------------------------------------------------------------------
// Poll: Critical (12s) -- Node & VM state detection
// ---------------------------------------------------------------------------

export async function pollCritical(
  eventsNs: Namespace,
  stateTracker: StateTracker,
): Promise<StateChange[]> {
  const allChanges: StateChange[] = [];

  try {
    const pve = getAnyClient();

    // Fetch nodes and VMs in parallel -- individual failures don't block each other
    const [nodesResult, vmsResult] = await Promise.allSettled([
      pve.getClusterResources('node') as Promise<Array<Record<string, unknown>>>,
      pve.getClusterResources('vm') as Promise<Array<Record<string, unknown>>>,
    ]);

    // Process nodes
    if (nodesResult.status === 'fulfilled') {
      const nodeData: NodeData[] = nodesResult.value.map((r) => ({
        name: (r.node as string) ?? '',
        host: config.clusterNodes.find((n: ClusterNode) => n.name === r.node)?.host ?? '',
        status: (r.status as string) ?? 'unknown',
        cpu: (r.cpu as number) ?? 0,
        maxcpu: (r.maxcpu as number) ?? 0,
        mem: (r.mem as number) ?? 0,
        maxmem: (r.maxmem as number) ?? 0,
        disk: (r.disk as number) ?? 0,
        maxdisk: (r.maxdisk as number) ?? 0,
        uptime: (r.uptime as number) ?? 0,
      }));

      const nodeChanges = stateTracker.updateNodes(nodeData);
      allChanges.push(...nodeChanges);
    } else {
      console.warn('[Monitor] Critical poll: failed to fetch nodes:', nodesResult.reason);
    }

    // Process VMs
    if (vmsResult.status === 'fulfilled') {
      const vmData: VMData[] = vmsResult.value.map((r) => ({
        vmid: (r.vmid as number) ?? 0,
        name: (r.name as string) ?? '',
        type: (r.type as 'qemu' | 'lxc') ?? 'qemu',
        status: (r.status as string) ?? 'unknown',
        node: (r.node as string) ?? '',
        cpu: (r.cpu as number) ?? 0,
        maxcpu: (r.maxcpu as number) ?? 0,
        mem: (r.mem as number) ?? 0,
        maxmem: (r.maxmem as number) ?? 0,
        disk: (r.disk as number) ?? 0,
        maxdisk: (r.maxdisk as number) ?? 0,
        uptime: (r.uptime as number) ?? 0,
      }));

      const vmChanges = stateTracker.updateVMs(vmData);
      allChanges.push(...vmChanges);
    } else {
      console.warn('[Monitor] Critical poll: failed to fetch VMs:', vmsResult.reason);
    }

    // Emit events for each state change
    for (const change of allChanges) {
      const severity = severityForStateChange(change);
      const title = titleForStateChange(change);
      const message = `${change.target} changed from ${change.previousState} to ${change.currentState}`;

      // Save to SQLite event log
      memoryStore.saveEvent({
        type: 'alert',
        severity,
        source: 'monitor',
        node: change.node,
        summary: `[Monitor] ${title}: ${message}`,
      });

      // Emit to /events namespace with explicit source: 'monitor'
      eventsNs.emit('event', {
        id: crypto.randomUUID(),
        type: 'alert',
        severity,
        title,
        message,
        node: change.node,
        source: 'monitor',
        timestamp: new Date().toISOString(),
      });

      console.log(`[Monitor] State change: ${title} -- ${message}`);
    }

    // Trigger runbook execution for each state change (fire-and-forget)
    for (const change of allChanges) {
      const incident: Incident = {
        id: crypto.randomUUID(),
        key: `${change.type}:${change.target}`,
        type: change.type,
        node: change.node,
        target: change.target,
        detectedAt: new Date().toISOString(),
        details: {
          previousState: change.previousState,
          currentState: change.currentState,
        },
      };

      executeRunbook(incident, eventsNs).catch(err =>
        console.error('[Monitor] Runbook error:', err instanceof Error ? err.message : err)
      );
    }
  } catch (err) {
    console.error('[Monitor] Critical poll error:', err instanceof Error ? err.message : err);
  }

  return allChanges;
}

// ---------------------------------------------------------------------------
// Poll: Important (32s) -- Threshold violations
// ---------------------------------------------------------------------------

export async function pollImportant(
  eventsNs: Namespace,
  thresholdEvaluator: ThresholdEvaluator,
): Promise<ThresholdViolation[]> {
  const violations: ThresholdViolation[] = [];

  try {
    const pve = getAnyClient();
    const raw = (await pve.getClusterResources('node')) as Array<Record<string, unknown>>;

    const nodeData: NodeData[] = raw.map((r) => ({
      name: (r.node as string) ?? '',
      host: config.clusterNodes.find((n: ClusterNode) => n.name === r.node)?.host ?? '',
      status: (r.status as string) ?? 'unknown',
      cpu: (r.cpu as number) ?? 0,
      maxcpu: (r.maxcpu as number) ?? 0,
      mem: (r.mem as number) ?? 0,
      maxmem: (r.maxmem as number) ?? 0,
      disk: (r.disk as number) ?? 0,
      maxdisk: (r.maxdisk as number) ?? 0,
      uptime: (r.uptime as number) ?? 0,
    }));

    const newViolations = thresholdEvaluator.evaluateThresholds(nodeData);
    violations.push(...newViolations);

    // Emit events for each new violation
    for (const v of newViolations) {
      const title = titleForViolation(v);
      const message = `${v.metric} at ${v.value}% (threshold: ${v.threshold}%)`;

      // Save to SQLite event log
      memoryStore.saveEvent({
        type: 'alert',
        severity: v.severity,
        source: 'monitor',
        node: v.node,
        summary: `[Monitor] ${title}: ${message}`,
      });

      // Emit to /events namespace with explicit source: 'monitor'
      eventsNs.emit('event', {
        id: crypto.randomUUID(),
        type: 'alert',
        severity: v.severity,
        title,
        message,
        node: v.node,
        source: 'monitor',
        timestamp: new Date().toISOString(),
      });

      console.log(`[Monitor] Threshold violation: ${title} -- ${message}`);
    }
  } catch (err) {
    console.error('[Monitor] Important poll error:', err instanceof Error ? err.message : err);
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Poll: Routine (5min) -- Service health, temperature (placeholder)
// ---------------------------------------------------------------------------

export async function pollRoutine(eventsNs: Namespace): Promise<void> {
  try {
    const pve = getAnyClient();
    const raw = (await pve.getClusterResources('node')) as Array<Record<string, unknown>>;

    const totalNodes = raw.length;
    const onlineNodes = raw.filter((r) => (r.status as string) === 'online').length;
    const allHealthy = onlineNodes === totalNodes;

    const title = allHealthy ? 'Systems Nominal' : 'Cluster Degraded';
    const severity = allHealthy ? 'info' as const : 'warning' as const;
    const message = allHealthy
      ? `All ${totalNodes} nodes online -- cluster healthy`
      : `${onlineNodes}/${totalNodes} nodes online -- investigate offline nodes`;

    // Save heartbeat to DB
    memoryStore.saveEvent({
      type: 'status',
      severity,
      source: 'monitor',
      summary: `[Monitor] ${title}: ${message}`,
    });

    // Emit heartbeat to /events namespace
    eventsNs.emit('event', {
      id: crypto.randomUUID(),
      type: 'status',
      severity,
      title,
      message,
      source: 'monitor',
      timestamp: new Date().toISOString(),
    });

    console.log(`[Monitor] Heartbeat: ${title} (${onlineNodes}/${totalNodes} nodes)`);
  } catch (err) {
    console.error('[Monitor] Routine poll error:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Poll: Background (30min) -- Audit log cleanup, capacity planning
// ---------------------------------------------------------------------------

export async function pollBackground(eventsNs: Namespace): Promise<void> {
  try {
    // Storage capacity check -- warn at 85%, critical at 95%
    try {
      const pve = getAnyClient();
      const storageRaw = (await pve.getClusterResources('storage')) as Array<Record<string, unknown>>;

      for (const s of storageRaw) {
        const disk = (s.disk as number) ?? 0;
        const maxdisk = (s.maxdisk as number) ?? 0;
        if (maxdisk === 0) continue;

        const usagePercent = Math.round((disk / maxdisk) * 100);
        const storageName = (s.storage as string) ?? 'unknown';
        const storageNode = (s.node as string) ?? 'unknown';

        if (usagePercent >= 95) {
          const title = `Storage critical: ${storageName}`;
          const message = `${storageName} on ${storageNode} at ${usagePercent}% capacity`;

          memoryStore.saveEvent({
            type: 'alert',
            severity: 'critical',
            source: 'monitor',
            node: storageNode,
            summary: `[Monitor] ${title}: ${message}`,
          });

          eventsNs.emit('event', {
            id: crypto.randomUUID(),
            type: 'alert',
            severity: 'critical',
            title,
            message,
            node: storageNode,
            source: 'monitor',
            timestamp: new Date().toISOString(),
          });

          console.log(`[Monitor] ${title} -- ${message}`);
        } else if (usagePercent >= 85) {
          const title = `Storage warning: ${storageName}`;
          const message = `${storageName} on ${storageNode} at ${usagePercent}% capacity`;

          memoryStore.saveEvent({
            type: 'alert',
            severity: 'warning',
            source: 'monitor',
            node: storageNode,
            summary: `[Monitor] ${title}: ${message}`,
          });

          eventsNs.emit('event', {
            id: crypto.randomUUID(),
            type: 'alert',
            severity: 'warning',
            title,
            message,
            node: storageNode,
            source: 'monitor',
            timestamp: new Date().toISOString(),
          });

          console.log(`[Monitor] ${title} -- ${message}`);
        }
      }
    } catch (storageErr) {
      console.warn('[Monitor] Storage capacity check failed:', storageErr instanceof Error ? storageErr.message : storageErr);
    }

    // Clean up old autonomy action records (older than 30 days)
    memoryStore.cleanupOldActions(30);

    console.log('[Monitor] Background poll completed (storage check + audit log cleanup done)');
  } catch (err) {
    console.error('[Monitor] Background poll error:', err instanceof Error ? err.message : err);
  }
}

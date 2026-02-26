/**
 * Real-time data emitter for the /cluster Socket.IO namespace.
 *
 * Polls the Proxmox API on timed intervals and emits structured data to
 * all connected clients. Also exports on-demand emit functions for use
 * after tool execution (so the dashboard reflects changes immediately).
 *
 * Polling intervals:
 *  - Nodes: 10s (CPU, RAM, disk, uptime, status)
 *  - VMs/Containers: 15s (status, resource usage)
 *  - Storage: 30s (usage, availability)
 *  - Temperature: 30s (via SSH to each node)
 */

import type { Namespace } from 'socket.io';
import { getCachedClusterResources, getCachedClusterStatus } from '../clients/proxmox.js';
import { execOnNodeByName } from '../clients/ssh.js';
import { config, type ClusterNode } from '../config.js';
import { getVoiceAgents } from './voice.js';

// ---------------------------------------------------------------------------
// Types for emitted data
// ---------------------------------------------------------------------------

export interface NodeData {
  name: string;
  host: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
}

export interface VMData {
  vmid: number;
  name: string;
  type: 'qemu' | 'lxc';
  status: string;
  node: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
}

export interface StorageData {
  storage: string;
  node: string;
  type: string;
  status: string;
  total: number;
  used: number;
  avail: number;
  content: string;
}

export interface QuorumData {
  quorate: boolean;
  nodes: number;
  expected: number;
}

export interface TemperatureData {
  node: string;
  zones: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let clusterNamespace: Namespace | null = null;
const intervals: ReturnType<typeof setInterval>[] = [];

// ---------------------------------------------------------------------------
// Polling + emit functions
// ---------------------------------------------------------------------------

async function pollNodes(): Promise<NodeData[]> {
  const raw = (await getCachedClusterResources('node')) as Array<Record<string, unknown>>;

  return raw.map((r) => ({
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
}

async function pollVMs(): Promise<VMData[]> {
  const raw = (await getCachedClusterResources('vm')) as Array<Record<string, unknown>>;

  return raw.map((r) => ({
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
}

async function pollStorage(): Promise<StorageData[]> {
  const raw = (await getCachedClusterResources('storage')) as Array<Record<string, unknown>>;

  return raw.map((r) => ({
    storage: (r.storage as string) ?? '',
    node: (r.node as string) ?? '',
    type: (r.plugintype as string) ?? (r.type as string) ?? '',
    status: (r.status as string) ?? 'unknown',
    total: (r.maxdisk as number) ?? 0,
    used: (r.disk as number) ?? 0,
    avail: ((r.maxdisk as number) ?? 0) - ((r.disk as number) ?? 0),
    content: (r.content as string) ?? '',
  }));
}

async function pollQuorum(): Promise<QuorumData> {
  const raw = (await getCachedClusterStatus()) as Array<Record<string, unknown>>;

  // Cluster status returns an array with a "cluster" type entry and node entries
  const clusterEntry = raw.find((r) => r.type === 'cluster');

  if (clusterEntry) {
    return {
      quorate: Boolean(clusterEntry.quorate),
      nodes: (clusterEntry.nodes as number) ?? 0,
      expected: (clusterEntry.expected as number) ?? 0,
    };
  }

  // Fallback: count online nodes from the array
  const nodeEntries = raw.filter((r) => r.type === 'node');
  const onlineNodes = nodeEntries.filter((r) => r.online === 1).length;

  return {
    quorate: onlineNodes >= 3,
    nodes: nodeEntries.length,
    expected: 3,
  };
}

/**
 * PERF-012: Poll temperature from all 4 nodes concurrently using
 * Promise.allSettled. Completes in max(node_latencies) instead of sum.
 */
async function pollTemperature(): Promise<TemperatureData[]> {
  const cmd = 'paste <(cat /sys/class/thermal/thermal_zone*/type) <(cat /sys/class/thermal/thermal_zone*/temp)';

  const results = await Promise.allSettled(
    config.clusterNodes.map(async (node: ClusterNode): Promise<TemperatureData | null> => {
      try {
        const result = await execOnNodeByName(node.name, cmd, 10_000);
        if (result.code !== 0 && result.code !== null) return null;

        const zones: Record<string, number> = {};
        const lines = result.stdout.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          const parts = line.split('\t');
          if (parts.length >= 2) {
            const zoneType = parts[0].trim();
            const tempRaw = parseInt(parts[1].trim(), 10);
            if (!isNaN(tempRaw)) {
              zones[zoneType] = tempRaw / 1000;
            }
          }
        }

        return { node: node.name, zones };
      } catch {
        return null;
      }
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TemperatureData | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is TemperatureData => v !== null);
}

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

async function emitNodes(): Promise<void> {
  if (!clusterNamespace) return;
  try {
    const nodes = await pollNodes();
    clusterNamespace.emit('nodes', nodes);
  } catch (err) {
    console.warn('[Emitter] Failed to poll/emit nodes:', err instanceof Error ? err.message : err);
  }
}

async function emitVMs(): Promise<void> {
  if (!clusterNamespace) return;
  try {
    const vms = await pollVMs();
    clusterNamespace.emit('vms', vms);
  } catch (err) {
    console.warn('[Emitter] Failed to poll/emit VMs:', err instanceof Error ? err.message : err);
  }
}

async function emitStorage(): Promise<void> {
  if (!clusterNamespace) return;
  try {
    const storage = await pollStorage();
    clusterNamespace.emit('storage', storage);
  } catch (err) {
    console.warn('[Emitter] Failed to poll/emit storage:', err instanceof Error ? err.message : err);
  }
}

async function emitQuorum(): Promise<void> {
  if (!clusterNamespace) return;
  try {
    const quorum = await pollQuorum();
    clusterNamespace.emit('quorum', quorum);
  } catch (err) {
    console.warn('[Emitter] Failed to poll/emit quorum:', err instanceof Error ? err.message : err);
  }
}

async function emitTemperature(): Promise<void> {
  if (!clusterNamespace) return;
  try {
    const temps = await pollTemperature();
    clusterNamespace.emit('temperature', temps);
  } catch (err) {
    console.warn('[Emitter] Failed to poll/emit temperature:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// On-demand emit functions (for use after tool execution)
// ---------------------------------------------------------------------------

/**
 * Immediately poll and emit nodes + VMs data to the /cluster namespace.
 * Called after tool execution so the UI reflects changes without waiting
 * for the next polling interval.
 */
export async function emitNodesNow(): Promise<void> {
  await Promise.all([emitNodes(), emitVMs(), emitQuorum()]);
}

/**
 * Immediately poll and emit storage data to the /cluster namespace.
 */
/**
 * Emit voice agent status to the /cluster namespace.
 */
function emitVoiceAgents(): void {
  if (!clusterNamespace) return;
  const agents = getVoiceAgents();
  clusterNamespace.emit('voice_agents', { agents, timestamp: Date.now() });
}

export async function emitStorageNow(): Promise<void> {
  await emitStorage();
}

/**
 * Emit ALL data categories immediately (used on first client connection).
 */
async function emitAllNow(): Promise<void> {
  await Promise.all([
    emitNodes(),
    emitVMs(),
    emitStorage(),
    emitQuorum(),
    emitTemperature(),
  ]);
}

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------

/**
 * Start the real-time emitter. Begins polling the Proxmox API and emitting
 * data to the /cluster Socket.IO namespace at configured intervals.
 *
 * Also sets up a connection handler that sends an immediate snapshot to
 * newly connected clients.
 */
export function startEmitter(ns: Namespace): void {
  clusterNamespace = ns;

  // Immediate emit on first connection
  ns.on('connection', (socket) => {
    // Send a full data snapshot to the newly connected client
    emitAllNow().catch((err) => {
      console.warn('[Emitter] Failed initial emit for new client:', err instanceof Error ? err.message : err);
    });

    socket.on('requestRefresh', () => {
      emitAllNow().catch((err) => {
        console.warn('[Emitter] Failed refresh emit:', err instanceof Error ? err.message : err);
      });
    });
  });

  // Start polling intervals
  intervals.push(setInterval(() => { emitNodes().catch(() => {}); }, 10_000));
  intervals.push(setInterval(() => { emitVMs().catch(() => {}); }, 15_000));
  intervals.push(setInterval(() => { emitStorage().catch(() => {}); }, 30_000));
  intervals.push(setInterval(() => { emitQuorum().catch(() => {}); }, 10_000));
  intervals.push(setInterval(() => { emitTemperature().catch(() => {}); }, 30_000));
  intervals.push(setInterval(() => { emitVoiceAgents(); }, 10_000));

  console.log('[Emitter] Real-time data emitter started');
  console.log('[Emitter]   Nodes:       every 10s');
  console.log('[Emitter]   VMs/CTs:     every 15s');
  console.log('[Emitter]   Storage:     every 30s');
  console.log('[Emitter]   Quorum:      every 10s');
  console.log('[Emitter]   Temperature: every 30s');
  console.log('[Emitter]   Voice:       every 10s');
}

/**
 * Stop the real-time emitter. Clears all polling intervals.
 * Called during graceful shutdown.
 */
export function stopEmitter(): void {
  for (const id of intervals) {
    clearInterval(id);
  }
  intervals.length = 0;
  clusterNamespace = null;
  console.log('[Emitter] Real-time data emitter stopped');
}

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { NodeData, VMData, StorageData, QuorumData } from '../types/cluster';
import type { JarvisEvent, MonitorStatus } from '../types/events';

// ---------------------------------------------------------------------------
// PERF-17: Diff helpers — only create new references for changed items
// ---------------------------------------------------------------------------

function nodeEquals(a: NodeData, b: NodeData): boolean {
  return a.node === b.node && a.status === b.status &&
    a.cpu === b.cpu && a.maxcpu === b.maxcpu &&
    a.mem === b.mem && a.maxmem === b.maxmem &&
    a.disk === b.disk && a.maxdisk === b.maxdisk &&
    a.uptime === b.uptime;
}

function vmEquals(a: VMData, b: VMData): boolean {
  return a.vmid === b.vmid && a.name === b.name && a.status === b.status &&
    a.node === b.node && a.cpu === b.cpu &&
    a.mem === b.mem && a.maxmem === b.maxmem &&
    a.netin === b.netin && a.netout === b.netout &&
    a.uptime === b.uptime;
}

function storageEquals(a: StorageData, b: StorageData): boolean {
  return a.storage === b.storage && a.node === b.node &&
    a.status === b.status && a.type === b.type &&
    a.total === b.total && a.used === b.used && a.avail === b.avail;
}

/**
 * Merge incoming array with current, preserving references for unchanged items.
 * Returns null if nothing changed (skip state update entirely).
 */
function mergeArray<T>(
  current: T[],
  incoming: T[],
  keyFn: (item: T) => string | number,
  equalsFn: (a: T, b: T) => boolean,
): T[] | null {
  if (current.length === 0 && incoming.length === 0) return null;
  if (current.length !== incoming.length) return incoming;

  let changed = false;
  const merged = incoming.map((next) => {
    const key = keyFn(next);
    const existing = current.find((c) => keyFn(c) === key);
    if (existing && equalsFn(existing, next)) {
      return existing; // preserve reference → React.memo skips re-render
    }
    changed = true;
    // Merge to preserve extra fields (e.g. temperatures on NodeData)
    return existing ? { ...existing, ...next } : next;
  });

  return changed ? merged : null;
}

function quorumEquals(a: QuorumData | null, b: QuorumData): boolean {
  if (!a) return false;
  return a.quorate === b.quorate && a.nodes === b.nodes && a.expected === b.expected;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ClusterState {
  nodes: NodeData[];
  vms: VMData[];
  storage: StorageData[];
  quorum: QuorumData | null;
  events: JarvisEvent[];
  connected: boolean;
  lastUpdate: Record<string, number>;
  monitorStatus: MonitorStatus | null;

  setNodes: (nodes: NodeData[]) => void;
  setVMs: (vms: VMData[]) => void;
  setStorage: (storage: StorageData[]) => void;
  setQuorum: (quorum: QuorumData) => void;
  addEvent: (event: JarvisEvent) => void;
  setConnected: (connected: boolean) => void;
  isStale: (key: string, maxAgeMs: number) => boolean;
  setMonitorStatus: (status: MonitorStatus) => void;
  setTemperatures: (temps: Array<{ node: string; zones: Record<string, number> }>) => void;
  setEvents: (events: JarvisEvent[]) => void;
  setKillSwitch: (active: boolean) => void;
}

export const useClusterStore = create<ClusterState>()(
  devtools(
    (set, get) => ({
      nodes: [],
      vms: [],
      storage: [],
      quorum: null,
      events: [],
      connected: false,
      lastUpdate: {},
      monitorStatus: null,

      /** PERF-17: Only create new node references for nodes with changed data */
      setNodes: (incoming) => {
        const updated = mergeArray(get().nodes, incoming, (n) => n.node, nodeEquals);
        if (!updated) return;
        set(
          { nodes: updated, lastUpdate: { ...get().lastUpdate, nodes: Date.now() } },
          false,
          'cluster/setNodes',
        );
      },

      /** PERF-17: Only create new VM references for VMs with changed data */
      setVMs: (incoming) => {
        const updated = mergeArray(get().vms, incoming, (v) => v.vmid, vmEquals);
        if (!updated) return;
        set(
          { vms: updated, lastUpdate: { ...get().lastUpdate, vms: Date.now() } },
          false,
          'cluster/setVMs',
        );
      },

      /** PERF-17: Only create new storage references for storage with changed data */
      setStorage: (incoming) => {
        const updated = mergeArray(
          get().storage, incoming,
          (s) => `${s.node}:${s.storage}`,
          storageEquals,
        );
        if (!updated) return;
        set(
          { storage: updated, lastUpdate: { ...get().lastUpdate, storage: Date.now() } },
          false,
          'cluster/setStorage',
        );
      },

      setQuorum: (quorum) => {
        if (quorumEquals(get().quorum, quorum)) return;
        set(
          { quorum, lastUpdate: { ...get().lastUpdate, quorum: Date.now() } },
          false,
          'cluster/setQuorum',
        );
      },

      addEvent: (event) =>
        set(
          (state) => ({
            events: [event, ...state.events].slice(0, 100),
            lastUpdate: { ...state.lastUpdate, events: Date.now() },
          }),
          false,
          'cluster/addEvent',
        ),

      setConnected: (connected) =>
        set({ connected }, false, 'cluster/setConnected'),

      /** PERF-17: Only update nodes whose temperatures actually changed */
      setTemperatures: (temps) => {
        const current = get().nodes;
        let changed = false;
        const updated = current.map((n) => {
          const match = temps.find((t) => t.node === n.node);
          if (!match) return n;
          // Compare temperature zones
          const existing = n.temperatures;
          if (existing) {
            const keys = Object.keys(match.zones);
            const same = keys.length === Object.keys(existing).length &&
              keys.every((k) => existing[k] === match.zones[k]);
            if (same) return n; // preserve reference
          }
          changed = true;
          return { ...n, temperatures: match.zones };
        });
        if (!changed) return;
        set(
          { nodes: updated, lastUpdate: { ...get().lastUpdate, temperature: Date.now() } },
          false,
          'cluster/setTemperatures',
        );
      },

      setEvents: (events) =>
        set(
          { events: events.slice(0, 100), lastUpdate: { ...get().lastUpdate, events: Date.now() } },
          false,
          'cluster/setEvents',
        ),

      setMonitorStatus: (status) =>
        set({ monitorStatus: status }, false, 'cluster/setMonitorStatus'),

      setKillSwitch: (active) =>
        set(
          (state) => ({
            monitorStatus: state.monitorStatus
              ? { ...state.monitorStatus, killSwitch: active }
              : { killSwitch: active, autonomyLevel: 3, running: true },
          }),
          false,
          'cluster/setKillSwitch',
        ),

      isStale: (key, maxAgeMs) => {
        const last = get().lastUpdate[key];
        if (!last) return true;
        return Date.now() - last > maxAgeMs;
      },
    }),
    { name: 'cluster-store' },
  ),
);

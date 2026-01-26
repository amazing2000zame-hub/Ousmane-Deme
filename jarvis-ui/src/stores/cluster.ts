import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { NodeData, VMData, StorageData, QuorumData } from '../types/cluster';
import type { JarvisEvent } from '../types/events';

interface ClusterState {
  nodes: NodeData[];
  vms: VMData[];
  storage: StorageData[];
  quorum: QuorumData | null;
  events: JarvisEvent[];
  connected: boolean;
  lastUpdate: Record<string, number>;

  setNodes: (nodes: NodeData[]) => void;
  setVMs: (vms: VMData[]) => void;
  setStorage: (storage: StorageData[]) => void;
  setQuorum: (quorum: QuorumData) => void;
  addEvent: (event: JarvisEvent) => void;
  setConnected: (connected: boolean) => void;
  isStale: (key: string, maxAgeMs: number) => boolean;
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

      setNodes: (nodes) =>
        set(
          { nodes, lastUpdate: { ...get().lastUpdate, nodes: Date.now() } },
          false,
          'cluster/setNodes',
        ),

      setVMs: (vms) =>
        set(
          { vms, lastUpdate: { ...get().lastUpdate, vms: Date.now() } },
          false,
          'cluster/setVMs',
        ),

      setStorage: (storage) =>
        set(
          { storage, lastUpdate: { ...get().lastUpdate, storage: Date.now() } },
          false,
          'cluster/setStorage',
        ),

      setQuorum: (quorum) =>
        set(
          { quorum, lastUpdate: { ...get().lastUpdate, quorum: Date.now() } },
          false,
          'cluster/setQuorum',
        ),

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

      isStale: (key, maxAgeMs) => {
        const last = get().lastUpdate[key];
        if (!last) return true;
        return Date.now() - last > maxAgeMs;
      },
    }),
    { name: 'cluster-store' },
  ),
);

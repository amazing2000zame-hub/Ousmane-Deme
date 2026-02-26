/** Data for a single cluster node */
export interface NodeData {
  id: string;
  node: string;
  status: 'online' | 'offline';
  cpu: number;           // fraction 0-1
  maxcpu: number;
  mem: number;           // bytes used
  maxmem: number;        // bytes total
  disk: number;          // bytes used
  maxdisk: number;       // bytes total
  uptime: number;        // seconds
  temperatures: Record<string, number>;  // thermal zone -> degrees C
}

/** Data for a single VM or container */
export interface VMData {
  vmid: number;
  name: string;
  status: 'running' | 'stopped' | 'paused';
  type: 'qemu' | 'lxc';
  node: string;
  cpu: number;           // fraction 0-1
  mem: number;           // bytes used
  maxmem: number;        // bytes total
  netin: number;         // bytes
  netout: number;        // bytes
  uptime: number;        // seconds
}

/** Data for a storage pool */
export interface StorageData {
  storage: string;       // storage name
  type: string;          // 'dir' | 'lvmthin' | etc.
  content: string;       // 'images' | 'backup' | etc.
  total: number;         // bytes
  used: number;          // bytes
  avail: number;         // bytes
  status: 'active' | 'inactive';
  node: string;
}

/** Cluster quorum data */
export interface QuorumData {
  quorate: boolean;
  nodes: number;
  expected: number;
}

/** Cluster node configuration (matches backend config) */
export interface ClusterNode {
  name: string;
  host: string;          // IP address
}

/** Voice agent status from jarvis-ear daemon */
export type VoiceAgentState = 'idle' | 'listening' | 'capturing' | 'processing' | 'speaking';

export interface VoiceAgentStatus {
  agentId: string;
  connected: boolean;
  state: VoiceAgentState;
  connectedAt: number;
  lastInteractionAt: number;
}

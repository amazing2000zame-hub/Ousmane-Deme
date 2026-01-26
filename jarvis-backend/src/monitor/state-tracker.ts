/**
 * StateTracker -- maintains last-known state of nodes and VMs in memory.
 *
 * Detects state transitions (node online->offline, VM running->stopped) and
 * returns StateChange objects for each detected transition. The first poll
 * populates state without emitting changes (prevents false alerts on startup).
 */

import type { NodeData, VMData } from '../realtime/emitter.js';
import type { StateChange, ConditionType } from './types.js';

interface TrackedNode {
  status: string;
  lastSeen: number;
}

interface TrackedVM {
  status: string;
  node: string;
  type: 'qemu' | 'lxc';
  lastSeen: number;
}

export class StateTracker {
  private nodes = new Map<string, TrackedNode>();
  private vms = new Map<number, TrackedVM>();

  /**
   * Update tracked node state. Returns StateChange[] for any transitions.
   * First call for each node populates state without emitting changes.
   */
  updateNodes(current: NodeData[]): StateChange[] {
    const changes: StateChange[] = [];
    const now = Date.now();

    for (const node of current) {
      const tracked = this.nodes.get(node.name);

      if (!tracked) {
        // First time seeing this node -- populate without emitting
        this.nodes.set(node.name, { status: node.status, lastSeen: now });
        continue;
      }

      if (tracked.status !== node.status) {
        const conditionType: ConditionType =
          node.status === 'offline' ? 'NODE_UNREACHABLE' : 'NODE_UNREACHABLE';

        changes.push({
          type: conditionType,
          target: node.name,
          node: node.name,
          previousState: tracked.status,
          currentState: node.status,
          timestamp: new Date().toISOString(),
          details: { host: node.host },
        });
      }

      // Update tracked state
      this.nodes.set(node.name, { status: node.status, lastSeen: now });
    }

    return changes;
  }

  /**
   * Update tracked VM/CT state. Returns StateChange[] for any transitions.
   * First call for each VM populates state without emitting changes.
   * Only emits VM_CRASHED/CT_CRASHED when transitioning FROM 'running' TO 'stopped'.
   */
  updateVMs(current: VMData[]): StateChange[] {
    const changes: StateChange[] = [];
    const now = Date.now();

    for (const vm of current) {
      const tracked = this.vms.get(vm.vmid);

      if (!tracked) {
        // First time seeing this VM -- populate without emitting
        this.vms.set(vm.vmid, {
          status: vm.status,
          node: vm.node,
          type: vm.type,
          lastSeen: now,
        });
        continue;
      }

      if (tracked.status !== vm.status) {
        // Determine condition type based on transition
        let conditionType: ConditionType;
        if (tracked.status === 'running' && vm.status === 'stopped') {
          conditionType = vm.type === 'lxc' ? 'CT_CRASHED' : 'VM_CRASHED';
        } else if (vm.status === 'stopped' && tracked.status !== 'running') {
          // Already stopped / paused -> stopped -- not a crash
          this.vms.set(vm.vmid, {
            status: vm.status,
            node: vm.node,
            type: vm.type,
            lastSeen: now,
          });
          continue;
        } else {
          // Other transitions (stopped->running, paused->running, etc.) -- informational
          conditionType = vm.type === 'lxc' ? 'CT_CRASHED' : 'VM_CRASHED';
        }

        changes.push({
          type: conditionType,
          target: `${vm.name} (${vm.vmid})`,
          node: vm.node,
          previousState: tracked.status,
          currentState: vm.status,
          timestamp: new Date().toISOString(),
          details: {
            vmid: vm.vmid,
            name: vm.name,
            vmType: vm.type,
          },
        });
      }

      // Update tracked state
      this.vms.set(vm.vmid, {
        status: vm.status,
        node: vm.node,
        type: vm.type,
        lastSeen: now,
      });
    }

    return changes;
  }

  /** Get the last tracked status for a node */
  getTrackedNodeStatus(name: string): string | undefined {
    return this.nodes.get(name)?.status;
  }

  /** Get the last tracked status for a VM */
  getTrackedVMStatus(vmid: number): string | undefined {
    return this.vms.get(vmid)?.status;
  }
}

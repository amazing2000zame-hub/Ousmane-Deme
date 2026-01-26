/**
 * Unit tests for the 4-tier safety framework.
 * Pure functions — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import { checkSafety, getToolTier, ActionTier } from '../safety/tiers.js';
import { isProtectedResource } from '../safety/protected.js';

describe('getToolTier', () => {
  it('classifies monitoring tools as GREEN', () => {
    expect(getToolTier('get_cluster_status')).toBe(ActionTier.GREEN);
    expect(getToolTier('get_vms')).toBe(ActionTier.GREEN);
    expect(getToolTier('get_node_temperature')).toBe(ActionTier.GREEN);
    expect(getToolTier('get_storage')).toBe(ActionTier.GREEN);
  });

  it('classifies operational tools as YELLOW', () => {
    expect(getToolTier('execute_ssh')).toBe(ActionTier.YELLOW);
    expect(getToolTier('restart_service')).toBe(ActionTier.YELLOW);
    expect(getToolTier('wake_node')).toBe(ActionTier.YELLOW);
    expect(getToolTier('start_vm')).toBe(ActionTier.YELLOW);
  });

  it('classifies lifecycle tools as RED', () => {
    expect(getToolTier('stop_vm')).toBe(ActionTier.RED);
    expect(getToolTier('restart_vm')).toBe(ActionTier.RED);
    expect(getToolTier('stop_container')).toBe(ActionTier.RED);
    expect(getToolTier('restart_container')).toBe(ActionTier.RED);
  });

  it('classifies destructive tools as BLACK', () => {
    expect(getToolTier('reboot_node')).toBe(ActionTier.BLACK);
  });

  it('defaults unknown tools to BLACK (fail-safe)', () => {
    expect(getToolTier('unknown_tool')).toBe(ActionTier.BLACK);
    expect(getToolTier('delete_everything')).toBe(ActionTier.BLACK);
  });
});

describe('checkSafety', () => {
  // GREEN tier
  it('allows GREEN tools without confirmation', () => {
    const result = checkSafety('get_cluster_status', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe(ActionTier.GREEN);
  });

  // YELLOW tier
  it('allows YELLOW tools without confirmation', () => {
    const result = checkSafety('execute_ssh', { command: 'uptime', host: '192.168.1.50' });
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe(ActionTier.YELLOW);
  });

  // RED tier
  it('blocks RED tools without confirmation', () => {
    const result = checkSafety('stop_vm', { vmid: 100 });
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe(ActionTier.RED);
    expect(result.reason).toContain('requires confirmed');
  });

  it('allows RED tools with confirmation', () => {
    const result = checkSafety('stop_vm', { vmid: 100 }, true);
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe(ActionTier.RED);
  });

  // BLACK tier
  it('blocks BLACK tools always', () => {
    const result = checkSafety('reboot_node', { node: 'pve' });
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe(ActionTier.BLACK);
    expect(result.reason).toContain('BLACK tier');
  });

  it('blocks unknown tools (fail-safe to BLACK)', () => {
    const result = checkSafety('destroy_cluster', {});
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe(ActionTier.BLACK);
  });

  // Override
  it('allows BLACK tools with override active', () => {
    const result = checkSafety('reboot_node', { node: 'pve' }, false, true);
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe(ActionTier.BLACK);
  });

  it('allows RED tools with override without confirmation', () => {
    const result = checkSafety('stop_vm', { vmid: 100 }, false, true);
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe(ActionTier.RED);
  });

  // Protected resources (override cannot bypass)
  it('blocks actions targeting protected VMID 103 even with override', () => {
    const result = checkSafety('stop_vm', { vmid: 103 }, true, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('management VM');
  });

  it('blocks actions targeting Docker service', () => {
    const result = checkSafety('restart_service', { service: 'docker' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('critical');
  });

  it('blocks commands referencing docker.service', () => {
    const result = checkSafety('execute_ssh', { command: 'systemctl restart docker.service' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('protected service');
  });
});

describe('isProtectedResource', () => {
  it('detects protected VMID 103', () => {
    expect(isProtectedResource({ vmid: 103 }).protected).toBe(true);
    expect(isProtectedResource({ vmid: '103' }).protected).toBe(true);
    expect(isProtectedResource({ id: 103 }).protected).toBe(true);
  });

  it('does not flag non-protected VMIDs', () => {
    expect(isProtectedResource({ vmid: 100 }).protected).toBe(false);
    expect(isProtectedResource({ vmid: 300 }).protected).toBe(false);
  });

  it('detects Docker service', () => {
    expect(isProtectedResource({ service: 'docker' }).protected).toBe(true);
    expect(isProtectedResource({ service: 'docker.service' }).protected).toBe(true);
    expect(isProtectedResource({ serviceName: 'docker' }).protected).toBe(true);
  });

  it('does not flag normal services', () => {
    expect(isProtectedResource({ service: 'nginx' }).protected).toBe(false);
    expect(isProtectedResource({ service: 'pvedaemon' }).protected).toBe(false);
  });

  it('returns not protected for empty args', () => {
    expect(isProtectedResource({}).protected).toBe(false);
  });
});

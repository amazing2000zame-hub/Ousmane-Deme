/**
 * Unit tests for the intent-based message router.
 * Mocks external dependencies (claudeAvailable, checkDailyBudget).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the claude module
vi.mock('../ai/claude.js', () => ({
  claudeAvailable: true,
  default: null,
}));

// Mock the cost-tracker module
vi.mock('../ai/cost-tracker.js', () => ({
  checkDailyBudget: vi.fn(() => ({ spent: 0, limit: 10, exceeded: false })),
  calculateCost: vi.fn(() => 0),
}));

// Mock the DB modules (router imports cost-tracker which imports DB)
vi.mock('../db/index.js', () => ({
  db: {},
  sqlite: { exec: vi.fn(), prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })) },
}));

vi.mock('../config.js', () => ({
  config: {
    dailyCostLimit: 10.0,
    overrideKey: 'override alpha',
  },
}));

import { routeMessage } from '../ai/router.js';
import { checkDailyBudget } from '../ai/cost-tracker.js';
import * as claudeModule from '../ai/claude.js';

describe('routeMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkDailyBudget).mockReturnValue({ spent: 0, limit: 10, exceeded: false });
    // Reset claudeAvailable
    Object.defineProperty(claudeModule, 'claudeAvailable', { value: true, writable: true });
  });

  // Stage 1: Override
  it('routes to Claude when override is active', () => {
    const result = routeMessage('hello', true);
    expect(result.provider).toBe('claude');
    expect(result.reason).toContain('override');
  });

  // Stage 2: Action keywords
  it('routes "restart pve" to Claude (action keyword)', () => {
    const result = routeMessage('restart pve', false);
    expect(result.provider).toBe('claude');
    expect(result.reason).toContain('cluster action');
  });

  it('routes "stop VM 100" to Claude (action keyword)', () => {
    const result = routeMessage('stop VM 100', false);
    expect(result.provider).toBe('claude');
    expect(result.reason).toContain('cluster action');
  });

  it('routes "start the backup" to Claude (action keyword)', () => {
    const result = routeMessage('start the backup', false);
    expect(result.provider).toBe('claude');
  });

  // Stage 3: Entity references
  it('routes "how is pve doing" to Claude (entity reference)', () => {
    const result = routeMessage('how is pve doing', false);
    expect(result.provider).toBe('claude');
  });

  it('routes "check node agent1" to Claude (entity reference)', () => {
    const result = routeMessage('check node agent1', false);
    expect(result.provider).toBe('claude');
  });

  it('routes messages mentioning VMID 103 to Claude', () => {
    const result = routeMessage('what is VMID 103 doing', false);
    expect(result.provider).toBe('claude');
  });

  it('routes "cluster status" to Claude', () => {
    const result = routeMessage('show me the cluster status', false);
    expect(result.provider).toBe('claude');
  });

  // Stage 3b: Query keywords
  it('routes "show disk usage" to Claude (query keyword)', () => {
    const result = routeMessage('show disk usage', false);
    expect(result.provider).toBe('claude');
  });

  // Stage 4: Follow-up
  it('routes follow-up "yes do it" to Claude when last was Claude', () => {
    const result = routeMessage('yes do it', false, 'claude');
    expect(result.provider).toBe('claude');
    expect(result.reason).toContain('follow-up');
  });

  it('routes follow-up question "?" to Claude when last was Claude', () => {
    const result = routeMessage('what happened next?', false, 'claude');
    expect(result.provider).toBe('claude');
  });

  it('does NOT follow-up route when last was Qwen', () => {
    const result = routeMessage('yes do it', false, 'qwen');
    expect(result.provider).toBe('qwen');
  });

  // Stage 5: Budget exceeded
  it('routes to Qwen when budget is exceeded', () => {
    vi.mocked(checkDailyBudget).mockReturnValue({ spent: 10.5, limit: 10, exceeded: true });
    const result = routeMessage('restart pve', false);
    expect(result.provider).toBe('qwen');
    expect(result.reason).toContain('budget');
  });

  it('override bypasses budget check', () => {
    vi.mocked(checkDailyBudget).mockReturnValue({ spent: 10.5, limit: 10, exceeded: true });
    const result = routeMessage('restart pve', true);
    expect(result.provider).toBe('claude');
    expect(result.reason).toContain('override');
  });

  // Stage 6: Claude unavailable
  it('routes to Qwen when Claude is unavailable', () => {
    Object.defineProperty(claudeModule, 'claudeAvailable', { value: false, writable: true });
    const result = routeMessage('restart pve', false);
    expect(result.provider).toBe('qwen');
    expect(result.reason).toContain('unavailable');
  });

  // Stage 7: Default conversational
  it('routes greetings to Qwen (conversational)', () => {
    const result = routeMessage('good morning jarvis', false);
    expect(result.provider).toBe('qwen');
    expect(result.reason).toContain('conversational');
  });

  it('routes "tell me a joke" to Qwen', () => {
    const result = routeMessage('tell me a joke', false);
    expect(result.provider).toBe('qwen');
  });

  it('routes casual conversation to Qwen', () => {
    const result = routeMessage('thanks for your help today', false);
    expect(result.provider).toBe('qwen');
  });
});

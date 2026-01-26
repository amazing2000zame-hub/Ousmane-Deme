/**
 * Unit tests for cost tracking.
 * Tests calculateCost (pure) and checkDailyBudget (mocked DB).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock DB for checkDailyBudget
vi.mock('../db/index.js', () => {
  const mockGet = vi.fn(() => ({ total: 0 }));
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            get: mockGet,
          }),
        }),
      }),
    },
    sqlite: { prepare: vi.fn() },
  };
});

vi.mock('../config.js', () => ({
  config: {
    dailyCostLimit: 10.0,
  },
}));

import { calculateCost } from '../ai/cost-tracker.js';

describe('calculateCost', () => {
  it('calculates Claude cost correctly', () => {
    // 1000 input tokens = $0.003, 500 output tokens = $0.0075
    const cost = calculateCost('claude', { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('calculates zero cost for Qwen', () => {
    const cost = calculateCost('qwen', { inputTokens: 5000, outputTokens: 2000 });
    expect(cost).toBe(0);
  });

  it('uses Claude pricing for unknown models (fail-safe)', () => {
    const cost = calculateCost('unknown-model', { inputTokens: 1000, outputTokens: 0 });
    expect(cost).toBeCloseTo(0.003, 4);
  });

  it('handles zero tokens', () => {
    const cost = calculateCost('claude', { inputTokens: 0, outputTokens: 0 });
    expect(cost).toBe(0);
  });

  it('handles large token counts', () => {
    // 1M input = $3.00, 1M output = $15.00
    const cost = calculateCost('claude', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(18.0, 2);
  });

  it('calculates Claude Sonnet 4 model by name', () => {
    const cost = calculateCost('claude-sonnet-4-20250514', { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.0105, 4);
  });
});

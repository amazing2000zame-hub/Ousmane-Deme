/**
 * Token-to-dollar cost tracking for LLM usage.
 *
 * Pricing as of 2026-01-26 (Claude Sonnet 4):
 *   Input:  $3.00 / 1M tokens
 *   Output: $15.00 / 1M tokens
 * Qwen is free (local inference).
 */

import { db } from '../db/index.js';
import { conversations } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  claude: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  'claude-sonnet-4-20250514': {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  qwen: {
    inputPerMillion: 0,
    outputPerMillion: 0,
  },
};

/**
 * Calculate the dollar cost of a single LLM request.
 */
export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['claude'];
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

export interface BudgetStatus {
  spent: number;
  limit: number;
  exceeded: boolean;
}

/**
 * Check if daily budget cap has been reached.
 * Uses synchronous better-sqlite3 under the hood.
 */
export function checkDailyBudget(): BudgetStatus {
  const dailyLimit = config.dailyCostLimit;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const spent = getTotalCostSince(`${today}T00:00:00`);

  return {
    spent,
    limit: dailyLimit,
    exceeded: spent >= dailyLimit,
  };
}

/**
 * Get total USD cost since a given timestamp.
 */
function getTotalCostSince(timestamp: string): number {
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${conversations.costUsd} AS REAL)), 0)` })
    .from(conversations)
    .where(sql`${conversations.timestamp} >= ${timestamp}`)
    .get();

  return result?.total ?? 0;
}

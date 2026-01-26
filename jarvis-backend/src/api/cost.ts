/**
 * REST API for cost analytics and session attribution.
 *
 * Endpoints:
 *   GET /api/cost/summary?period=daily|weekly|monthly
 *   GET /api/cost/sessions?limit=10
 *   GET /api/cost/history?days=7
 *   GET /api/cost/budget
 */

import { Router } from 'express';
import { db } from '../db/index.js';
import { conversations } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { checkDailyBudget } from '../ai/cost-tracker.js';

export const costRouter = Router();

/**
 * GET /summary -- aggregated cost by time period.
 */
costRouter.get('/summary', (_req, res) => {
  const period = (_req.query.period as string) || 'daily';

  const now = new Date();
  let since: string;

  switch (period) {
    case 'weekly':
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case 'monthly':
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case 'daily':
    default: {
      const today = now.toISOString().split('T')[0];
      since = `${today}T00:00:00`;
      break;
    }
  }

  const result = db
    .select({
      model: conversations.model,
      totalCost: sql<number>`COALESCE(SUM(CAST(${conversations.costUsd} AS REAL)), 0)`,
      totalInputTokens: sql<number>`COALESCE(SUM(${conversations.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${conversations.outputTokens}), 0)`,
      messageCount: sql<number>`COUNT(*)`,
    })
    .from(conversations)
    .where(sql`${conversations.timestamp} >= ${since}`)
    .groupBy(conversations.model)
    .all();

  const total = result.reduce((sum, r) => sum + (r.totalCost ?? 0), 0);

  res.json({ period, since, summary: result, total });
});

/**
 * GET /sessions -- cost breakdown by session.
 */
costRouter.get('/sessions', (req, res) => {
  const limit = parseInt((req.query.limit as string) || '10', 10);

  const result = db
    .select({
      sessionId: conversations.sessionId,
      model: conversations.model,
      totalCost: sql<number>`COALESCE(SUM(CAST(${conversations.costUsd} AS REAL)), 0)`,
      messageCount: sql<number>`COUNT(*)`,
      firstMessage: sql<string>`MIN(${conversations.timestamp})`,
      lastMessage: sql<string>`MAX(${conversations.timestamp})`,
    })
    .from(conversations)
    .groupBy(conversations.sessionId)
    .orderBy(sql`MAX(${conversations.timestamp}) DESC`)
    .limit(limit)
    .all();

  res.json({ sessions: result });
});

/**
 * GET /history -- daily cost trend for the past N days.
 */
costRouter.get('/history', (req, res) => {
  const days = parseInt((req.query.days as string) || '7', 10);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const result = db
    .select({
      date: sql<string>`DATE(${conversations.timestamp})`,
      totalCost: sql<number>`COALESCE(SUM(CAST(${conversations.costUsd} AS REAL)), 0)`,
      claudeMessages: sql<number>`COUNT(CASE WHEN ${conversations.model} = 'claude' THEN 1 END)`,
      qwenMessages: sql<number>`COUNT(CASE WHEN ${conversations.model} = 'qwen' THEN 1 END)`,
    })
    .from(conversations)
    .where(sql`DATE(${conversations.timestamp}) >= ${since}`)
    .groupBy(sql`DATE(${conversations.timestamp})`)
    .orderBy(sql`DATE(${conversations.timestamp}) DESC`)
    .all();

  res.json({ days, history: result });
});

/**
 * GET /budget -- current daily budget status.
 */
costRouter.get('/budget', (_req, res) => {
  const status = checkDailyBudget();

  res.json({
    dailyLimit: status.limit,
    spent: status.spent,
    remaining: Math.max(0, status.limit - status.spent),
    percentUsed: status.limit > 0 ? Math.round((status.spent / status.limit) * 100) : 0,
    exceeded: status.exceeded,
  });
});

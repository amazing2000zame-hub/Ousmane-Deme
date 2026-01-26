/**
 * REST API for memory management.
 *
 * Endpoints:
 *   GET  /api/memory/search?q=...&limit=20    Search memories by keyword
 *   GET  /api/memory/stats                    Memory statistics by tier/category
 *   GET  /api/memory/recent?limit=20          Recent memories across all tiers
 *   GET  /api/memory/preferences              All semantic-tier preferences
 *   DELETE /api/memory/:id                    Delete a specific memory
 *   DELETE /api/memory/tier/:tier             Purge all memories in a tier
 *   POST /api/memory                          Manually create a memory
 */

import { Router } from 'express';
import { memoryBank, type MemoryTier, type MemoryCategory, type MemorySource } from '../db/memories.js';

export const memoryRouter = Router();

/**
 * GET /search -- search memories by keyword.
 */
memoryRouter.get('/search', (req, res) => {
  const q = (req.query.q as string) || '';
  const limit = parseInt((req.query.limit as string) || '20', 10);

  if (!q.trim()) {
    res.status(400).json({ error: 'Query parameter "q" is required' });
    return;
  }

  const results = memoryBank.searchMemories(q.trim(), limit);
  res.json({ query: q, results, total: results.length });
});

/**
 * GET /stats -- memory statistics.
 */
memoryRouter.get('/stats', (_req, res) => {
  const stats = memoryBank.getMemoryStats();
  res.json(stats);
});

/**
 * GET /recent -- recent memories across all tiers.
 */
memoryRouter.get('/recent', (req, res) => {
  const limit = parseInt((req.query.limit as string) || '20', 10);
  const memories = memoryBank.getRecentMemories(limit);
  res.json({ memories });
});

/**
 * GET /preferences -- all semantic-tier preference memories.
 */
memoryRouter.get('/preferences', (_req, res) => {
  const preferences = memoryBank.getMemoriesByCategory('user_preference', 100);
  res.json({ preferences });
});

/**
 * DELETE /:id -- delete a specific memory.
 */
memoryRouter.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid memory ID' });
    return;
  }

  memoryBank.deleteMemory(id);
  res.json({ success: true, id });
});

/**
 * DELETE /tier/:tier -- purge all memories in a tier.
 */
memoryRouter.delete('/tier/:tier', (req, res) => {
  const tier = req.params.tier as MemoryTier;
  if (!['conversation', 'episodic', 'semantic'].includes(tier)) {
    res.status(400).json({ error: 'Invalid tier. Must be: conversation, episodic, or semantic' });
    return;
  }

  const deleted = memoryBank.deleteByTier(tier);
  res.json({ success: true, tier, deleted });
});

/**
 * POST / -- manually create a memory.
 */
memoryRouter.post('/', (req, res) => {
  const { tier, category, key, content, source, nodeId } = req.body ?? {};

  if (!tier || !category || !key || !content) {
    res.status(400).json({ error: 'Required fields: tier, category, key, content' });
    return;
  }

  if (!['conversation', 'episodic', 'semantic'].includes(tier)) {
    res.status(400).json({ error: 'Invalid tier' });
    return;
  }

  const memory = memoryBank.upsertMemory({
    tier: tier as MemoryTier,
    category: category as MemoryCategory,
    key,
    content,
    source: (source || 'system') as MemorySource,
    nodeId: nodeId ?? null,
  });

  res.status(201).json({ memory });
});

/**
 * Memory bank — persistent memory with TTL tiers.
 *
 * Three tiers:
 *   - conversation: Session summaries, recent exchanges (7-day TTL)
 *   - episodic: Cluster events, incidents, actions taken (30-day TTL)
 *   - semantic: User preferences, learned facts (permanent, no expiry)
 */

import { sqlite } from './index.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryTier = 'conversation' | 'episodic' | 'semantic';
export type MemoryCategory =
  | 'session_summary'
  | 'node_event'
  | 'user_preference'
  | 'learned_fact'
  | 'incident'
  | 'cluster_state';
export type MemorySource = 'chat' | 'event' | 'user' | 'system';

export interface Memory {
  id: number;
  tier: MemoryTier;
  category: MemoryCategory;
  key: string;
  content: string;
  source: MemorySource;
  sessionId: string | null;
  nodeId: string | null;
  createdAt: string;
  expiresAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
}

export interface SaveMemoryInput {
  tier: MemoryTier;
  category: MemoryCategory;
  key: string;
  content: string;
  source: MemorySource;
  sessionId?: string | null;
  nodeId?: string | null;
}

export interface MemoryStats {
  total: number;
  byTier: Record<string, number>;
  byCategory: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Prepared statements (lazily created after migration runs)
// ---------------------------------------------------------------------------

let stmts: ReturnType<typeof prepareStatements> | null = null;

function prepareStatements() {
  return {
    insert: sqlite.prepare(`
      INSERT INTO memories (tier, category, key, content, source, session_id, node_id, created_at, expires_at, access_count, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
    `),
    upsert: sqlite.prepare(`
      INSERT INTO memories (tier, category, key, content, source, session_id, node_id, created_at, expires_at, access_count, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
      ON CONFLICT(key) DO UPDATE SET
        content = excluded.content,
        source = excluded.source,
        session_id = excluded.session_id,
        node_id = excluded.node_id,
        expires_at = excluded.expires_at
    `),
    getByKey: sqlite.prepare(`SELECT * FROM memories WHERE key = ?`),
    getByTier: sqlite.prepare(`SELECT * FROM memories WHERE tier = ? ORDER BY created_at DESC LIMIT ?`),
    getByCategory: sqlite.prepare(`SELECT * FROM memories WHERE category = ? ORDER BY created_at DESC LIMIT ?`),
    getByNode: sqlite.prepare(`SELECT * FROM memories WHERE node_id = ? ORDER BY created_at DESC LIMIT ?`),
    getRecent: sqlite.prepare(`SELECT * FROM memories ORDER BY created_at DESC LIMIT ?`),
    search: sqlite.prepare(`
      SELECT * FROM memories
      WHERE content LIKE ? OR key LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    touch: sqlite.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?
    `),
    deleteById: sqlite.prepare(`DELETE FROM memories WHERE id = ?`),
    deleteExpired: sqlite.prepare(`
      DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
    `),
    deleteByTier: sqlite.prepare(`DELETE FROM memories WHERE tier = ?`),
    countTotal: sqlite.prepare(`SELECT COUNT(*) as total FROM memories`),
    countByTier: sqlite.prepare(`SELECT tier, COUNT(*) as cnt FROM memories GROUP BY tier`),
    countByCategory: sqlite.prepare(`SELECT category, COUNT(*) as cnt FROM memories GROUP BY category`),
  };
}

function getStmts() {
  if (!stmts) stmts = prepareStatements();
  return stmts;
}

// ---------------------------------------------------------------------------
// TTL helpers
// ---------------------------------------------------------------------------

function computeExpiresAt(tier: MemoryTier): string | null {
  if (tier === 'semantic') return null; // permanent
  const days = tier === 'conversation'
    ? config.memoryConversationTTLDays
    : config.memoryEpisodicTTLDays;
  return new Date(Date.now() + days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

function nowStr(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function saveMemory(input: SaveMemoryInput): Memory {
  const s = getStmts();
  const now = nowStr();
  const expiresAt = computeExpiresAt(input.tier);

  s.insert.run(
    input.tier, input.category, input.key, input.content, input.source,
    input.sessionId ?? null, input.nodeId ?? null,
    now, expiresAt,
  );
  return s.getByKey.get(input.key) as Memory;
}

function upsertMemory(input: SaveMemoryInput): Memory {
  const s = getStmts();
  const now = nowStr();
  const expiresAt = computeExpiresAt(input.tier);

  s.upsert.run(
    input.tier, input.category, input.key, input.content, input.source,
    input.sessionId ?? null, input.nodeId ?? null,
    now, expiresAt,
  );
  return s.getByKey.get(input.key) as Memory;
}

function getMemoryByKey(key: string): Memory | null {
  const row = getStmts().getByKey.get(key) as Memory | undefined;
  return row ?? null;
}

function getMemoriesByTier(tier: MemoryTier, limit = 50): Memory[] {
  return getStmts().getByTier.all(tier, limit) as Memory[];
}

function getMemoriesByCategory(category: string, limit = 50): Memory[] {
  return getStmts().getByCategory.all(category, limit) as Memory[];
}

function getMemoriesByNode(nodeId: string, limit = 50): Memory[] {
  return getStmts().getByNode.all(nodeId, limit) as Memory[];
}

function getRecentMemories(limit = 20): Memory[] {
  return getStmts().getRecent.all(limit) as Memory[];
}

function searchMemories(query: string, limit = 20): Memory[] {
  const pattern = `%${query}%`;
  return getStmts().search.all(pattern, pattern, limit) as Memory[];
}

function touchMemory(id: number): void {
  getStmts().touch.run(id);
}

function deleteMemory(id: number): void {
  getStmts().deleteById.run(id);
}

function deleteExpired(): number {
  const result = getStmts().deleteExpired.run();
  return result.changes;
}

function deleteByTier(tier: MemoryTier): number {
  const result = getStmts().deleteByTier.run(tier);
  return result.changes;
}

function getMemoryStats(): MemoryStats {
  const s = getStmts();
  const total = (s.countTotal.get() as { total: number }).total;
  const byTier: Record<string, number> = {};
  for (const row of s.countByTier.all() as Array<{ tier: string; cnt: number }>) {
    byTier[row.tier] = row.cnt;
  }
  const byCategory: Record<string, number> = {};
  for (const row of s.countByCategory.all() as Array<{ category: string; cnt: number }>) {
    byCategory[row.category] = row.cnt;
  }
  return { total, byTier, byCategory };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const memoryBank = {
  saveMemory,
  upsertMemory,
  getMemoryByKey,
  getMemoriesByTier,
  getMemoriesByCategory,
  getMemoriesByNode,
  getRecentMemories,
  searchMemories,
  touchMemory,
  deleteMemory,
  deleteExpired,
  deleteByTier,
  getMemoryStats,
};

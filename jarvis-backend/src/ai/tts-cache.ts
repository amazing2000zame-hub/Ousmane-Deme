/**
 * Disk-persistent TTS cache with LRU eviction by mtime and time-based expiry.
 *
 * Phase 23: Stores WAV audio buffers keyed by SHA-256 hash of normalized text,
 * separated by engine (xtts/, piper/). Evicts oldest entries when count exceeds
 * config.ttsCacheMaxEntries per engine directory.
 *
 * Quick-001 enhancement: Added 7-day time-based expiry and periodic cleanup.
 *
 * Uses Node.js built-ins only: fs/promises, crypto, path.
 */

import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { config } from '../config.js';

/** Max age for cache entries in milliseconds (7 days) */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create cache directories for each engine.
 * Safe to call multiple times (recursive mkdir is idempotent).
 */
export async function initDiskCache(): Promise<void> {
  await mkdir(join(config.ttsCacheDir, 'xtts'), { recursive: true });
  await mkdir(join(config.ttsCacheDir, 'piper'), { recursive: true });
}

/**
 * Normalize text and produce a SHA-256 hex digest for use as cache filename.
 * Normalization: trim, lowercase, collapse whitespace.
 */
function hashKey(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Build the full filesystem path for a cached entry.
 */
function cachePath(text: string, engine: string): string {
  return join(config.ttsCacheDir, engine, `${hashKey(text)}.wav`);
}

/**
 * Retrieve a cached WAV buffer from disk.
 * Returns null on cache miss (file does not exist or read error).
 */
export async function diskCacheGet(text: string, engine: string): Promise<Buffer | null> {
  try {
    return await readFile(cachePath(text, engine));
  } catch {
    return null; // Cache miss
  }
}

/**
 * Write a WAV buffer to the disk cache.
 * Fire-and-forget eviction check runs after the write completes.
 */
export async function diskCachePut(text: string, engine: string, buffer: Buffer): Promise<void> {
  const path = cachePath(text, engine);
  await writeFile(path, buffer);
  // Fire-and-forget eviction check
  evictOldEntries(engine).catch(() => {});
}

/**
 * Return detailed cache stats per engine (count, size, oldest entry age).
 */
export async function getDiskCacheStats(): Promise<{
  xtts: { count: number; sizeKB: number; oldestDays: number };
  piper: { count: number; sizeKB: number; oldestDays: number };
}> {
  const getEngineStats = async (engine: string) => {
    const dir = join(config.ttsCacheDir, engine);
    try {
      const entries = await readdir(dir);
      if (entries.length === 0) return { count: 0, sizeKB: 0, oldestDays: 0 };

      let totalSize = 0;
      let oldestMtime = Date.now();

      for (const name of entries) {
        const s = await stat(join(dir, name));
        totalSize += s.size;
        if (s.mtimeMs < oldestMtime) oldestMtime = s.mtimeMs;
      }

      const oldestDays = Math.floor((Date.now() - oldestMtime) / (24 * 60 * 60 * 1000));
      return { count: entries.length, sizeKB: Math.round(totalSize / 1024), oldestDays };
    } catch {
      return { count: 0, sizeKB: 0, oldestDays: 0 };
    }
  };

  const [xtts, piper] = await Promise.all([getEngineStats('xtts'), getEngineStats('piper')]);
  return { xtts, piper };
}

/**
 * Evict entries that are either:
 * 1. Older than 7 days (time-based expiry)
 * 2. Beyond the max count limit (LRU by mtime)
 */
async function evictOldEntries(engine: string): Promise<void> {
  const dir = join(config.ttsCacheDir, engine);
  const entries = await readdir(dir);

  // Get file stats and sort by mtime ascending (oldest first)
  const withStats = await Promise.all(
    entries.map(async (name) => {
      const filePath = join(dir, name);
      const s = await stat(filePath);
      return { filePath, mtime: s.mtimeMs };
    })
  );
  withStats.sort((a, b) => a.mtime - b.mtime);

  const now = Date.now();
  const toDelete: string[] = [];

  // First pass: mark entries older than 7 days for deletion
  for (const entry of withStats) {
    if (now - entry.mtime > CACHE_MAX_AGE_MS) {
      toDelete.push(entry.filePath);
    }
  }

  // Second pass: if still over limit, mark oldest for deletion
  const remaining = withStats.filter((e) => !toDelete.includes(e.filePath));
  if (remaining.length > config.ttsCacheMaxEntries) {
    const excess = remaining.slice(0, remaining.length - config.ttsCacheMaxEntries);
    for (const entry of excess) {
      toDelete.push(entry.filePath);
    }
  }

  // Delete marked entries
  for (const filePath of toDelete) {
    await unlink(filePath).catch(() => {});
  }

  if (toDelete.length > 0) {
    console.log(`[TTS Cache] Evicted ${toDelete.length} entries from ${engine}/`);
  }
}

/**
 * Run cleanup on all engines. Called periodically or on demand.
 */
export async function cleanupCache(): Promise<{ evicted: number }> {
  let total = 0;
  for (const engine of ['xtts', 'piper']) {
    const dir = join(config.ttsCacheDir, engine);
    try {
      const entries = await readdir(dir);
      const before = entries.length;
      await evictOldEntries(engine);
      const after = (await readdir(dir)).length;
      total += before - after;
    } catch {
      // Directory doesn't exist, skip
    }
  }
  return { evicted: total };
}

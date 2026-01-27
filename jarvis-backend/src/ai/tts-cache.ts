/**
 * Disk-persistent TTS cache with LRU eviction by mtime.
 *
 * Phase 23: Stores WAV audio buffers keyed by SHA-256 hash of normalized text,
 * separated by engine (xtts/, piper/). Evicts oldest entries when count exceeds
 * config.ttsCacheMaxEntries per engine directory.
 *
 * Uses Node.js built-ins only: fs/promises, crypto, path.
 */

import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { config } from '../config.js';

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
 * Return the number of cached entries per engine directory (for health/debug).
 */
export async function getDiskCacheStats(): Promise<{ xtts: number; piper: number }> {
  const [xttsEntries, piperEntries] = await Promise.all([
    readdir(join(config.ttsCacheDir, 'xtts')).catch(() => []),
    readdir(join(config.ttsCacheDir, 'piper')).catch(() => []),
  ]);
  return { xtts: xttsEntries.length, piper: piperEntries.length };
}

/**
 * Evict oldest entries (by mtime) when directory count exceeds the configured max.
 * Only deletes enough entries to bring the count back to the limit.
 */
async function evictOldEntries(engine: string): Promise<void> {
  const dir = join(config.ttsCacheDir, engine);
  const entries = await readdir(dir);
  if (entries.length <= config.ttsCacheMaxEntries) return;

  // Get file stats and sort by mtime ascending (oldest first)
  const withStats = await Promise.all(
    entries.map(async (name) => {
      const filePath = join(dir, name);
      const s = await stat(filePath);
      return { filePath, mtime: s.mtimeMs };
    })
  );
  withStats.sort((a, b) => a.mtime - b.mtime);

  // Delete oldest entries beyond the limit
  const toDelete = withStats.slice(0, withStats.length - config.ttsCacheMaxEntries);
  for (const entry of toDelete) {
    await unlink(entry.filePath).catch(() => {});
  }
}

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqlite } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run database migrations.
 *
 * Strategy:
 *  1. If the drizzle migrations folder exists (generated via `drizzle-kit generate`),
 *     use drizzle-orm's migrate() to apply them.
 *  2. Otherwise, create tables directly with CREATE TABLE IF NOT EXISTS.
 *
 * This lets us boot a fresh database without needing a build step while also
 * supporting proper migrations when they exist.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = resolve(__dirname, '../../drizzle');

  if (existsSync(migrationsFolder)) {
    // Dynamic import to avoid bundling drizzle migrator when unused
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const { db } = await import('./index.js');
    migrate(db, { migrationsFolder });
    console.log('Database migrations applied (drizzle migrator)');
    return;
  }

  // Fallback: create tables directly for first-run / development
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      source TEXT NOT NULL,
      node TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      resolved_by TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      tokens_used INTEGER,
      tool_calls TEXT
    );

    CREATE TABLE IF NOT EXISTS cluster_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      snapshot TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_node ON events(node);
    CREATE INDEX IF NOT EXISTS idx_events_resolved ON events(resolved);
    CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON cluster_snapshots(timestamp);
  `);

  console.log('Database migrations applied (direct SQL)');
}

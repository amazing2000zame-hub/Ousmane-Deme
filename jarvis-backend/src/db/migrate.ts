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
    CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_conversations_model ON conversations(model);
    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON cluster_snapshots(timestamp);

    CREATE TABLE IF NOT EXISTS autonomy_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      incident_key TEXT NOT NULL,
      incident_id TEXT NOT NULL,
      runbook_id TEXT NOT NULL,
      condition TEXT NOT NULL,
      action TEXT NOT NULL,
      action_args TEXT,
      result TEXT NOT NULL,
      result_details TEXT,
      verification_result TEXT,
      autonomy_level INTEGER NOT NULL,
      node TEXT,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      escalated INTEGER NOT NULL DEFAULT 0,
      email_sent INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_autonomy_actions_timestamp ON autonomy_actions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_autonomy_actions_incident_key ON autonomy_actions(incident_key);
    CREATE INDEX IF NOT EXISTS idx_autonomy_actions_result ON autonomy_actions(result);

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier TEXT NOT NULL,
      category TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      session_id TEXT,
      node_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
    CREATE INDEX IF NOT EXISTS idx_memories_node ON memories(node_id);
  `);

  // Cost tracking columns (07-02): add if missing on existing databases
  try {
    sqlite.exec(`ALTER TABLE conversations ADD COLUMN input_tokens INTEGER;`);
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE conversations ADD COLUMN output_tokens INTEGER;`);
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE conversations ADD COLUMN cost_usd TEXT;`);
  } catch { /* column already exists */ }

  // Phase 27: Presence logs table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS presence_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      person_id TEXT NOT NULL,
      person_name TEXT NOT NULL,
      previous_state TEXT,
      new_state TEXT NOT NULL,
      trigger TEXT NOT NULL,
      trigger_details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_presence_person ON presence_logs(person_id);
    CREATE INDEX IF NOT EXISTS idx_presence_timestamp ON presence_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_presence_state ON presence_logs(new_state);
  `);

  // Phase 40: Reminders table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      fire_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'api',
      delivery TEXT NOT NULL DEFAULT 'telegram',
      chat_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      fired_at INTEGER,
      snooze_count INTEGER NOT NULL DEFAULT 0,
      next_snooze_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(fire_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
  `);

  // Phase 40+: Snooze columns (add to existing databases)
  try {
    sqlite.exec(`ALTER TABLE reminders ADD COLUMN snooze_count INTEGER NOT NULL DEFAULT 0;`);
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE reminders ADD COLUMN next_snooze_at INTEGER;`);
  } catch { /* column already exists */ }

  console.log('Database migrations applied (direct SQL)');
}

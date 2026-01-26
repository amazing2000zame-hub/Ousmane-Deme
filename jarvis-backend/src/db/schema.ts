import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Events -- every alert, action, status change, and metric is logged here
// ---------------------------------------------------------------------------
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  type: text('type', { enum: ['alert', 'action', 'status', 'metric'] }).notNull(),
  severity: text('severity', { enum: ['info', 'warning', 'error', 'critical'] }).notNull().default('info'),
  source: text('source', { enum: ['monitor', 'user', 'jarvis', 'system'] }).notNull(),
  node: text('node'),
  summary: text('summary').notNull(),
  details: text('details'), // JSON string for structured data
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  resolvedAt: text('resolved_at'),
  resolvedBy: text('resolved_by'), // 'jarvis' | 'user'
});

// ---------------------------------------------------------------------------
// Conversations -- chat messages across sessions
// ---------------------------------------------------------------------------
export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  model: text('model'), // 'claude' | 'qwen' | null
  tokensUsed: integer('tokens_used'),
  toolCalls: text('tool_calls'), // JSON string
});

// ---------------------------------------------------------------------------
// Cluster Snapshots -- periodic captures of full cluster state
// ---------------------------------------------------------------------------
export const clusterSnapshots = sqliteTable('cluster_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  snapshot: text('snapshot').notNull(), // JSON string of full cluster state
});

// ---------------------------------------------------------------------------
// Preferences -- key-value config (upsert semantics)
// ---------------------------------------------------------------------------
export const preferences = sqliteTable('preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Autonomy Actions -- audit log for autonomous remediation actions
// ---------------------------------------------------------------------------
export const autonomyActions = sqliteTable('autonomy_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
  incidentKey: text('incident_key').notNull(),
  incidentId: text('incident_id').notNull(),
  runbookId: text('runbook_id').notNull(),
  condition: text('condition').notNull(),
  action: text('action').notNull(),
  actionArgs: text('action_args'),
  result: text('result', { enum: ['success', 'failure', 'blocked', 'escalated'] }).notNull(),
  resultDetails: text('result_details'),
  verificationResult: text('verification_result'),
  autonomyLevel: integer('autonomy_level').notNull(),
  node: text('node'),
  attemptNumber: integer('attempt_number').notNull().default(1),
  escalated: integer('escalated', { mode: 'boolean' }).notNull().default(false),
  emailSent: integer('email_sent', { mode: 'boolean' }).notNull().default(false),
});

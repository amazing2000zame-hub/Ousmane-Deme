import { eq, desc, gte, and, sql, count } from 'drizzle-orm';
import { db } from './index.js';
import { events, conversations, clusterSnapshots, preferences, autonomyActions } from './schema.js';

// ---------------------------------------------------------------------------
// Event operations
// ---------------------------------------------------------------------------

interface SaveEventInput {
  type: 'alert' | 'action' | 'status' | 'metric';
  severity?: 'info' | 'warning' | 'error' | 'critical';
  source: 'monitor' | 'user' | 'jarvis' | 'system';
  node?: string | null;
  summary: string;
  details?: string | null;
}

function saveEvent(event: SaveEventInput) {
  return db.insert(events).values({
    type: event.type,
    severity: event.severity ?? 'info',
    source: event.source,
    node: event.node ?? null,
    summary: event.summary,
    details: event.details ?? null,
  }).returning().get();
}

function getRecentEvents(limit = 50) {
  return db.select().from(events).orderBy(desc(events.timestamp)).limit(limit).all();
}

function getUnresolved() {
  return db.select().from(events).where(eq(events.resolved, false)).orderBy(desc(events.timestamp)).all();
}

function getEventsSince(since: string) {
  return db.select().from(events).where(gte(events.timestamp, since)).orderBy(desc(events.timestamp)).all();
}

function getEventsByNode(node: string, limit = 20) {
  return db.select().from(events).where(eq(events.node, node)).orderBy(desc(events.timestamp)).limit(limit).all();
}

function getEventsByType(type: 'alert' | 'action' | 'status' | 'metric', limit = 20) {
  return db.select().from(events).where(eq(events.type, type)).orderBy(desc(events.timestamp)).limit(limit).all();
}

function resolveEvent(id: number, resolvedBy: string) {
  return db.update(events)
    .set({
      resolved: true,
      resolvedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      resolvedBy,
    })
    .where(eq(events.id, id))
    .returning()
    .get();
}

// ---------------------------------------------------------------------------
// Conversation operations
// ---------------------------------------------------------------------------

interface SaveMessageInput {
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string | null;
  tokensUsed?: number | null;
  toolCalls?: string | null;
}

function saveMessage(msg: SaveMessageInput) {
  return db.insert(conversations).values({
    sessionId: msg.sessionId,
    role: msg.role,
    content: msg.content,
    model: msg.model ?? null,
    tokensUsed: msg.tokensUsed ?? null,
    toolCalls: msg.toolCalls ?? null,
  }).returning().get();
}

function getSessionMessages(sessionId: string) {
  return db.select().from(conversations)
    .where(eq(conversations.sessionId, sessionId))
    .orderBy(conversations.timestamp)
    .all();
}

function getRecentSessions(limit = 10) {
  return db.selectDistinct({ sessionId: conversations.sessionId })
    .from(conversations)
    .orderBy(desc(conversations.timestamp))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// Snapshot operations
// ---------------------------------------------------------------------------

function saveSnapshot(snapshot: string) {
  return db.insert(clusterSnapshots).values({ snapshot }).returning().get();
}

function getLatestSnapshot() {
  return db.select().from(clusterSnapshots).orderBy(desc(clusterSnapshots.timestamp)).limit(1).get() ?? null;
}

function getSnapshotsSince(since: string) {
  return db.select().from(clusterSnapshots).where(gte(clusterSnapshots.timestamp, since)).orderBy(desc(clusterSnapshots.timestamp)).all();
}

// ---------------------------------------------------------------------------
// Preference operations (upsert semantics)
// ---------------------------------------------------------------------------

function getPreference(key: string) {
  return db.select().from(preferences).where(eq(preferences.key, key)).get() ?? null;
}

function setPreference(key: string, value: string) {
  return db.insert(preferences)
    .values({ key, value })
    .onConflictDoUpdate({
      target: preferences.key,
      set: {
        value,
        updatedAt: sql`datetime('now')`,
      },
    })
    .returning()
    .get();
}

function getAllPreferences() {
  return db.select().from(preferences).all();
}

// ---------------------------------------------------------------------------
// Autonomy Action operations
// ---------------------------------------------------------------------------

interface SaveAutonomyActionInput {
  incidentKey: string;
  incidentId: string;
  runbookId: string;
  condition: string;
  action: string;
  actionArgs?: string | null;
  result: 'success' | 'failure' | 'blocked' | 'escalated';
  resultDetails?: string | null;
  verificationResult?: string | null;
  autonomyLevel: number;
  node?: string | null;
  attemptNumber?: number;
  escalated?: boolean;
  emailSent?: boolean;
}

function saveAutonomyAction(input: SaveAutonomyActionInput) {
  return db.insert(autonomyActions).values({
    incidentKey: input.incidentKey,
    incidentId: input.incidentId,
    runbookId: input.runbookId,
    condition: input.condition,
    action: input.action,
    actionArgs: input.actionArgs ?? null,
    result: input.result,
    resultDetails: input.resultDetails ?? null,
    verificationResult: input.verificationResult ?? null,
    autonomyLevel: input.autonomyLevel,
    node: input.node ?? null,
    attemptNumber: input.attemptNumber ?? 1,
    escalated: input.escalated ?? false,
    emailSent: input.emailSent ?? false,
  }).returning().get();
}

function getAutonomyActions(limit = 50) {
  return db.select().from(autonomyActions).orderBy(desc(autonomyActions.timestamp)).limit(limit).all();
}

function getActionsByIncidentKey(key: string, limit = 20) {
  return db.select().from(autonomyActions)
    .where(eq(autonomyActions.incidentKey, key))
    .orderBy(desc(autonomyActions.timestamp))
    .limit(limit)
    .all();
}

function getAttemptCountSince(incidentKey: string, sinceTimestamp: string) {
  const result = db.select({ value: count() }).from(autonomyActions)
    .where(and(
      eq(autonomyActions.incidentKey, incidentKey),
      gte(autonomyActions.timestamp, sinceTimestamp),
    ))
    .get();
  return result?.value ?? 0;
}

function cleanupOldActions(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  return db.delete(autonomyActions)
    .where(sql`${autonomyActions.timestamp} < ${cutoff}`)
    .run();
}

// ---------------------------------------------------------------------------
// Export public API
// ---------------------------------------------------------------------------

export const memoryStore = {
  // Events
  saveEvent,
  getRecentEvents,
  getUnresolved,
  getEventsSince,
  getEventsByNode,
  getEventsByType,
  resolveEvent,

  // Conversations
  saveMessage,
  getSessionMessages,
  getRecentSessions,

  // Snapshots
  saveSnapshot,
  getLatestSnapshot,
  getSnapshotsSince,

  // Preferences
  getPreference,
  setPreference,
  getAllPreferences,

  // Autonomy Actions
  saveAutonomyAction,
  getAutonomyActions,
  getActionsByIncidentKey,
  getAttemptCountSince,
  cleanupOldActions,
};

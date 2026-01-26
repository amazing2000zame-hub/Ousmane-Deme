/**
 * Memory extraction — converts chat sessions and cluster events into
 * persistent memories stored in the memory bank.
 *
 * Extraction is synchronous (better-sqlite3) and runs inline after
 * chat sessions complete and when events are recorded.
 */

import { memoryBank, type MemoryTier, type MemoryCategory, type MemorySource } from '../db/memories.js';

// ---------------------------------------------------------------------------
// Session summary extraction
// ---------------------------------------------------------------------------

/**
 * Extract memories from a completed chat session.
 *
 * Creates:
 *  - A conversation-tier session summary (7-day TTL)
 *  - Any user preferences detected (semantic-tier, permanent)
 */
export function extractMemoriesFromSession(
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  provider: string,
): void {
  // Build session summary from last exchange
  const userMsgs = messages.filter((m) => m.role === 'user');
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');

  if (userMsgs.length === 0) return;

  const lastUserMsg = userMsgs[userMsgs.length - 1].content;
  const lastAssistantMsg = assistantMsgs.length > 0
    ? assistantMsgs[assistantMsgs.length - 1].content
    : '';

  // Create brief summary
  const userSnippet = lastUserMsg.length > 100
    ? lastUserMsg.slice(0, 100) + '...'
    : lastUserMsg;
  const assistantSnippet = lastAssistantMsg.length > 120
    ? lastAssistantMsg.slice(0, 120) + '...'
    : lastAssistantMsg;

  const date = new Date().toISOString().slice(0, 10);
  const summaryKey = `session_${sessionId}_${date}`;
  const summaryContent = assistantSnippet
    ? `User asked: "${userSnippet}" — Jarvis (${provider}): "${assistantSnippet}"`
    : `User asked: "${userSnippet}"`;

  try {
    memoryBank.upsertMemory({
      tier: 'conversation',
      category: 'session_summary',
      key: summaryKey,
      content: summaryContent,
      source: 'chat',
      sessionId,
    });
  } catch {
    // Non-critical
  }

  // Scan all user messages for preferences
  for (const msg of userMsgs) {
    const prefs = detectPreferences(msg.content);
    for (const pref of prefs) {
      try {
        memoryBank.upsertMemory({
          tier: 'semantic',
          category: 'user_preference',
          key: pref.key,
          content: pref.content,
          source: 'user',
          sessionId,
        });
      } catch {
        // Non-critical — key conflict is fine (upsert handles it)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------

/**
 * Convert a cluster event into an episodic memory.
 * Only stores warning/error/critical severity events.
 */
export function extractMemoryFromEvent(event: {
  type: string;
  severity: string;
  message: string;
  node?: string;
  resolved?: boolean;
}): void {
  // Only persist significant events
  if (!['warning', 'error', 'critical'].includes(event.severity)) return;

  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toISOString().slice(11, 16);
  const nodeTag = event.node ? `_${event.node}` : '';
  const key = `event${nodeTag}_${event.type}_${date}_${time}`;

  const resolvedTag = event.resolved ? ' (resolved)' : '';
  const content = `[${date}] ${event.node ? event.node + ': ' : ''}${event.message}${resolvedTag}`;

  try {
    memoryBank.upsertMemory({
      tier: 'episodic',
      category: 'node_event',
      key,
      content,
      source: 'event',
      nodeId: event.node ?? null,
    });
  } catch {
    // Non-critical
  }
}

// ---------------------------------------------------------------------------
// Preference detection
// ---------------------------------------------------------------------------

/** Patterns that indicate a user preference statement. */
const PREFERENCE_PATTERNS: Array<{ regex: RegExp; extract: (match: RegExpMatchArray) => string }> = [
  {
    regex: /i prefer (.+)/i,
    extract: (m) => `User prefers ${m[1]}`,
  },
  {
    regex: /always (.+)/i,
    extract: (m) => `Always ${m[1]}`,
  },
  {
    regex: /never (.+)/i,
    extract: (m) => `Never ${m[1]}`,
  },
  {
    regex: /remind me (?:to )?(.+)/i,
    extract: (m) => `Reminder: ${m[1]}`,
  },
  {
    regex: /i (?:like|want) (.+)/i,
    extract: (m) => `User wants ${m[1]}`,
  },
  {
    regex: /(?:don'?t|do not) (.+)/i,
    extract: (m) => `Do not ${m[1]}`,
  },
  {
    regex: /(?:use|set) (.+?) (?:for|as|to) (.+)/i,
    extract: (m) => `Use ${m[1]} for ${m[2]}`,
  },
  {
    regex: /my (.+?) is (.+)/i,
    extract: (m) => `User's ${m[1]} is ${m[2]}`,
  },
];

/**
 * Detect user preferences from a message.
 * Returns array of { key, content } for each preference found.
 */
export function detectPreferences(message: string): Array<{ key: string; content: string }> {
  const results: Array<{ key: string; content: string }> = [];
  const normalized = message.trim();

  // Skip short messages or questions (unlikely to contain preferences)
  if (normalized.length < 10 || normalized.endsWith('?')) return results;

  for (const pattern of PREFERENCE_PATTERNS) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const content = pattern.extract(match);
      // Create a stable key from the first few words
      const keyBase = content.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 4)
        .join('_');
      results.push({
        key: `pref_${keyBase}`,
        content,
      });
    }
  }

  return results;
}

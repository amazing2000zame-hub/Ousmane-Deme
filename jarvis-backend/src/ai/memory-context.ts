/**
 * Memory context builder — assembles relevant memories into a context block
 * that gets injected into the system prompt.
 *
 * Priority order:
 *   1. User preferences (semantic tier) — always included
 *   2. Recent cluster events related to query (episodic tier)
 *   3. Recent session summaries (conversation tier)
 *
 * Token budget: ~600 tokens for Claude, ~200 for Qwen.
 * Estimation: 1 token ~ 4 characters.
 */

import { memoryBank, type Memory } from '../db/memories.js';
import { config } from '../config.js';

// Rough token estimation
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a memory context string to inject into the system prompt.
 * Stays within the configured token budget.
 */
export function buildMemoryContext(
  userMessage: string,
  provider: 'claude' | 'qwen',
  maxTokens?: number,
): string {
  const budget = maxTokens ?? (provider === 'claude' ? config.memoryContextTokenBudget : 200);

  const sections: string[] = [];
  let usedTokens = 0;

  // PERF-015: Collect all accessed memory IDs, batch-touch at end
  const touchedIds: number[] = [];

  // 1. User preferences (semantic tier) — always included first
  const preferences = memoryBank.getMemoriesByCategory('user_preference', 20);
  if (preferences.length > 0) {
    const prefLines = preferences.map((m) => `- ${m.content}`);
    const prefBlock = `<preferences>\n${prefLines.join('\n')}\n</preferences>`;
    const prefTokens = estimateTokens(prefBlock);
    if (usedTokens + prefTokens <= budget) {
      sections.push(prefBlock);
      usedTokens += prefTokens;
      for (const m of preferences) touchedIds.push(m.id);
    }
  }

  // 2. Relevant episodic memories (query-matched first, then recent)
  const episodic = getRelevantMemories(userMessage, 'episodic', 10);
  if (episodic.length > 0) {
    const eventLines: string[] = [];
    for (const m of episodic) {
      const line = `- ${m.content}`;
      const lineTokens = estimateTokens(line);
      if (usedTokens + lineTokens + 30 > budget) break; // 30 = overhead for tags
      eventLines.push(line);
      usedTokens += lineTokens;
      touchedIds.push(m.id);
    }
    if (eventLines.length > 0) {
      sections.push(`<recent_events>\n${eventLines.join('\n')}\n</recent_events>`);
      usedTokens += 30; // tag overhead
    }
  }

  // 3. Recent conversation summaries
  const convos = getRelevantMemories(userMessage, 'conversation', 8);
  if (convos.length > 0) {
    const convoLines: string[] = [];
    for (const m of convos) {
      const line = `- ${m.content}`;
      const lineTokens = estimateTokens(line);
      if (usedTokens + lineTokens + 40 > budget) break;
      convoLines.push(line);
      usedTokens += lineTokens;
      touchedIds.push(m.id);
    }
    if (convoLines.length > 0) {
      sections.push(`<recent_conversations>\n${convoLines.join('\n')}\n</recent_conversations>`);
    }
  }

  // PERF-015: Single transaction for all touch writes
  if (touchedIds.length > 0) {
    memoryBank.touchMemories(touchedIds);
  }

  if (sections.length === 0) return '';

  return `\n<memory_context>\n${sections.join('\n')}\n</memory_context>`;
}

/**
 * Search memories relevant to a user query.
 * Used for explicit recall queries ("what did we discuss", "do you remember").
 * Returns a formatted string of matching memories with timestamps.
 */
export function recallMemories(query: string, limit = 10): string {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    // Fallback: return recent memories
    const recent = memoryBank.getRecentMemories(limit);
    if (recent.length === 0) return '';
    return formatRecallResults(recent);
  }

  // Search by each keyword, deduplicate
  const seen = new Set<number>();
  const results: Memory[] = [];

  for (const kw of keywords) {
    const matches = memoryBank.searchMemories(kw, limit);
    for (const m of matches) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        results.push(m);
      }
    }
  }

  if (results.length === 0) return '';

  // PERF-015: Batch-touch all accessed memories
  memoryBank.touchMemories(results.map((m) => m.id));

  // Sort by recency
  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return formatRecallResults(results.slice(0, limit));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Get memories relevant to the user message.
 * If the message has useful keywords, search by them; otherwise return recent.
 */
function getRelevantMemories(userMessage: string, tier: 'episodic' | 'conversation', limit: number): Memory[] {
  const keywords = extractKeywords(userMessage);

  if (keywords.length === 0) {
    return memoryBank.getMemoriesByTier(tier, limit);
  }

  // Search + fallback to recent
  const seen = new Set<number>();
  const results: Memory[] = [];

  for (const kw of keywords) {
    const matches = memoryBank.searchMemories(kw, limit);
    for (const m of matches) {
      if (m.tier === tier && !seen.has(m.id)) {
        seen.add(m.id);
        results.push(m);
      }
    }
  }

  // If not enough matches, backfill with recent
  if (results.length < limit) {
    const recent = memoryBank.getMemoriesByTier(tier, limit);
    for (const m of recent) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        results.push(m);
        if (results.length >= limit) break;
      }
    }
  }

  return results.slice(0, limit);
}

/** Extract meaningful keywords from a message (strip filler words). */
function extractKeywords(message: string): string[] {
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must',
    'i', 'me', 'my', 'we', 'you', 'your', 'he', 'she', 'it', 'they',
    'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
    'how', 'when', 'where', 'why',
    'and', 'or', 'but', 'if', 'so', 'yet', 'not', 'no', 'nor',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about',
    'up', 'out', 'off', 'over', 'under', 'again', 'then', 'once',
    'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some', 'such',
    'just', 'very', 'really', 'also', 'too', 'much', 'many',
    'tell', 'show', 'give', 'get', 'got', 'let', 'know', 'think',
    'said', 'say', 'talk', 'talked', 'discuss', 'discussed', 'remember',
    'please', 'sir', 'hey', 'hello', 'hi', 'thanks',
  ]);

  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function formatRecallResults(memories: Memory[]): string {
  const lines = memories.map((m, i) => {
    const date = m.createdAt.slice(0, 10);
    return `[${i + 1}] ${date} (${m.tier}): ${m.content}`;
  });
  return lines.join('\n');
}

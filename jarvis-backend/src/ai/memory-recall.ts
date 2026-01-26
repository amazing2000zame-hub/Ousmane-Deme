/**
 * Memory recall — detects recall-type user queries and builds enriched
 * context blocks for the system prompt.
 *
 * Recall queries: "what did we discuss", "do you remember", "last time",
 * "have we ever", "what happened with", "remind me about", etc.
 */

import { recallMemories } from './memory-context.js';

// ---------------------------------------------------------------------------
// Recall detection patterns
// ---------------------------------------------------------------------------

const RECALL_PATTERNS: RegExp[] = [
  /what did (?:we|i|you) (?:discuss|talk about|say|do|cover)/i,
  /do you (?:remember|recall|know about)/i,
  /(?:last time|previously|before|earlier) (?:we|i|you)/i,
  /have (?:we|i|you) ever/i,
  /what happened (?:with|to|when|about)/i,
  /when did .+ happen/i,
  /remind me (?:about|of|what)/i,
  /what do you (?:know|remember) about/i,
  /tell me (?:about|what you know about) (?:the|our) (?:last|previous|past)/i,
  /any (?:issues|problems|incidents|events) (?:with|on|for)/i,
  /history (?:of|for|with)/i,
];

/**
 * Detect if a user message is asking to recall past information.
 * Returns search terms extracted from the query for memory lookup.
 */
export function detectRecallQuery(message: string): { isRecall: boolean; searchTerms: string[] } {
  const trimmed = message.trim();

  for (const pattern of RECALL_PATTERNS) {
    if (pattern.test(trimmed)) {
      const searchTerms = extractSearchTerms(trimmed);
      return { isRecall: true, searchTerms };
    }
  }

  return { isRecall: false, searchTerms: [] };
}

/**
 * Build a recall context block to prepend to the system prompt.
 * This is a larger, more detailed retrieval than the standard memory context.
 */
export function buildRecallBlock(searchTerms: string[], limit = 15): string {
  // Join terms for a combined search
  const query = searchTerms.join(' ');
  const results = recallMemories(query, limit);

  if (!results) {
    return `<recall_results>
The user is asking about past interactions. No relevant memories were found.
Inform the user that you don't have records matching their query.
</recall_results>`;
  }

  return `<recall_results>
The user is asking about past interactions. Here are the relevant memories:

${results}

Use these memories to answer the user's question accurately.
Reference specific dates and details from the memories.
If the memories don't fully answer the question, say what you do know and note what's missing.
</recall_results>`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Extract meaningful search terms from a recall query. */
function extractSearchTerms(message: string): string[] {
  // Remove the recall pattern itself to get the subject
  let cleaned = message;
  for (const pattern of RECALL_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'i', 'me', 'my', 'we', 'you', 'your', 'it', 'they',
    'and', 'or', 'but', 'if', 'so', 'not', 'no',
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about',
    'please', 'sir', 'hey', 'hello', 'thanks', 'again',
    'yesterday', 'today', 'last', 'week', 'time',
  ]);

  const terms = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Also include original message keywords for broader search
  const originalTerms = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  // Deduplicate
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of [...terms, ...originalTerms]) {
    if (!seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }

  return result.slice(0, 5); // max 5 search terms
}

/**
 * Context Manager — sliding window conversation management with background
 * summarization for JARVIS sessions.
 *
 * Tracks per-session state: recent messages, a rolling summary, and preserved
 * entities (VMIDs, IPs, node names). When the message count exceeds a threshold,
 * background summarization compresses older messages into a narrative summary
 * while preserving all critical identifiers.
 *
 * Token budgeting ensures the assembled context fits within the Qwen context
 * window (8192 tokens) minus system prompt and response reserve.
 */

import { config } from '../config.js';
import { tokenize, countMessagesTokens } from './local-llm.js';

// ---------------------------------------------------------------------------
// Summarization prompts
// ---------------------------------------------------------------------------

const SUMMARIZE_SYSTEM = `You are a conversation summarizer for JARVIS, a Proxmox homelab AI assistant.`;

const SUMMARIZE_PROMPT = `Summarize the following conversation concisely.

RULES:
1. Write a narrative summary under 150 words focusing on: decisions made, problems discussed, actions taken, current discussion state
2. Preserve ALL specific identifiers verbatim: VMIDs (like VM 103), IP addresses (like 192.168.1.50), node names (Home, pve, agent1, agent), file paths, container names, error messages
3. After the summary, output preserved entities on separate lines after a ---ENTITIES--- marker
4. Entity format: key: description (one per line)

FORMAT EXAMPLE:
User discussed VM 103 on pve node having high CPU. JARVIS ran diagnostics and found a runaway process. User asked to restart the VM.

---ENTITIES---
vm_103: management VM on pve node (192.168.1.65)
node_pve: 192.168.1.74, compute + NAS node
error_discussed: high CPU usage from runaway process on VM 103

CONVERSATION TO SUMMARIZE:
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionContext {
  recentMessages: Array<{ role: string; content: string }>;
  summary: string | null;
  entities: Map<string, string>; // key -> description (e.g., "vm_103" -> "management VM on pve node")
  tokenCount: number;
  summarizing: boolean;
  totalMessageCount: number; // total messages seen in this session (not just recent)
}

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

export class ContextManager {
  private sessions = new Map<string, SessionContext>();

  /**
   * Return existing session or create a new empty one.
   */
  getOrCreateSession(sessionId: string): SessionContext {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        recentMessages: [],
        summary: null,
        entities: new Map(),
        tokenCount: 0,
        summarizing: false,
        totalMessageCount: 0,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /**
   * Add a message to the session's recent messages.
   * Does NOT trigger summarization -- call shouldSummarize() + summarize() externally.
   */
  addMessage(sessionId: string, role: string, content: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.recentMessages.push({ role, content });
    session.totalMessageCount++;
  }

  /**
   * Check if summarization should be triggered for this session.
   * Returns true when: session exists, totalMessageCount exceeds threshold,
   * and no summarization is currently in progress.
   */
  shouldSummarize(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return (
      session.totalMessageCount > config.contextSummarizeThreshold &&
      !session.summarizing
    );
  }

  /**
   * Build the context messages array for LLM consumption, respecting token budgets.
   *
   * Budget calculation:
   *   available = contextWindowTokens - systemPromptTokens - memoryContextTokens - responseReserve
   *   summaryBudget = 30% of available
   *   recentBudget  = 70% of available
   *
   * Returns messages in order: [summary system msg?, entity system msg?, ...recent messages]
   */
  async buildContextMessages(
    sessionId: string,
    systemPromptTokens: number,
    memoryContextTokens: number,
  ): Promise<Array<{ role: string; content: string }>> {
    const session = this.getOrCreateSession(sessionId);
    const messages: Array<{ role: string; content: string }> = [];

    // Token budget
    const availableTokens =
      config.contextWindowTokens -
      systemPromptTokens -
      memoryContextTokens -
      config.contextResponseReserve;

    const summaryBudget = Math.floor(availableTokens * (1 - config.contextRecentRatio)); // 30%
    const recentBudget = availableTokens - summaryBudget; // 70%

    // 1. Summary message (if exists)
    if (session.summary) {
      let summaryText = session.summary;
      const summaryTokens = await tokenize(summaryText);
      if (summaryTokens > summaryBudget) {
        // Truncate by character ratio
        const ratio = summaryBudget / summaryTokens;
        const targetLength = Math.floor(summaryText.length * ratio);
        summaryText = summaryText.slice(0, targetLength) + '...';
      }
      messages.push({
        role: 'system',
        content: `<conversation_summary>\n${summaryText}\n</conversation_summary>`,
      });
    }

    // 2. Entity context (if exists)
    if (session.entities.size > 0) {
      const entityLines: string[] = [];
      for (const [key, description] of session.entities) {
        entityLines.push(`- ${key}: ${description}`);
      }
      const entityBlock = entityLines.join('\n');
      messages.push({
        role: 'system',
        content: `<preserved_context>\n${entityBlock}\n</preserved_context>`,
      });
    }

    // 3. Recent messages -- work backwards from most recent, fit within recentBudget
    let usedTokens = 0;
    const recentSlice: Array<{ role: string; content: string }> = [];

    for (let i = session.recentMessages.length - 1; i >= 0; i--) {
      const msg = session.recentMessages[i];
      const msgTokens = await tokenize(msg.content);
      const msgTotal = msgTokens + 4; // chat template overhead

      if (usedTokens + msgTotal > recentBudget && recentSlice.length > 0) {
        // Budget exceeded -- but always include at least the latest message
        break;
      }

      recentSlice.unshift(msg);
      usedTokens += msgTotal;
    }

    messages.push(...recentSlice);

    return messages;
  }

  /**
   * Background summarization: compress older messages into a narrative summary
   * with preserved entities.
   *
   * Calls Qwen directly via /v1/chat/completions (non-streaming, 15s timeout).
   * On error: logs warning, does NOT modify session state.
   */
  async summarize(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.summarizing = true;

    try {
      // Keep last N messages as recent, summarize the rest
      const keepCount = config.qwenHistoryLimit;
      if (session.recentMessages.length <= keepCount) {
        // Nothing to summarize
        session.summarizing = false;
        return;
      }

      const toSummarize = session.recentMessages.slice(0, -keepCount);
      const toKeep = session.recentMessages.slice(-keepCount);

      // Build conversation text for summarization
      const conversationParts: string[] = [];

      // If previous summary exists, include it for context continuity
      if (session.summary) {
        conversationParts.push(`[Previous summary: ${session.summary}]`);
      }

      for (const msg of toSummarize) {
        const roleLabel = msg.role === 'user' ? 'User' : 'JARVIS';
        conversationParts.push(`${roleLabel}: ${msg.content}`);
      }

      const conversationText = conversationParts.join('\n\n');

      // Call Qwen directly for summarization (non-streaming)
      const res = await fetch(`${config.localLlmEndpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.localLlmModel,
          messages: [
            { role: 'system', content: SUMMARIZE_SYSTEM },
            { role: 'user', content: SUMMARIZE_PROMPT + conversationText },
          ],
          stream: false,
          temperature: 0.3,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[ContextManager] Summarization failed: ${res.status} ${body}`);
        session.summarizing = false;
        return;
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const responseText = data.choices?.[0]?.message?.content ?? '';
      if (!responseText) {
        console.warn('[ContextManager] Summarization returned empty response');
        session.summarizing = false;
        return;
      }

      // Parse response: split on ---ENTITIES--- marker
      const entityMarker = '---ENTITIES---';
      const markerIndex = responseText.indexOf(entityMarker);

      let narrativeSummary: string;
      let entitySection: string;

      if (markerIndex >= 0) {
        narrativeSummary = responseText.slice(0, markerIndex).trim();
        entitySection = responseText.slice(markerIndex + entityMarker.length).trim();
      } else {
        narrativeSummary = responseText.trim();
        entitySection = '';
      }

      // Update session with new summary
      session.summary = narrativeSummary;

      // Parse and merge entities
      if (entitySection) {
        const entityLines = entitySection.split('\n').filter(l => l.trim());
        for (const line of entityLines) {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.slice(0, colonIndex).trim();
            const description = line.slice(colonIndex + 1).trim();
            if (key && description) {
              session.entities.set(key, description); // new values overwrite old
            }
          }
        }
      }

      // Remove summarized messages, keep only recent
      session.recentMessages = toKeep;

      // Update token count
      session.tokenCount = await countMessagesTokens(session.recentMessages);
    } catch (err) {
      console.warn(
        `[ContextManager] Summarization error: ${err instanceof Error ? err.message : err}`,
      );
      // Do NOT modify session state on error
    } finally {
      session.summarizing = false;
    }
  }

  /**
   * Delete a session and all its state.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

/**
 * Shared chat pipeline used by both Socket.IO and REST /api/chat.
 *
 * Extracts the core message processing logic:
 *  1. Route message to Claude or Qwen
 *  2. Build system prompt with cluster context
 *  3. Run agentic loop (Claude) or streaming call (Qwen)
 *  4. Collect results via callbacks
 *
 * Socket.IO handler streams tokens in real-time.
 * REST handler collects all output into a single response.
 */

import crypto from 'node:crypto';
import {
  buildClaudeSystemPrompt,
  buildQwenSystemPrompt,
  buildClusterSummary,
} from './system-prompt.js';
import {
  resumeAfterConfirmation,
  type PendingConfirmation,
  type StreamCallbacks,
} from './loop.js';
import { routeMessage } from './router.js';
import { detectConversationMode, type ConversationMode } from './conversation-mode.js';
import { calculateCost } from './cost-tracker.js';
import { claudeProvider } from './providers/claude-provider.js';
import { openaiProvider } from './providers/openai-provider.js';
import { qwenProvider } from './providers/qwen-provider.js';
import type { LLMProvider } from './providers.js';
import { memoryStore } from '../db/memory.js';
import { config } from '../config.js';
import { detectPreferences } from './memory-extractor.js';
import { detectRecallQuery, buildRecallBlock } from './memory-recall.js';
import { memoryBank } from '../db/memories.js';
import { ContextManager } from './context-manager.js';

// Provider lookup map
const providers: Record<string, LLMProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
  qwen: qwenProvider,
};

// Shared context manager for REST API sessions
const restContextManager = new ContextManager();

// In-memory pending confirmations for REST sessions
const restPendingConfirmations = new Map<string, PendingConfirmation>();

// Track recent conversation modes per session for consistency
const sessionModeHistory = new Map<string, Array<{ role: string; content: string; mode?: ConversationMode }>>();

export interface ChatRequest {
  message: string;
  sessionId?: string;
  source?: 'web' | 'voice' | 'telegram' | 'api';
}

export interface ChatResponse {
  response: string;
  sessionId: string;
  provider: string;
  toolsUsed: string[];
  usage: { inputTokens: number; outputTokens: number };
  cost: number;
  /** Detected conversation mode for this message */
  mode?: ConversationMode;
  /** Set when a RED/ORANGE-tier tool needs confirmation */
  confirmationNeeded?: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    tier: string;
  };
}

export interface ConfirmRequest {
  sessionId: string;
  toolUseId: string;
  confirmed: boolean;
}

/**
 * Process a chat message through the full LLM + MCP pipeline (non-streaming).
 * Returns the complete response text after all tool calls resolve.
 */
export async function processChat(req: ChatRequest): Promise<ChatResponse> {
  const sessionId = req.sessionId || crypto.randomUUID();
  const message = req.message.trim();

  // Save user message to DB
  try {
    memoryStore.saveMessage({ sessionId, role: 'user', content: message });
  } catch { /* non-critical */ }

  // Detect and persist user preferences
  try {
    const prefs = detectPreferences(message);
    for (const pref of prefs) {
      memoryBank.upsertMemory({
        tier: 'semantic',
        category: 'user_preference',
        key: pref.key,
        content: pref.content,
        source: 'user',
        sessionId,
      });
    }
  } catch { /* non-critical */ }

  // Add to context manager
  restContextManager.addMessage(sessionId, 'user', message);

  // Detect override passkey
  const overrideKey = config.overrideKey;
  const overrideActive = overrideKey.length > 0
    && message.toLowerCase().includes(overrideKey.toLowerCase());

  // Route to provider (pass source so Telegram always gets Claude)
  const decision = routeMessage(message, overrideActive, undefined, req.source);
  const provider = providers[decision.provider];
  console.log(`[ChatAPI] Routing to ${decision.provider}: ${decision.reason}`);

  // Detect recall queries
  let recallBlock: string | undefined;
  const recall = detectRecallQuery(message);
  if (recall.isRecall) {
    recallBlock = buildRecallBlock(recall.searchTerms);
  }

  // Detect conversation mode (casual / work / info)
  const modeHistory = sessionModeHistory.get(sessionId) || [];
  const mode = detectConversationMode(message, modeHistory);
  modeHistory.push({ role: 'user', content: message, mode });
  // Keep only last 6 entries to bound memory
  if (modeHistory.length > 6) modeHistory.splice(0, modeHistory.length - 6);
  sessionModeHistory.set(sessionId, modeHistory);
  console.log(`[ChatAPI] Conversation mode: ${mode}`);

  // Build system prompt (openai provider is Claude Max proxy — use Claude prompt)
  const summary = await buildClusterSummary();
  const systemPrompt = decision.provider === 'claude' || decision.provider === 'openai'
    ? buildClaudeSystemPrompt(summary, overrideActive, message, recallBlock, false, mode)
    : buildQwenSystemPrompt(summary, message, recallBlock, false, mode);

  // Build context-managed message history
  const systemPromptTokenEstimate = Math.ceil(systemPrompt.length / 4);
  const memoryContextTokenEstimate = recallBlock ? Math.ceil(recallBlock.length / 4) : 0;
  const chatMessages = await restContextManager.buildContextMessages(
    sessionId,
    systemPromptTokenEstimate,
    memoryContextTokenEstimate,
  );

  // Ensure current message is included
  const lastMsg = chatMessages[chatMessages.length - 1];
  if (!lastMsg || lastMsg.content !== message || lastMsg.role !== 'user') {
    chatMessages.push({ role: 'user', content: message });
  }

  // Create abort controller
  const abortController = new AbortController();

  // Collect results
  let accumulatedText = '';
  const toolsUsed: string[] = [];

  return new Promise<ChatResponse>((resolve, reject) => {
    const callbacks: StreamCallbacks = {
      onTextDelta: (text: string) => {
        accumulatedText += text;
      },

      onToolUse: async (toolName, _toolInput, _toolUseId, _tier) => {
        toolsUsed.push(toolName);
      },

      onToolResult: (_toolUseId, _result, _isError) => {
        // Results are handled internally by the agentic loop
      },

      onConfirmationNeeded: (toolName, toolInput, toolUseId, tier) => {
        // For REST API, we return the confirmation request in the response
        // The caller can then POST to /api/chat/confirm
        console.log(`[ChatAPI] Confirmation needed for ${toolName} (${tier})`);
      },

      onKeywordApprovalNeeded: (toolName, toolInput, toolUseId, tier) => {
        console.log(`[ChatAPI] Keyword approval needed for ${toolName} (${tier})`);
      },

      onBlocked: (toolName, reason, tier) => {
        console.log(`[ChatAPI] Tool blocked: ${toolName} (${tier}) - ${reason}`);
      },

      onDone: (usage) => {
        const cost = calculateCost(decision.provider, usage);

        // Save assistant response to DB
        if (accumulatedText.length > 0) {
          try {
            memoryStore.saveMessage({
              sessionId,
              role: 'assistant',
              content: accumulatedText,
              model: decision.provider,
              tokensUsed: usage.inputTokens + usage.outputTokens,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              costUsd: cost,
            });
          } catch { /* non-critical */ }
        }

        // Update context manager
        if (accumulatedText.length > 0) {
          restContextManager.addMessage(sessionId, 'assistant', accumulatedText);
        }

        // Trigger background summarization
        if (restContextManager.shouldSummarize(sessionId)) {
          restContextManager.summarize(sessionId).catch(() => {});
        }

        resolve({
          response: accumulatedText,
          sessionId,
          provider: decision.provider,
          toolsUsed,
          usage,
          cost,
          mode,
        });
      },

      onError: (error) => {
        reject(error);
      },
    };

    // Dispatch to provider
    provider.chat(
      chatMessages,
      systemPrompt,
      callbacks,
      abortController.signal,
      overrideActive,
    ).then((pending) => {
      if (pending) {
        // A RED/ORANGE-tier tool needs confirmation
        restPendingConfirmations.set(sessionId, pending);

        const cost = calculateCost(decision.provider, { inputTokens: 0, outputTokens: 0 });
        resolve({
          response: accumulatedText || `This action requires your confirmation. Tool: ${pending.toolName}`,
          sessionId,
          provider: decision.provider,
          toolsUsed,
          usage: { inputTokens: 0, outputTokens: 0 },
          cost,
          mode,
          confirmationNeeded: {
            toolName: pending.toolName,
            toolInput: pending.toolInput,
            toolUseId: pending.toolUseId,
            tier: pending.approvalType,
          },
        });
      }
      // If no pending, onDone callback handles the resolve
    }).catch(reject);
  });
}

/**
 * Process a confirmation for a pending RED/ORANGE-tier tool action.
 */
export async function processConfirm(req: ConfirmRequest): Promise<ChatResponse> {
  const { sessionId, toolUseId, confirmed } = req;

  const pending = restPendingConfirmations.get(sessionId);
  if (!pending) {
    throw new Error('No pending confirmation found for this session');
  }

  restPendingConfirmations.delete(sessionId);

  const summary = await buildClusterSummary();
  const systemPrompt = buildClaudeSystemPrompt(summary);
  const abortController = new AbortController();

  let accumulatedText = '';
  const toolsUsed: string[] = [];

  return new Promise<ChatResponse>((resolve, reject) => {
    const callbacks: StreamCallbacks = {
      onTextDelta: (text: string) => {
        accumulatedText += text;
      },

      onToolUse: async (toolName) => {
        toolsUsed.push(toolName);
      },

      onToolResult: () => {},

      onConfirmationNeeded: (toolName, toolInput, toolUseId, tier) => {
        console.log(`[ChatAPI] Additional confirmation needed for ${toolName}`);
      },

      onBlocked: (toolName, reason, tier) => {
        console.log(`[ChatAPI] Tool blocked: ${toolName} - ${reason}`);
      },

      onDone: (usage) => {
        const cost = calculateCost('claude', usage);

        if (accumulatedText.length > 0) {
          try {
            memoryStore.saveMessage({
              sessionId,
              role: 'assistant',
              content: accumulatedText,
              model: 'claude',
              tokensUsed: usage.inputTokens + usage.outputTokens,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              costUsd: cost,
            });
          } catch { /* non-critical */ }
        }

        resolve({
          response: accumulatedText,
          sessionId,
          provider: 'claude',
          toolsUsed,
          usage,
          cost,
        });
      },

      onError: (error) => {
        reject(error);
      },
    };

    const isOrange = pending.approvalType === 'orange';
    resumeAfterConfirmation(
      pending,
      confirmed,
      systemPrompt,
      callbacks,
      abortController.signal,
      isOrange,
    ).then((nextPending) => {
      if (nextPending) {
        restPendingConfirmations.set(sessionId, nextPending);
        resolve({
          response: accumulatedText || `Additional confirmation needed for ${nextPending.toolName}`,
          sessionId,
          provider: 'claude',
          toolsUsed,
          usage: { inputTokens: 0, outputTokens: 0 },
          cost: 0,
          confirmationNeeded: {
            toolName: nextPending.toolName,
            toolInput: nextPending.toolInput,
            toolUseId: nextPending.toolUseId,
            tier: nextPending.approvalType,
          },
        });
      }
    }).catch(reject);
  });
}

/**
 * Socket.IO /chat namespace handler for AI chat interactions.
 *
 * Uses intent-based routing to dispatch messages to either:
 *  - Claude (agentic with tools) for cluster management tasks
 *  - Qwen (conversational) for general conversation
 *
 * Events:
 *  - chat:send    { sessionId?, message }   -- Client sends a message
 *  - chat:confirm { sessionId, toolUseId, confirmed }  -- Client confirms/denies a RED-tier action
 *
 * Emitted events:
 *  - chat:token           { sessionId, text }           -- Streaming text token
 *  - chat:tool_use        { sessionId, toolName, toolInput, toolUseId, tier }
 *  - chat:tool_result     { sessionId, toolUseId, result, isError }
 *  - chat:confirm_needed  { sessionId, toolName, toolInput, toolUseId, tier }
 *  - chat:blocked         { sessionId, toolName, reason, tier }
 *  - chat:audio_chunk     { sessionId, index, contentType, audio }  -- PERF-03: Binary TTS audio chunk
 *  - chat:audio_done      { sessionId, totalChunks }                -- PERF-03: All TTS chunks sent
 *  - chat:done            { sessionId, usage, provider }
 *  - chat:error           { sessionId, error }
 */

import type { Namespace, Socket } from 'socket.io';
import crypto from 'node:crypto';
import {
  buildClaudeSystemPrompt,
  buildQwenSystemPrompt,
  buildClusterSummary,
} from '../ai/system-prompt.js';
import {
  resumeAfterConfirmation,
  type PendingConfirmation,
  type StreamCallbacks,
} from '../ai/loop.js';
import { routeMessage } from '../ai/router.js';
import { calculateCost } from '../ai/cost-tracker.js';
import { claudeProvider } from '../ai/providers/claude-provider.js';
import { qwenProvider } from '../ai/providers/qwen-provider.js';
import type { LLMProvider } from '../ai/providers.js';
import { memoryStore } from '../db/memory.js';
import { config } from '../config.js';
import { extractMemoriesFromSession, detectPreferences } from '../ai/memory-extractor.js';
import { detectRecallQuery, buildRecallBlock } from '../ai/memory-recall.js';
import { memoryBank } from '../db/memories.js';
import { SentenceAccumulator } from '../ai/sentence-stream.js';
import { synthesizeSentenceToBuffer, ttsAvailable } from '../ai/tts.js';

// Provider lookup map
const providers: Record<string, LLMProvider> = {
  claude: claudeProvider,
  qwen: qwenProvider,
};

// ---------------------------------------------------------------------------
// Types for incoming events
// ---------------------------------------------------------------------------

interface ChatSendPayload {
  sessionId?: string;
  message: string;
  voiceMode?: boolean;
}

interface ChatConfirmPayload {
  sessionId: string;
  toolUseId: string;
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Register chat event handlers on the /chat Socket.IO namespace.
 */
export function setupChatHandlers(chatNs: Namespace, eventsNs: Namespace): void {
  chatNs.on('connection', (socket: Socket) => {
    console.log(`[Chat] Client connected: ${socket.id}`);

    // Per-socket state
    const pendingConfirmations = new Map<string, PendingConfirmation>();
    const abortControllers = new Map<string, AbortController>();
    /** Track last provider used per session for follow-up routing */
    const sessionLastProvider = new Map<string, string>();
    /** PERF-014: Cache session history in-memory per socket (DB read once per session) */
    const sessionHistoryCache = new Map<string, Array<{ role: string; content: string }>>();

    // ------------------------------------------------------------------
    // chat:send -- user sends a message
    // ------------------------------------------------------------------
    async function handleSend(payload: ChatSendPayload): Promise<void> {
      const sessionId = payload?.sessionId || crypto.randomUUID();
      const message = payload?.message;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        socket.emit('chat:error', { sessionId, error: 'Message is required' });
        return;
      }

      try {
        // Save user message to DB
        try {
          memoryStore.saveMessage({
            sessionId,
            role: 'user',
            content: message.trim(),
          });
        } catch {
          // Non-critical: continue even if DB save fails
        }

        // Detect and persist user preferences immediately
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
        } catch {
          // Non-critical
        }

        // PERF-014: Load conversation history (cached in-memory after first DB read)
        let history: Array<{ role: string; content: string }> = [];
        const cachedHistory = sessionHistoryCache.get(sessionId);
        if (cachedHistory) {
          // Use cached history, add current message
          cachedHistory.push({ role: 'user', content: message.trim() });
          history = cachedHistory.slice(-config.chatHistoryLimit);
        } else {
          try {
            const dbMessages = memoryStore.getSessionMessages(sessionId);
            history = dbMessages.slice(-config.chatHistoryLimit);
            // Initialize cache with DB history
            sessionHistoryCache.set(sessionId, [...history]);
          } catch {
            history = [{ role: 'user', content: message.trim() }];
            sessionHistoryCache.set(sessionId, [...history]);
          }
        }

        // Convert DB messages to simple format (works for both providers)
        const chatMessages = history
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

        // Ensure we have at least the current message
        if (chatMessages.length === 0 || chatMessages[chatMessages.length - 1].content !== message.trim()) {
          chatMessages.push({ role: 'user', content: message.trim() });
        }

        // Detect override passkey in user message
        const overrideKey = config.overrideKey;
        const overrideActive = overrideKey.length > 0
          && message.toLowerCase().includes(overrideKey.toLowerCase());
        if (overrideActive) {
          console.log(`[Chat] Override passkey detected in message from ${socket.id}`);
        }

        // Route message to appropriate provider
        const lastProvider = sessionLastProvider.get(sessionId);
        const decision = routeMessage(message, overrideActive, lastProvider);
        const provider = providers[decision.provider];
        console.log(`[Chat] Routing to ${decision.provider}: ${decision.reason}`);

        // Detect recall queries and build enriched context
        let recallBlock: string | undefined;
        const recall = detectRecallQuery(message);
        if (recall.isRecall) {
          recallBlock = buildRecallBlock(recall.searchTerms);
          console.log(`[Chat] Recall query detected, ${recall.searchTerms.length} search terms`);
        }

        // Build provider-specific system prompt with live cluster context + memory
        const voiceMode = !!payload.voiceMode;
        const summary = await buildClusterSummary();
        const systemPrompt = decision.provider === 'claude'
          ? buildClaudeSystemPrompt(summary, overrideActive, message, recallBlock, voiceMode)
          : buildQwenSystemPrompt(summary, message, recallBlock, voiceMode);

        // Create abort controller for this session
        const abortController = new AbortController();
        abortControllers.set(sessionId, abortController);

        // Accumulate text for DB persistence
        let accumulatedText = '';

        // ---------------------------------------------------------------
        // PERF-01/02/03: Streaming voice pipeline — sentence-by-sentence TTS
        // ---------------------------------------------------------------
        const voicePipeline = voiceMode && ttsAvailable();
        let sentenceAccumulator: SentenceAccumulator | null = null;
        /** Track in-flight TTS promises so we can await them before signalling done */
        const ttsPending: Promise<void>[] = [];
        let audioChunkIndex = 0;

        if (voicePipeline) {
          sentenceAccumulator = new SentenceAccumulator((sentence, _index) => {
            // Fire-and-forget TTS synthesis per sentence
            const promise = (async () => {
              try {
                const audio = await synthesizeSentenceToBuffer(sentence);
                if (audio && !abortController.signal.aborted) {
                  socket.emit('chat:audio_chunk', {
                    sessionId,
                    index: audioChunkIndex++,
                    contentType: audio.contentType,
                    audio: audio.buffer,
                  });
                }
              } catch (err) {
                console.warn(`[Chat] Streaming TTS error: ${err instanceof Error ? err.message : err}`);
              }
            })();
            ttsPending.push(promise);
          });
        }

        // Build streaming callbacks
        const callbacks: StreamCallbacks = {
          onTextDelta: (text: string) => {
            accumulatedText += text;
            socket.emit('chat:token', { sessionId, text });
            // PERF-01: Feed sentence accumulator during streaming
            sentenceAccumulator?.push(text);
          },

          onToolUse: (toolName, toolInput, toolUseId, tier) => {
            socket.emit('chat:tool_use', { sessionId, toolName, toolInput, toolUseId, tier });
            eventsNs.emit('event', {
              id: crypto.randomUUID(),
              type: 'action',
              severity: 'info',
              title: `Tool: ${toolName}`,
              message: `Executed ${toolName} via chat`,
              source: 'jarvis',
              timestamp: new Date().toISOString(),
            });
          },

          onToolResult: (toolUseId, result, isError) => {
            socket.emit('chat:tool_result', { sessionId, toolUseId, result, isError });
          },

          onConfirmationNeeded: (toolName, toolInput, toolUseId, tier) => {
            socket.emit('chat:confirm_needed', { sessionId, toolName, toolInput, toolUseId, tier });
          },

          onBlocked: (toolName, reason, tier) => {
            socket.emit('chat:blocked', { sessionId, toolName, reason, tier });
          },

          onDone: (usage) => {
            const cost = calculateCost(decision.provider, usage);

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
              } catch {
                // Non-critical
              }
            }

            // Extract memories from completed session
            try {
              const sessionMsgs = [...chatMessages];
              if (accumulatedText.length > 0) {
                sessionMsgs.push({ role: 'assistant', content: accumulatedText });
              }
              extractMemoriesFromSession(sessionId, sessionMsgs, decision.provider);
            } catch {
              // Non-critical
            }

            // Track provider for follow-up routing
            sessionLastProvider.set(sessionId, decision.provider);

            // PERF-014: Update session history cache with assistant response
            if (accumulatedText.length > 0) {
              const cached = sessionHistoryCache.get(sessionId);
              if (cached) cached.push({ role: 'assistant', content: accumulatedText });
            }

            // PERF-01/03: Flush remaining sentence + wait for all TTS to finish
            if (sentenceAccumulator) {
              sentenceAccumulator.flush();
              // Wait for all pending TTS, then signal audio complete
              Promise.allSettled(ttsPending).then(() => {
                socket.emit('chat:audio_done', { sessionId, totalChunks: audioChunkIndex });
              });
            }

            socket.emit('chat:done', { sessionId, usage, provider: decision.provider, cost });
            abortControllers.delete(sessionId);
          },

          onError: (error) => {
            socket.emit('chat:error', { sessionId, error: error.message });
            abortControllers.delete(sessionId);
          },
        };

        // Dispatch to provider
        const pending = await provider.chat(
          chatMessages,
          systemPrompt,
          callbacks,
          abortController.signal,
          overrideActive,
        );

        if (pending) {
          pendingConfirmations.set(sessionId, pending);
        }
      } catch (err) {
        socket.emit('chat:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'An unexpected error occurred',
        });
        abortControllers.delete(sessionId);
      }
    }

    // ------------------------------------------------------------------
    // chat:confirm -- user confirms or denies a RED-tier action
    // ------------------------------------------------------------------
    async function handleConfirm(payload: ChatConfirmPayload): Promise<void> {
      const { sessionId, toolUseId, confirmed } = payload ?? {};

      if (!sessionId || !toolUseId || typeof confirmed !== 'boolean') {
        socket.emit('chat:error', {
          sessionId: sessionId ?? 'unknown',
          error: 'Invalid confirmation payload: sessionId, toolUseId, and confirmed (boolean) are required',
        });
        return;
      }

      const pending = pendingConfirmations.get(sessionId);
      if (!pending) {
        socket.emit('chat:error', {
          sessionId,
          error: 'No pending confirmation found for this session',
        });
        return;
      }

      // Remove from pending map
      pendingConfirmations.delete(sessionId);

      try {
        // Build fresh Claude system prompt (confirmations are always Claude)
        const summary = await buildClusterSummary();
        const systemPrompt = buildClaudeSystemPrompt(summary);

        // Create abort controller
        const abortController = new AbortController();
        abortControllers.set(sessionId, abortController);

        // Accumulate text for DB persistence
        let accumulatedText = '';

        const callbacks: StreamCallbacks = {
          onTextDelta: (text: string) => {
            accumulatedText += text;
            socket.emit('chat:token', { sessionId, text });
          },

          onToolUse: (toolName, toolInput, toolUseId, tier) => {
            socket.emit('chat:tool_use', { sessionId, toolName, toolInput, toolUseId, tier });
            eventsNs.emit('event', {
              id: crypto.randomUUID(),
              type: 'action',
              severity: 'info',
              title: `Tool: ${toolName}`,
              message: `Executed ${toolName} via chat`,
              source: 'jarvis',
              timestamp: new Date().toISOString(),
            });
          },

          onToolResult: (toolUseId, result, isError) => {
            socket.emit('chat:tool_result', { sessionId, toolUseId, result, isError });
          },

          onConfirmationNeeded: (toolName, toolInput, toolUseId, tier) => {
            socket.emit('chat:confirm_needed', { sessionId, toolName, toolInput, toolUseId, tier });
          },

          onBlocked: (toolName, reason, tier) => {
            socket.emit('chat:blocked', { sessionId, toolName, reason, tier });
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
              } catch {
                // Non-critical
              }
            }

            sessionLastProvider.set(sessionId, 'claude');
            socket.emit('chat:done', { sessionId, usage, provider: 'claude', cost });
            abortControllers.delete(sessionId);
          },

          onError: (error) => {
            socket.emit('chat:error', { sessionId, error: error.message });
            abortControllers.delete(sessionId);
          },
        };

        // Resume the agentic loop after confirmation
        const nextPending = await resumeAfterConfirmation(
          pending,
          confirmed,
          systemPrompt,
          callbacks,
          abortController.signal,
        );

        // If another confirmation is needed, store it
        if (nextPending) {
          pendingConfirmations.set(sessionId, nextPending);
        }
      } catch (err) {
        socket.emit('chat:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Confirmation handling failed',
        });
        abortControllers.delete(sessionId);
      }
    }

    // Register handlers
    socket.on('chat:send', handleSend);
    socket.on('chat:confirm', handleConfirm);

    // Cleanup on disconnect
    socket.on('disconnect', (reason: string) => {
      console.log(`[Chat] Client disconnected: ${socket.id} (${reason})`);

      // Abort any active requests
      for (const controller of abortControllers.values()) {
        controller.abort();
      }
      abortControllers.clear();
      pendingConfirmations.clear();
      sessionLastProvider.clear();
      sessionHistoryCache.clear();
    });
  });

  console.log(`[Chat] AI chat handler registered on /chat namespace`);
  console.log(`[Chat] Providers: Claude (agentic + tools), Qwen (conversational)`);
  console.log(`[Chat] Routing: intent-based decision tree`);
}

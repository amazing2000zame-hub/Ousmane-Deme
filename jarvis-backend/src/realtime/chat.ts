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
import { synthesizeSentenceWithFallback, ttsAvailable, getCachedXttsAudio, type TTSEngine } from '../ai/tts.js';
import { cleanTextForSpeech } from '../ai/text-cleaner.js';
import { encodeWavToOpus, isOpusEnabled } from '../ai/opus-encode.js';
import { RequestTimer } from './timing.js';
import { ContextManager } from '../ai/context-manager.js';

// Provider lookup map
const providers: Record<string, LLMProvider> = {
  claude: claudeProvider,
  qwen: qwenProvider,
};

// ---------------------------------------------------------------------------
// Tool acknowledgment phrases (spoken before executing tools)
// ---------------------------------------------------------------------------

const TOOL_ACK_PHRASES = [
  'One moment, sir.',
  'Getting that pulled up now.',
  'Right away, sir.',
  'Let me check on that.',
  'Working on it.',
];

let ackPhraseIndex = 0;

/**
 * Get the next acknowledgment phrase (round-robin).
 */
function getNextAckPhrase(): string {
  const phrase = TOOL_ACK_PHRASES[ackPhraseIndex];
  ackPhraseIndex = (ackPhraseIndex + 1) % TOOL_ACK_PHRASES.length;
  return phrase;
}

/**
 * Send a pre-cached acknowledgment phrase immediately.
 * Used to give voice feedback before long-running tool calls.
 *
 * ONLY uses cached XTTS Jarvis audio - instant, no synthesis wait.
 * If phrase not cached, silently skips (no acknowledgment is better than wrong voice).
 */
async function sendToolAcknowledgment(
  socket: Socket,
  sessionId: string,
  voiceMode: boolean,
): Promise<void> {
  if (!voiceMode) return;

  const phrase = getNextAckPhrase();
  try {
    // Only use pre-cached Jarvis audio - instant lookup, no synthesis
    const audio = await getCachedXttsAudio(phrase);
    if (audio) {
      socket.emit('chat:acknowledge', {
        sessionId,
        phrase,
        contentType: audio.contentType,
        audio: audio.buffer.toString('base64'),
      });
      console.log(`[Chat] Sent acknowledgment: "${phrase}" (cached XTTS)`);
    }
    // If not cached, skip silently - don't block or use wrong voice
  } catch {
    // Non-critical, continue without acknowledgment
  }
}

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
    /** Phase 24: Shared context manager for sliding window + summarization */
    const contextManager = new ContextManager();

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
        // Phase 24: Pipeline timing — t0_received is auto-marked in constructor
        const timer = new RequestTimer();

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

        // Phase 24: Add user message to context manager
        contextManager.addMessage(sessionId, 'user', message.trim());

        // PERF-014: Also maintain sessionHistoryCache for backward compat (memory extraction, etc.)
        const cachedHistory = sessionHistoryCache.get(sessionId);
        if (cachedHistory) {
          cachedHistory.push({ role: 'user', content: message.trim() });
        } else {
          try {
            const dbMessages = memoryStore.getSessionMessages(sessionId);
            sessionHistoryCache.set(sessionId, [...dbMessages, { role: 'user', content: message.trim() }]);
            // Seed context manager with DB history for first message in session
            for (const msg of dbMessages) {
              contextManager.addMessage(sessionId, msg.role, msg.content);
            }
          } catch {
            sessionHistoryCache.set(sessionId, [{ role: 'user', content: message.trim() }]);
          }
        }

        // Detect override passkey in user message
        const overrideKey = config.overrideKey;
        const overrideActive = overrideKey.length > 0
          && message.toLowerCase().includes(overrideKey.toLowerCase());
        if (overrideActive) {
          console.log(`[Chat] Override passkey detected in message from ${socket.id}`);
        }

        // Emit routing stage
        socket.emit('chat:stage', { sessionId, stage: 'routing', detail: '' });

        // Route message to appropriate provider
        const lastProvider = sessionLastProvider.get(sessionId);
        const decision = routeMessage(message, overrideActive, lastProvider);
        timer.mark('t1_routed');
        const provider = providers[decision.provider];
        console.log(`[Chat] Routing to ${decision.provider}: ${decision.reason}`);

        // Emit thinking stage with provider name
        socket.emit('chat:stage', { sessionId, stage: 'thinking', detail: decision.provider });

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

        // Phase 24: Build context-managed message history
        const systemPromptTokenEstimate = Math.ceil(systemPrompt.length / 4);
        const memoryContextTokenEstimate = recallBlock ? Math.ceil(recallBlock.length / 4) : 0;
        const chatMessages = await contextManager.buildContextMessages(
          sessionId,
          systemPromptTokenEstimate,
          memoryContextTokenEstimate,
        );

        // Ensure current message is included (buildContextMessages works from session state)
        const lastMsg = chatMessages[chatMessages.length - 1];
        if (!lastMsg || lastMsg.content !== message.trim() || lastMsg.role !== 'user') {
          chatMessages.push({ role: 'user', content: message.trim() });
        }

        // Create abort controller for this session
        const abortController = new AbortController();
        abortControllers.set(sessionId, abortController);

        // Accumulate text for DB persistence
        let accumulatedText = '';

        // ---------------------------------------------------------------
        // PERF-01/02/03: Streaming voice pipeline — bounded parallel TTS queue
        //
        // Up to config.ttsMaxParallel sentences synthesize concurrently:
        //  - Index assigned at detection (deterministic order)
        //  - Bounded workers prevent CPU starvation of llama-server
        //  - Engine lock maintained across workers (JS single-threaded safety)
        //  - Optional Opus encoding before Socket.IO emission (AUDIO-01)
        //  - Clean abort between sentences via AbortController
        // ---------------------------------------------------------------
        const voicePipeline = voiceMode && ttsAvailable();
        let sentenceAccumulator: SentenceAccumulator | null = null;
        let audioChunkIndex = 0;

        // Bounded parallel TTS queue — shared across sentence callbacks and onDone
        const ttsQueue: { text: string; index: number }[] = [];
        let ttsStreamFinished = false;
        let engineLock: TTSEngine | null = null;
        let activeWorkers = 0;
        let totalEmitted = 0;

        // Phase 24: Timing flags for first-occurrence marks
        let firstTokenMarked = false;
        let firstAudioReady = false;
        let firstAudioEmitted = false;

        // Only send ONE voice acknowledgment per request (not per tool)
        let ackSentThisRequest = false;

        async function drainTtsQueue(): Promise<void> {
          // Launch up to config.ttsMaxParallel concurrent synthesis tasks
          while (ttsQueue.length > 0 && activeWorkers < config.ttsMaxParallel) {
            if (abortController.signal.aborted) break;
            const item = ttsQueue.shift()!;
            activeWorkers++;

            // Fire-and-forget -- does NOT block the while loop
            synthesizeAndEmit(item).finally(() => {
              activeWorkers--;
              // When a slot frees, try to fill it
              drainTtsQueue();
            });
          }

          // When stream is done, all workers finished, and queue empty, signal complete
          if (ttsStreamFinished && activeWorkers === 0 && ttsQueue.length === 0) {
            socket.emit('chat:audio_done', { sessionId, totalChunks: audioChunkIndex });
          }
        }

        async function synthesizeAndEmit(item: { text: string; index: number }): Promise<void> {
          try {
            const audio = await synthesizeSentenceWithFallback(item.text, { engineLock });
            if (audio && !abortController.signal.aborted) {
              // TTS-04: Update engine lock for voice consistency
              if (engineLock === null) {
                engineLock = audio.engine;
              }
              if (audio.engine === 'piper') {
                engineLock = 'piper'; // Once piper, always piper for this response
              }

              // Phase 24: Mark first audio synthesis completed
              if (!firstAudioReady) {
                firstAudioReady = true;
                timer.mark('t6_tts_first');
              }

              // Optional Opus encoding (AUDIO-01)
              let emitBuffer = audio.buffer;
              let emitContentType = audio.contentType;
              if (isOpusEnabled()) {
                try {
                  const opus = await encodeWavToOpus(audio.buffer);
                  emitBuffer = opus.buffer;
                  emitContentType = opus.contentType;
                } catch (err) {
                  console.warn(`[Chat] Opus encoding failed, sending WAV: ${err instanceof Error ? err.message : err}`);
                  // Fall through with original WAV
                }
              }

              socket.emit('chat:audio_chunk', {
                sessionId,
                index: item.index,
                contentType: emitContentType,
                audio: emitBuffer,
              });
              // Phase 24: Mark first audio delivered to client
              if (!firstAudioEmitted) {
                firstAudioEmitted = true;
                timer.mark('t7_audio_delivered');
              }
              totalEmitted++;
            }
          } catch (err) {
            console.warn(`[Chat] TTS error sentence ${item.index}: ${err instanceof Error ? err.message : err}`);
          }
        }

        if (voicePipeline) {
          let firstSentenceEmitted = false;
          sentenceAccumulator = new SentenceAccumulator((sentence, sentenceIdx) => {
            const cleaned = cleanTextForSpeech(sentence);
            if (!cleaned) return;

            // Signal synthesizing stage on first sentence
            if (!firstSentenceEmitted) {
              firstSentenceEmitted = true;
              timer.mark('t5_tts_queued');
              socket.emit('chat:stage', { sessionId, stage: 'synthesizing', detail: '' });
            }

            // Emit sentence text immediately (frontend uses for display)
            socket.emit('chat:sentence', { sessionId, index: sentenceIdx, text: cleaned });

            // Assign chunk index NOW (deterministic sentence order, not TTS completion order)
            ttsQueue.push({ text: cleaned, index: audioChunkIndex++ });
            drainTtsQueue();
          });
        }

        // Build streaming callbacks
        const callbacks: StreamCallbacks = {
          onTextDelta: (text: string) => {
            // Phase 24: Mark first token received
            if (!firstTokenMarked) {
              firstTokenMarked = true;
              timer.mark('t3_first_token');
            }
            accumulatedText += text;
            socket.emit('chat:token', { sessionId, text });
            // PERF-01: Feed sentence accumulator during streaming
            sentenceAccumulator?.push(text);
          },

          onToolUse: async (toolName, toolInput, toolUseId, tier) => {
            // Send voice acknowledgment ONCE per request (not per tool)
            if (!ackSentThisRequest) {
              ackSentThisRequest = true;
              await sendToolAcknowledgment(socket, sessionId, voiceMode);
            }
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
            timer.mark('t4_llm_done');
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

            // Phase 24: Update context manager with assistant response
            if (accumulatedText.length > 0) {
              contextManager.addMessage(sessionId, 'assistant', accumulatedText);
            }

            // Phase 24: Trigger background summarization if threshold exceeded
            if (contextManager.shouldSummarize(sessionId)) {
              contextManager.summarize(sessionId)
                .catch(err => console.warn(`[Context] Summarization failed: ${err instanceof Error ? err.message : err}`));
              // Non-blocking: summarization runs in background, result available for next message
            }

            // Flush remaining sentence text and mark TTS stream as done
            if (sentenceAccumulator) {
              sentenceAccumulator.flush();
              ttsStreamFinished = true;
              // If queue already empty and no active workers, signal immediately
              if (activeWorkers === 0 && ttsQueue.length === 0) {
                socket.emit('chat:audio_done', { sessionId, totalChunks: audioChunkIndex });
              }
              // Otherwise drainTtsQueue() signals when it finishes
            }

            // Phase 24: Finalize timing and emit breakdown
            timer.mark('total');
            const timing = timer.breakdown();
            console.log(`[Chat] ${timer.toLog()}`);

            // Emit chat:done immediately (text stream complete).
            // Audio may still be arriving via progressive pipeline;
            // frontend uses _progressiveWasUsed flag to avoid double-play.
            socket.emit('chat:done', { sessionId, usage, provider: decision.provider, cost, timing });
            socket.emit('chat:timing', { sessionId, timing });
            abortControllers.delete(sessionId);
          },

          onError: (error) => {
            socket.emit('chat:error', { sessionId, error: error.message });
            abortControllers.delete(sessionId);
          },
        };

        // Dispatch to provider
        timer.mark('t2_llm_start');
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

          onToolUse: async (toolName, toolInput, toolUseId, tier) => {
            // Note: voiceMode not available in confirmation flow, default to false
            // (voice acknowledgment was already sent during the original request)
            await sendToolAcknowledgment(socket, sessionId, false);
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
      // Phase 24: Clear context manager sessions for this socket
      for (const sid of sessionHistoryCache.keys()) {
        contextManager.clearSession(sid);
      }
      sessionHistoryCache.clear();
    });
  });

  console.log(`[Chat] AI chat handler registered on /chat namespace`);
  console.log(`[Chat] Providers: Claude (agentic + tools), Qwen (conversational)`);
  console.log(`[Chat] Routing: intent-based decision tree`);
}

/**
 * Socket.IO /voice namespace handler for server-side voice I/O.
 *
 * Enables voice control via the agent node's built-in mic and speaker,
 * bypassing browser requirements. The agent node runs a Python service
 * that captures audio from the mic, detects wake words, and streams
 * audio to this namespace.
 *
 * Events from Agent (incoming):
 *   voice:audio_start  { agentId }                     - Wake word detected, starting capture
 *   voice:audio_chunk  { agentId, audio, seq }         - Audio chunk (500ms WAV, base64)
 *   voice:audio_end    { agentId }                     - Silence detected, capture ended
 *   voice:ping         { agentId }                     - Keep-alive ping
 *
 * Events to Agent (outgoing):
 *   voice:listening    { }                             - Ready to receive audio
 *   voice:processing   { }                             - Transcribing audio
 *   voice:transcript   { text }                        - STT result
 *   voice:thinking     { provider }                    - LLM processing
 *   voice:tts_chunk    { index, contentType, audio }   - TTS audio to play (base64)
 *   voice:tts_done     { totalChunks }                 - All TTS chunks sent
 *   voice:error        { error }                       - Error message
 */

import type { Namespace, Socket } from 'socket.io';
import crypto from 'node:crypto';
import { transcribeAudio, whisperConfigured, checkWhisperHealth } from '../ai/stt.js';
import { routeMessage } from '../ai/router.js';
import { buildClaudeSystemPrompt, buildQwenSystemPrompt, buildClusterSummary } from '../ai/system-prompt.js';
import { claudeProvider } from '../ai/providers/claude-provider.js';
import { qwenProvider } from '../ai/providers/qwen-provider.js';
import { openaiProvider } from '../ai/providers/openai-provider.js';
import type { LLMProvider } from '../ai/providers.js';
import type { StreamCallbacks } from '../ai/loop.js';
import { synthesizeSentenceWithFallback, ttsAvailable, type TTSEngine } from '../ai/tts.js';
import { SentenceAccumulator } from '../ai/sentence-stream.js';
import { cleanTextForSpeech } from '../ai/text-cleaner.js';
import { encodeWavToOpus, isOpusEnabled } from '../ai/opus-encode.js';
import { memoryStore } from '../db/memory.js';
import { config } from '../config.js';

// Provider lookup
const providers: Record<string, LLMProvider> = {
  claude: claudeProvider,
  qwen: qwenProvider,
  openai: openaiProvider,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VoiceSession {
  agentId: string;
  socketId: string;
  audioChunks: Buffer[];
  startedAt: number;
  lastChunkAt: number;
  abortController: AbortController;
}

// Active voice sessions by agent ID
const voiceSessions = new Map<string, VoiceSession>();

// ---------------------------------------------------------------------------
// Voice agent status tracking (Phase 38)
// ---------------------------------------------------------------------------

export type VoiceAgentState = 'idle' | 'listening' | 'capturing' | 'processing' | 'speaking';

export interface VoiceAgentStatus {
  agentId: string;
  connected: boolean;
  state: VoiceAgentState;
  connectedAt: number;
  lastInteractionAt: number;
}

const voiceAgents = new Map<string, VoiceAgentStatus>();

function updateAgentState(agentId: string, state: VoiceAgentState): void {
  const agent = voiceAgents.get(agentId);
  if (agent) {
    agent.state = state;
    if (state !== 'idle') agent.lastInteractionAt = Date.now();
  }
}

/** Get all connected voice agents and their status. */
export function getVoiceAgents(): VoiceAgentStatus[] {
  return Array.from(voiceAgents.values());
}

// Silence detection timeout (ms) - end capture after this much silence
const SILENCE_TIMEOUT_MS = parseInt(process.env.VOICE_SILENCE_TIMEOUT_MS || '2000', 10);

// Maximum recording duration (ms)
const MAX_RECORDING_MS = 30_000;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Register voice event handlers on the /voice Socket.IO namespace.
 */
export function setupVoiceHandlers(voiceNs: Namespace, eventsNs: Namespace): void {
  voiceNs.on('connection', (socket: Socket) => {
    console.log(`[Voice] Agent connected: ${socket.id}`);

    // Register agent in tracking map
    const agentStatus: VoiceAgentStatus = {
      agentId: socket.id,
      connected: true,
      state: 'idle',
      connectedAt: Date.now(),
      lastInteractionAt: Date.now(),
    };
    voiceAgents.set(socket.id, agentStatus);

    // Tell agent we're ready
    socket.emit('voice:listening', {});

    // Handle wake word detection - start receiving audio
    socket.on('voice:audio_start', (payload: { agentId?: string }) => {
      const agentId = payload?.agentId || socket.id;

      // Clean up any existing session for this agent
      const existing = voiceSessions.get(agentId);
      if (existing) {
        existing.abortController.abort();
        voiceSessions.delete(agentId);
      }

      // Create new session
      const session: VoiceSession = {
        agentId,
        socketId: socket.id,
        audioChunks: [],
        startedAt: Date.now(),
        lastChunkAt: Date.now(),
        abortController: new AbortController(),
      };
      voiceSessions.set(agentId, session);

      console.log(`[Voice] Wake word detected from agent ${agentId}, starting capture`);
      updateAgentState(socket.id, 'capturing');
      socket.emit('voice:listening', { agentId });
    });

    // Handle incoming audio chunks
    socket.on('voice:audio_chunk', (payload: { agentId?: string; audio?: string; seq?: number }) => {
      const agentId = payload?.agentId || socket.id;
      const session = voiceSessions.get(agentId);

      if (!session) {
        console.warn(`[Voice] Received audio chunk for unknown session: ${agentId}`);
        return;
      }

      if (!payload.audio) {
        console.warn(`[Voice] Empty audio chunk from ${agentId}`);
        return;
      }

      // Decode base64 audio and add to session
      const audioBuffer = Buffer.from(payload.audio, 'base64');
      session.audioChunks.push(audioBuffer);
      session.lastChunkAt = Date.now();

      // Check for max duration
      if (Date.now() - session.startedAt > MAX_RECORDING_MS) {
        console.log(`[Voice] Max recording duration reached for ${agentId}`);
        processVoiceSession(socket, session, eventsNs);
      }
    });

    // Handle end of audio capture (silence detected by agent)
    socket.on('voice:audio_end', (payload: { agentId?: string }) => {
      const agentId = payload?.agentId || socket.id;
      const session = voiceSessions.get(agentId);

      if (!session) {
        console.warn(`[Voice] Received audio_end for unknown session: ${agentId}`);
        return;
      }

      console.log(`[Voice] Audio capture ended for ${agentId}, processing...`);
      processVoiceSession(socket, session, eventsNs);
    });

    // Handle keep-alive pings
    socket.on('voice:ping', (payload: { agentId?: string }) => {
      socket.emit('voice:pong', { agentId: payload?.agentId || socket.id });
    });

    // Cleanup on disconnect
    socket.on('disconnect', (reason: string) => {
      console.log(`[Voice] Agent disconnected: ${socket.id} (${reason})`);

      // Remove from agent tracking
      voiceAgents.delete(socket.id);

      // Abort any active sessions for this socket
      for (const [agentId, session] of voiceSessions.entries()) {
        if (session.socketId === socket.id) {
          session.abortController.abort();
          voiceSessions.delete(agentId);
        }
      }
    });
  });

  console.log('[Voice] Voice handler registered on /voice namespace');
}

// ---------------------------------------------------------------------------
// Voice processing pipeline
// ---------------------------------------------------------------------------

/**
 * Process a completed voice session:
 * 1. Concatenate audio chunks
 * 2. Send to Whisper for transcription
 * 3. Route through chat pipeline
 * 4. Stream TTS response back to agent
 */
async function processVoiceSession(
  socket: Socket,
  session: VoiceSession,
  eventsNs: Namespace
): Promise<void> {
  // Remove session from active map
  voiceSessions.delete(session.agentId);

  // Check for empty audio
  if (session.audioChunks.length === 0) {
    console.warn(`[Voice] Empty audio session from ${session.agentId}`);
    socket.emit('voice:error', { error: 'No audio received' });
    socket.emit('voice:listening', {});
    return;
  }

  // Concatenate audio chunks
  const audioBuffer = Buffer.concat(session.audioChunks);
  const durationMs = Date.now() - session.startedAt;
  console.log(`[Voice] Processing ${audioBuffer.length} bytes (${durationMs}ms) from ${session.agentId}`);

  // Signal processing state
  updateAgentState(socket.id, 'processing');
  socket.emit('voice:processing', {});

  try {
    // -------------------------------------------------------------------------
    // Step 1: Speech-to-Text
    // -------------------------------------------------------------------------
    if (!whisperConfigured()) {
      throw new Error('Whisper STT not configured');
    }

    const healthy = await checkWhisperHealth();
    if (!healthy) {
      throw new Error('Whisper STT service not available');
    }

    const sttResult = await transcribeAudio(audioBuffer, { language: 'en' });
    const transcript = sttResult.transcript.trim();

    if (!transcript) {
      console.log(`[Voice] Empty transcript from ${session.agentId}`);
      socket.emit('voice:error', { error: 'Could not understand audio' });
      socket.emit('voice:listening', {});
      return;
    }

    console.log(`[Voice] Transcript: "${transcript}" (${sttResult.processingTimeSeconds}s)`);
    socket.emit('voice:transcript', { text: transcript });

    // Save user message to DB
    const sessionId = crypto.randomUUID();
    try {
      memoryStore.saveMessage({
        sessionId,
        role: 'user',
        content: transcript,
      });
    } catch {
      // Non-critical
    }

    // -------------------------------------------------------------------------
    // Step 2: Route and process through LLM
    // -------------------------------------------------------------------------
    const decision = routeMessage(transcript, false, undefined);
    console.log(`[Voice] Routing to ${decision.provider}: ${decision.reason}`);
    socket.emit('voice:thinking', { provider: decision.provider });

    const provider = providers[decision.provider];
    const summary = await buildClusterSummary();
    const systemPrompt = decision.provider === 'claude'
      ? await buildClaudeSystemPrompt(summary, false, transcript, undefined, true)
      : buildQwenSystemPrompt(summary, transcript, undefined, true);

    // Build chat messages
    const chatMessages = [{ role: 'user', content: transcript }];

    // -------------------------------------------------------------------------
    // Step 3: Stream LLM response with TTS
    // -------------------------------------------------------------------------
    const voicePipeline = ttsAvailable();
    let sentenceAccumulator: SentenceAccumulator | null = null;
    let audioChunkIndex = 0;
    let accumulatedText = '';

    // TTS queue for bounded parallel synthesis
    const ttsQueue: { text: string; index: number }[] = [];
    let ttsStreamFinished = false;
    let engineLock: TTSEngine | null = null;
    let activeWorkers = 0;

    async function drainTtsQueue(): Promise<void> {
      while (ttsQueue.length > 0 && activeWorkers < config.ttsMaxParallel) {
        if (session.abortController.signal.aborted) break;
        const item = ttsQueue.shift()!;
        activeWorkers++;

        synthesizeAndEmit(item).finally(() => {
          activeWorkers--;
          drainTtsQueue();
        });
      }

      if (ttsStreamFinished && activeWorkers === 0 && ttsQueue.length === 0) {
        updateAgentState(socket.id, 'idle');
        socket.emit('voice:tts_done', { totalChunks: audioChunkIndex });
        // Ready for next wake word
        socket.emit('voice:listening', {});
      }
    }

    async function synthesizeAndEmit(item: { text: string; index: number }): Promise<void> {
      try {
        const audio = await synthesizeSentenceWithFallback(item.text, { engineLock });
        if (audio && !session.abortController.signal.aborted) {
          if (engineLock === null) engineLock = audio.engine;
          if (audio.engine === 'piper') engineLock = 'piper';

          let emitBuffer = audio.buffer;
          let emitContentType = audio.contentType;

          if (isOpusEnabled()) {
            try {
              const opus = await encodeWavToOpus(audio.buffer);
              emitBuffer = opus.buffer;
              emitContentType = opus.contentType;
            } catch {
              // Fall through with WAV
            }
          }

          // Mark speaking on first TTS chunk
          if (item.index === 0) updateAgentState(socket.id, 'speaking');
          socket.emit('voice:tts_chunk', {
            index: item.index,
            contentType: emitContentType,
            audio: emitBuffer.toString('base64'),
          });
        }
      } catch (err) {
        console.warn(`[Voice] TTS error for sentence ${item.index}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (voicePipeline) {
      sentenceAccumulator = new SentenceAccumulator((sentence, _idx) => {
        const cleaned = cleanTextForSpeech(sentence);
        if (!cleaned) return;

        ttsQueue.push({ text: cleaned, index: audioChunkIndex++ });
        drainTtsQueue();
      });
    }

    // Build streaming callbacks
    const callbacks: StreamCallbacks = {
      onTextDelta: (text: string) => {
        accumulatedText += text;
        sentenceAccumulator?.push(text);
      },

      onToolUse: async (toolName, _toolInput, _toolUseId, _tier) => {
        console.log(`[Voice] Tool use: ${toolName}`);
      },

      onToolResult: (_toolUseId, _result, _isError) => {
        // Tool results handled internally
      },

      onConfirmationNeeded: (toolName, _toolInput, _toolUseId, tier) => {
        // Voice mode doesn't support confirmations - auto-decline RED tier
        console.log(`[Voice] Confirmation needed for ${toolName} (${tier}) - voice mode auto-declines`);
      },

      onBlocked: (toolName, reason, tier) => {
        console.log(`[Voice] Tool blocked: ${toolName} (${tier}): ${reason}`);
      },

      onDone: (usage) => {
        console.log(`[Voice] LLM done: ${usage.inputTokens} in / ${usage.outputTokens} out`);

        // Save assistant message
        if (accumulatedText.length > 0) {
          try {
            memoryStore.saveMessage({
              sessionId,
              role: 'assistant',
              content: accumulatedText,
              model: decision.provider,
              tokensUsed: usage.inputTokens + usage.outputTokens,
            });
          } catch {
            // Non-critical
          }
        }

        // Flush remaining sentences and mark TTS complete
        if (sentenceAccumulator) {
          sentenceAccumulator.flush();
          ttsStreamFinished = true;
          if (activeWorkers === 0 && ttsQueue.length === 0) {
            updateAgentState(socket.id, 'idle');
            socket.emit('voice:tts_done', { totalChunks: audioChunkIndex });
            socket.emit('voice:listening', {});
          }
        } else {
          // No TTS pipeline - ready for next command
          updateAgentState(socket.id, 'idle');
          socket.emit('voice:listening', {});
        }

        // Log event
        eventsNs.emit('event', {
          id: crypto.randomUUID(),
          type: 'action',
          severity: 'info',
          title: 'Voice Command',
          message: `Processed: "${transcript.slice(0, 50)}${transcript.length > 50 ? '...' : ''}"`,
          source: 'jarvis',
          timestamp: new Date().toISOString(),
        });
      },

      onError: (error) => {
        console.error(`[Voice] LLM error: ${error.message}`);
        socket.emit('voice:error', { error: error.message });
        socket.emit('voice:listening', {});
      },
    };

    // Execute chat
    await provider.chat(
      chatMessages,
      systemPrompt,
      callbacks,
      session.abortController.signal,
      false // overrideActive
    );

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Voice] Processing error: ${errorMsg}`);
    updateAgentState(socket.id, 'idle');
    socket.emit('voice:error', { error: errorMsg });
    socket.emit('voice:listening', {});
  }
}

/**
 * Get voice namespace status for health checks.
 */
export function getVoiceStatus(): {
  activeSessions: number;
  whisperConfigured: boolean;
  ttsAvailable: boolean;
} {
  return {
    activeSessions: voiceSessions.size,
    whisperConfigured: whisperConfigured(),
    ttsAvailable: ttsAvailable(),
  };
}

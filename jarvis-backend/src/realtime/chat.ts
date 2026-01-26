/**
 * Socket.IO /chat namespace handler for AI chat interactions.
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
 *  - chat:done            { sessionId, usage }
 *  - chat:error           { sessionId, error }
 */

import type { Namespace, Socket } from 'socket.io';

// ---------------------------------------------------------------------------
// Smart routing: local LLM for conversation, Claude for tool-requiring messages
// ---------------------------------------------------------------------------

/** Keywords that suggest the message needs cluster tools */
const TOOL_KEYWORDS = [
  // cluster infrastructure
  'status', 'cluster', 'node', 'nodes', 'quorum',
  'vm', 'vms', 'container', 'containers', 'lxc', 'qemu',
  'storage', 'disk', 'backup', 'temperature', 'temp',
  'cpu', 'memory', 'ram', 'uptime',
  // actions
  'start', 'stop', 'restart', 'reboot', 'shutdown',
  'update', 'upgrade', 'wake', 'wol',
  'run', 'execute', 'ssh', 'command',
  'check', 'show', 'list', 'get', 'fetch',
  // specific resources
  'pve', 'agent1', 'agent', 'home',
  'management', 'twingate', 'adguard', 'homeassistant',
  'ubuntu', 'displayvm',
  'service', 'systemctl', 'docker',
  // override always needs Claude
  'override',
];

function needsTools(message: string): boolean {
  const lower = message.toLowerCase();
  return TOOL_KEYWORDS.some((kw) => lower.includes(kw));
}
import crypto from 'node:crypto';
import { buildSystemPrompt, buildClusterSummary } from '../ai/system-prompt.js';
import {
  runAgenticLoop,
  resumeAfterConfirmation,
  type PendingConfirmation,
  type StreamCallbacks,
} from '../ai/loop.js';
import { runLocalChat } from '../ai/local-llm.js';
import { claudeAvailable } from '../ai/claude.js';
import { memoryStore } from '../db/memory.js';
import { config } from '../config.js';
import type Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Types for incoming events
// ---------------------------------------------------------------------------

interface ChatSendPayload {
  sessionId?: string;
  message: string;
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

        // Load conversation history
        let history: Array<{ role: string; content: string }> = [];
        try {
          const dbMessages = memoryStore.getSessionMessages(sessionId);
          history = dbMessages.slice(-config.chatHistoryLimit);
        } catch {
          // If DB fails, start with just the current message
          history = [{ role: 'user', content: message.trim() }];
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

        // Build system prompt with live cluster context
        const summary = await buildClusterSummary();
        const systemPrompt = buildSystemPrompt(summary, overrideActive);

        // Create abort controller for this session
        const abortController = new AbortController();
        abortControllers.set(sessionId, abortController);

        // Smart routing: use Claude only when tools are likely needed
        const useClaude = claudeAvailable && (needsTools(message) || overrideActive);
        const provider = useClaude ? 'claude' : 'local';
        console.log(`[Chat] Routing to ${provider} (tools needed: ${needsTools(message)}, override: ${overrideActive})`);

        // Accumulate text for DB persistence
        let accumulatedText = '';

        // Build streaming callbacks
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
            if (accumulatedText.length > 0) {
              try {
                memoryStore.saveMessage({
                  sessionId,
                  role: 'assistant',
                  content: accumulatedText,
                  model: provider,
                  tokensUsed: usage.inputTokens + usage.outputTokens,
                });
              } catch {
                // Non-critical
              }
            }

            socket.emit('chat:done', { sessionId, usage });
            abortControllers.delete(sessionId);
          },

          onError: (error) => {
            socket.emit('chat:error', { sessionId, error: error.message });
            abortControllers.delete(sessionId);
          },
        };

        if (useClaude) {
          // Full agentic loop with tools via Claude API
          const messages: Anthropic.MessageParam[] = chatMessages;
          const pending = await runAgenticLoop(messages, systemPrompt, callbacks, abortController.signal, overrideActive);

          if (pending) {
            pendingConfirmations.set(sessionId, pending);
          }
        } else {
          // Local LLM: text-only conversation (saves Claude tokens)
          await runLocalChat(chatMessages, systemPrompt, callbacks, abortController.signal);
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
        // Build fresh system prompt
        const summary = await buildClusterSummary();
        const systemPrompt = buildSystemPrompt(summary);

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
            if (accumulatedText.length > 0) {
              try {
                memoryStore.saveMessage({
                  sessionId,
                  role: 'assistant',
                  content: accumulatedText,
                  model: 'claude',
                  tokensUsed: usage.inputTokens + usage.outputTokens,
                });
              } catch {
                // Non-critical
              }
            }

            socket.emit('chat:done', { sessionId, usage });
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
    });
  });

  const provider = claudeAvailable ? 'Claude API (agentic + tools)' : `Local LLM (${config.localLlmEndpoint})`;
  console.log(`[Chat] AI chat handler registered on /chat namespace`);
  console.log(`[Chat] Provider: ${provider}`);
}

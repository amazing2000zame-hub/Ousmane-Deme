/**
 * Claude provider -- agentic LLM with tool-use capabilities.
 *
 * Wraps the existing runAgenticLoop to conform to the LLMProvider interface.
 * Claude handles all cluster management tasks that require tool execution.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../providers.js';
import type { PendingConfirmation, StreamCallbacks } from '../loop.js';
import { runAgenticLoop } from '../loop.js';
import { claudeAvailable } from '../claude.js';

export const claudeProvider: LLMProvider = {
  name: 'claude',

  capabilities: {
    tools: true,
    streaming: true,
    contextWindow: 200_000,
  },

  async chat(
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal,
    overrideActive: boolean = false,
  ): Promise<PendingConfirmation | null> {
    if (!claudeAvailable) {
      callbacks.onError(new Error('Claude API key not configured'));
      return null;
    }

    // Convert to Anthropic message format
    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    return runAgenticLoop(anthropicMessages, systemPrompt, callbacks, abortSignal, overrideActive);
  },
};

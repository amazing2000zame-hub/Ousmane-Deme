/**
 * Qwen provider -- local LLM for conversational text-only responses.
 *
 * Uses the OpenAI-compatible endpoint exposed by llama-server. No tool-use
 * support. Caps conversation history to prevent context overflow on the
 * smaller 4096-token context window.
 */

import OpenAI from 'openai';
import type { LLMProvider } from '../providers.js';
import type { PendingConfirmation, StreamCallbacks } from '../loop.js';
import { config } from '../../config.js';

const openai = new OpenAI({
  baseURL: `${config.localLlmEndpoint}/v1`,
  apiKey: 'not-needed', // llama-server doesn't require auth
});

export const qwenProvider: LLMProvider = {
  name: 'qwen',

  capabilities: {
    tools: false,
    streaming: true,
    contextWindow: config.qwenContextWindow,
  },

  async chat(
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal,
    _overrideActive: boolean = false,
  ): Promise<PendingConfirmation | null> {
    // Cap history to prevent context overflow
    const historyLimit = config.qwenHistoryLimit;
    const trimmed = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-historyLimit);

    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...trimmed.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    try {
      const stream = await openai.chat.completions.create(
        {
          model: config.localLlmModel,
          messages: chatMessages,
          stream: true,
          temperature: 0.7,
          max_tokens: 1024,
        },
        { signal: abortSignal },
      );

      let outputTokens = 0;

      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          callbacks.onError(new Error('Request aborted'));
          return null;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          callbacks.onTextDelta(delta);
          outputTokens++;
        }
      }

      callbacks.onDone({ inputTokens: 0, outputTokens });
    } catch (err) {
      if (abortSignal?.aborted) {
        callbacks.onError(new Error('Request aborted'));
      } else {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Qwen never produces PendingConfirmation (no tool-use)
    return null;
  },
};

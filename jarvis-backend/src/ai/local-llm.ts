/**
 * Local LLM fallback via OpenAI-compatible endpoint (llama-server).
 *
 * Used when ANTHROPIC_API_KEY is not configured. Streams text responses
 * from the local Qwen model. No tool-use support -- plain conversational
 * chat only, but still uses the JARVIS personality prompt.
 */

import { config } from '../config.js';
import type { StreamCallbacks } from './loop.js';

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Run a simple streaming chat against the local LLM.
 * No tool-use, no agentic loop -- just prompt in, text out.
 */
export async function runLocalChat(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<null> {
  const endpoint = `${config.localLlmEndpoint}/v1/chat/completions`;

  const chatMessages: OpenAIChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
  ];

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.localLlmModel,
        messages: chatMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 1024,
      }),
      signal: abortSignal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Local LLM returned ${res.status}: ${body}`);
    }

    if (!res.body) {
      throw new Error('Local LLM returned no response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalTokens = 0;

    while (true) {
      if (abortSignal?.aborted) {
        reader.cancel();
        callbacks.onError(new Error('Request aborted'));
        return null;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            callbacks.onTextDelta(delta);
            totalTokens++;
          }
        } catch {
          // Skip malformed SSE chunks
        }
      }
    }

    callbacks.onDone({ inputTokens: 0, outputTokens: totalTokens });
  } catch (err) {
    if (abortSignal?.aborted) {
      callbacks.onError(new Error('Request aborted'));
    } else {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return null;
}

/**
 * Count tokens using the Qwen tokenizer endpoint.
 * Falls back to character-based estimation if endpoint is unreachable.
 */
export async function tokenize(text: string): Promise<number> {
  try {
    const res = await fetch(`${config.localLlmEndpoint}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return Math.ceil(text.length / 4);
    const data = await res.json() as { tokens: number[] };
    return data.tokens.length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens for an array of chat messages.
 * Includes ~4 token overhead per message for chat template framing.
 */
export async function countMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): Promise<number> {
  const counts = await Promise.all(messages.map(m => tokenize(m.content)));
  const contentTotal = counts.reduce((a, b) => a + b, 0);
  return contentTotal + messages.length * 4; // chat template overhead
}

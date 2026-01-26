/**
 * LLMProvider interface -- abstraction layer for AI providers.
 *
 * Both Claude (agentic with tools) and Qwen (conversational text-only)
 * implement this interface, allowing the router to dispatch messages
 * to either provider through a uniform API.
 */

import type { PendingConfirmation, StreamCallbacks } from './loop.js';

export interface ProviderCapabilities {
  tools: boolean;
  streaming: boolean;
  contextWindow: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Send messages to the provider and stream the response.
   *
   * Returns a PendingConfirmation if a RED-tier tool needs user approval
   * (Claude only), or null when the response completes normally.
   */
  chat(
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal,
    overrideActive?: boolean,
  ): Promise<PendingConfirmation | null>;
}

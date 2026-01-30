/**
 * Agentic tool-calling loop with streaming, safety tier interception,
 * and confirmation flow.
 *
 * Handles the complete Claude conversation loop:
 *  1. Send messages to Claude with streaming
 *  2. Process tool_use blocks with safety tier checks
 *  3. GREEN/YELLOW: auto-execute via executeTool()
 *  4. RED: pause and return PendingConfirmation for user approval
 *  5. BLACK: block and report to Claude as error
 *  6. Continue looping until Claude produces a text-only response
 *  7. Max iteration guard prevents infinite loops
 */

import type Anthropic from '@anthropic-ai/sdk';
import { claudeClient, CLAUDE_MODEL } from './claude.js';
import { getClaudeTools } from './tools.js';
import { executeTool } from '../mcp/server.js';
import { getToolTier, ActionTier } from '../safety/tiers.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Tool execution timeout
// ---------------------------------------------------------------------------

/** Maximum time (ms) for any tool to execute. Most tools complete in <30s.
 *  This timeout prevents hung tools from blocking conversations indefinitely. */
const TOOL_TIMEOUT_MS = 60_000;

/**
 * Execute a tool with timeout protection.
 * Returns a user-friendly error message on timeout instead of hanging.
 */
async function executeToolWithTimeout(
  name: string,
  args: Record<string, unknown>,
  source: 'llm' | 'monitor' | 'user' | 'api' = 'llm',
  overrideActive: boolean = false,
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  blocked?: boolean;
  reason?: string;
  tier?: string;
}> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Tool "${name}" timed out after ${TOOL_TIMEOUT_MS / 1000} seconds. The operation may still be running in the background.`));
    }, TOOL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      executeTool(name, args, source, overrideActive),
      timeoutPromise,
    ]);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMessage.includes('timed out');

    return {
      content: [{
        type: 'text',
        text: isTimeout
          ? `I'm sorry, the ${name} operation took too long (over 60 seconds) and was cancelled. This might indicate the service is unresponsive. You can try again or ask me to check the service status.`
          : `Tool "${name}" failed: ${errorMessage}`,
      }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onTextDelta: (text: string) => void;
  /** Called before tool execution. Can be async to allow acknowledgment audio to be sent first. */
  onToolUse: (toolName: string, toolInput: Record<string, unknown>, toolUseId: string, tier: string) => void | Promise<void>;
  onToolResult: (toolUseId: string, result: string, isError: boolean) => void;
  onConfirmationNeeded: (toolName: string, toolInput: Record<string, unknown>, toolUseId: string, tier: string) => void;
  onBlocked: (toolName: string, reason: string, tier: string) => void;
  onDone: (usage: { inputTokens: number; outputTokens: number }) => void;
  onError: (error: Error) => void;
}

export interface PendingConfirmation {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  /** The assistant content blocks up to and including the tool_use that needs confirmation */
  assistantContent: Anthropic.ContentBlock[];
  /** All prior messages (excluding the assistant message that contains the tool_use) */
  priorMessages: Anthropic.MessageParam[];
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

/**
 * Run the agentic tool-calling loop.
 *
 * Returns null if the loop completes normally (Claude produced a final text
 * response). Returns a PendingConfirmation if a RED-tier tool needs user
 * approval before the loop can continue.
 */
export async function runAgenticLoop(
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal,
  overrideActive: boolean = false,
): Promise<PendingConfirmation | null> {
  const currentMessages = [...messages];
  const tools = getClaudeTools();

  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;
  const maxIterations = config.chatMaxLoopIterations;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Check abort signal before each iteration
    if (abortSignal?.aborted) {
      callbacks.onError(new Error('Request aborted'));
      return null;
    }

    // Determine if we should include tools (omit on final forced iteration)
    const isFinalIteration = iteration === maxIterations - 1;

    try {
      // Create streaming request
      const streamParams: Anthropic.MessageCreateParams = {
        model: CLAUDE_MODEL,
        max_tokens: config.claudeMaxTokens,
        system: systemPrompt,
        messages: currentMessages,
        ...(isFinalIteration ? {} : { tools }),
      };

      const stream = claudeClient.messages.stream(streamParams, {
        signal: abortSignal,
      });

      // Stream text deltas to the client
      stream.on('text', (text) => {
        callbacks.onTextDelta(text);
      });

      // Wait for the complete response
      const response = await stream.finalMessage();

      // Accumulate usage
      cumulativeInputTokens += response.usage?.input_tokens ?? 0;
      cumulativeOutputTokens += response.usage?.output_tokens ?? 0;

      // If no tool use, we're done
      if (response.stop_reason !== 'tool_use') {
        callbacks.onDone({
          inputTokens: cumulativeInputTokens,
          outputTokens: cumulativeOutputTokens,
        });
        return null;
      }

      // Extract tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ContentBlockParam & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          block.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) {
        // No tool use blocks despite stop_reason -- treat as done
        callbacks.onDone({
          inputTokens: cumulativeInputTokens,
          outputTokens: cumulativeOutputTokens,
        });
        return null;
      }

      // Process tool_use blocks sequentially
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        const tier = getToolTier(block.name);
        const tierStr = tier as string;

        // BLACK tier -- blocked unless override active
        if (tier === ActionTier.BLACK && !overrideActive) {
          const reason = `Tool "${block.name}" is classified as BLACK tier and is always blocked. The operator can use the override passkey to elevate.`;
          callbacks.onBlocked(block.name, reason, tierStr);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ blocked: true, tool: block.name, tier: tierStr, reason }),
            is_error: true,
          });
          continue;
        }

        // RED tier -- needs confirmation unless override active
        if (tier === ActionTier.RED && !overrideActive) {
          callbacks.onConfirmationNeeded(
            block.name,
            block.input as Record<string, unknown>,
            block.id,
            tierStr,
          );

          // Return PendingConfirmation so the caller can resume after approval
          return {
            toolName: block.name,
            toolInput: block.input as Record<string, unknown>,
            toolUseId: block.id,
            assistantContent: response.content,
            priorMessages: [...currentMessages],
          };
        }

        // Auto-execute (GREEN/YELLOW, or elevated RED/BLACK with override)
        // Await onToolUse to allow acknowledgment audio to be sent first
        await callbacks.onToolUse(block.name, block.input as Record<string, unknown>, block.id, tierStr);

        try {
          const toolResult = await executeToolWithTimeout(
            block.name,
            block.input as Record<string, unknown>,
            'llm',
            overrideActive,
          );

          const resultText = toolResult.content
            ?.map((c) => c.text)
            .join('\n') ?? 'No output';
          const isError = toolResult.isError ?? false;

          callbacks.onToolResult(block.id, resultText, isError);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultText,
            is_error: isError,
          });
        } catch (err) {
          const errorText = `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
          callbacks.onToolResult(block.id, errorText, true);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: errorText,
            is_error: true,
          });
        }
      }

      // Append assistant message + tool results to continue the loop
      currentMessages.push({
        role: 'assistant',
        content: response.content,
      });

      currentMessages.push({
        role: 'user',
        content: toolResults,
      });
    } catch (err) {
      // Handle streaming/API errors
      if (abortSignal?.aborted) {
        callbacks.onError(new Error('Request aborted'));
      } else {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      }
      return null;
    }
  }

  // Max iterations reached -- force a final text response without tools
  // This was the isFinalIteration case above, so if we get here
  // it means the final iteration also produced tool_use (shouldn't happen
  // since we omit tools). Signal done with accumulated usage.
  callbacks.onDone({
    inputTokens: cumulativeInputTokens,
    outputTokens: cumulativeOutputTokens,
  });
  return null;
}

// ---------------------------------------------------------------------------
// Confirmation resumption
// ---------------------------------------------------------------------------

/**
 * Resume the agentic loop after user confirms or denies a RED-tier action.
 *
 * Reconstructs the conversation state from the PendingConfirmation, executes
 * (or rejects) the tool, and re-enters the agentic loop.
 */
export async function resumeAfterConfirmation(
  pending: PendingConfirmation,
  confirmed: boolean,
  systemPrompt: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<PendingConfirmation | null> {
  let resultText: string;
  let isError: boolean;

  if (confirmed) {
    try {
      const toolResult = await executeTool(
        pending.toolName,
        { ...pending.toolInput, confirmed: true },
        'llm',
      );

      resultText = toolResult.content
        ?.map((c) => c.text)
        .join('\n') ?? 'Action completed';
      isError = toolResult.isError ?? false;
    } catch (err) {
      resultText = `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
      isError = true;
    }
  } else {
    resultText = 'User declined this action. Acknowledge the decision and do not retry.';
    isError = false;
  }

  callbacks.onToolResult(pending.toolUseId, resultText, isError);

  // Reconstruct messages: prior messages + assistant content + tool result
  const reconstructedMessages: Anthropic.MessageParam[] = [
    ...pending.priorMessages,
    {
      role: 'assistant',
      content: pending.assistantContent,
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: pending.toolUseId,
          content: resultText,
          is_error: isError,
        },
      ],
    },
  ];

  // Continue the agentic loop with the reconstructed state
  return runAgenticLoop(reconstructedMessages, systemPrompt, callbacks, abortSignal);
}

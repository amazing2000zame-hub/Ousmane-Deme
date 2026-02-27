/**
 * OpenAI provider with text-based tool calling.
 *
 * The Claude Max proxy (claude-max-api-proxy) is text-only — it ignores
 * OpenAI function calling parameters. Instead, we instruct the LLM to
 * emit <tool_call> XML tags in its text output, parse them server-side,
 * execute the tools, and feed results back for the next iteration.
 */

import OpenAI from 'openai';
import crypto from 'node:crypto';
import type { LLMProvider } from '../providers.js';
import type { PendingConfirmation, StreamCallbacks } from '../loop.js';
import { getClaudeTools } from '../tools.js';
import { executeTool } from '../../mcp/server.js';
import { getToolTier, ActionTier } from '../../safety/tiers.js';
import { config } from '../../config.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'not-needed',
  baseURL: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
});

export const openaiAvailable = true;

const TOOL_TIMEOUT_MS = 60_000;

// Regex to match <tool_call>...</tool_call> blocks
const TOOL_CALL_REGEX = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;

/**
 * Build tool calling instructions to append to the system prompt.
 * Lists all available tools with their parameters in a compact format
 * and defines the XML protocol for invoking them.
 */
function buildToolCallingInstructions(): string {
  const tools = getClaudeTools();
  const toolList = tools.map(t => {
    const params = (t.input_schema as { properties?: Record<string, { type: string; description?: string; enum?: string[] }>; required?: string[] });
    const props = params.properties || {};
    const required = new Set(params.required || []);
    const paramLines = Object.entries(props).map(([name, schema]) => {
      const req = required.has(name) ? ' (required)' : '';
      const enumVals = schema.enum ? ` [${schema.enum.join('|')}]` : '';
      return `    - ${name}: ${schema.type}${enumVals}${req}${schema.description ? ' — ' + schema.description : ''}`;
    }).join('\n');
    return `  ${t.name}: ${t.description}${paramLines ? '\n' + paramLines : ''}`;
  }).join('\n\n');

  return `

## Tool Calling Protocol
You have access to tools. To use a tool, output a <tool_call> XML block with a JSON object containing "name" and "arguments":

<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>

Rules:
- You may call multiple tools in one response — use one <tool_call> block per tool.
- After you output tool calls, the system will execute them and provide results in the next message. Then continue your response.
- Do NOT describe what tool you are about to use — just call it. Do NOT say "Let me check..." and then NOT call the tool.
- If a task requires a tool, ALWAYS call it. Never simulate or fabricate tool results.
- Output any text BEFORE your tool calls, not after. Text after tool calls will be discarded.

Available tools:
${toolList}`;
}

interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Parse <tool_call> blocks from LLM text output.
 */
function parseToolCalls(text: string): { cleanText: string; toolCalls: ParsedToolCall[] } {
  const toolCalls: ParsedToolCall[] = [];
  let cleanText = text;

  // Find all tool call blocks
  let match: RegExpExecArray | null;
  const regex = new RegExp(TOOL_CALL_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.name && typeof parsed.name === 'string') {
        toolCalls.push({
          id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
          name: parsed.name,
          arguments: parsed.arguments || {},
        });
      }
    } catch {
      // Skip malformed JSON
      console.warn('[OpenAI Provider] Failed to parse tool call JSON:', match[1].substring(0, 100));
    }
  }

  // Remove tool call blocks from the text shown to the user
  if (toolCalls.length > 0) {
    cleanText = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  }

  return { cleanText, toolCalls };
}

/**
 * Execute a tool with timeout protection.
 */
async function executeToolWithTimeout(
  name: string,
  args: Record<string, unknown>,
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
      reject(new Error(`Tool "${name}" timed out after ${TOOL_TIMEOUT_MS / 1000} seconds.`));
    }, TOOL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      executeTool(name, args, 'llm', overrideActive, false),
      timeoutPromise,
    ]);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Tool "${name}" failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

export const openaiProvider: LLMProvider = {
  name: 'openai',

  capabilities: {
    tools: true,
    streaming: true,
    contextWindow: 128_000,
  },

  async chat(
    messages: Array<{ role: string; content: string }>,
    systemPrompt: string,
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal,
    overrideActive: boolean = false,
  ): Promise<PendingConfirmation | null> {
    if (!openaiAvailable) {
      callbacks.onError(new Error('OpenAI API key not configured'));
      return null;
    }

    const maxIterations = config.chatMaxLoopIterations || 10;

    // Append tool calling protocol to the system prompt
    const fullSystemPrompt = systemPrompt + buildToolCallingInstructions();

    // Build message history
    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      ...messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
    ];

    let cumulativeInputTokens = 0;
    let cumulativeOutputTokens = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (abortSignal?.aborted) {
        callbacks.onError(new Error('Request aborted'));
        return null;
      }

      try {
        // No OpenAI function calling — proxy doesn't support it.
        // Tool calls come via text-based <tool_call> protocol.
        const response = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'claude-sonnet-4',
          messages: chatMessages,
          max_tokens: 4096,
          stream: true,
        }, { signal: abortSignal });

        let fullContent = '';

        for await (const chunk of response) {
          if (abortSignal?.aborted) {
            callbacks.onError(new Error('Request aborted'));
            return null;
          }

          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) {
            fullContent += delta.content;
            // Don't emit tool_call XML to the client — buffer and filter later
          }

          // Track usage
          if (chunk.usage) {
            cumulativeInputTokens += chunk.usage.prompt_tokens || 0;
            cumulativeOutputTokens += chunk.usage.completion_tokens || 0;
          }
        }

        // Parse tool calls from the accumulated text
        const { cleanText, toolCalls } = parseToolCalls(fullContent);

        // Only emit text to the client if there are no tool calls (final iteration).
        // Intermediate text before tool calls (e.g. "Let me check...") is discarded
        // to avoid duplicate output when the model repeats itself after tool results.
        if (toolCalls.length === 0) {
          if (cleanText) {
            callbacks.onTextDelta(cleanText);
          }
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          callbacks.onDone({
            inputTokens: cumulativeInputTokens,
            outputTokens: cumulativeOutputTokens,
          });
          return null;
        }

        // Add assistant response to history
        chatMessages.push({
          role: 'assistant',
          content: fullContent,
        });

        // Execute each tool call
        const toolResults: string[] = [];
        for (const toolCall of toolCalls) {
          const tier = getToolTier(toolCall.name);
          const tierStr = tier as string;

          // Notify about tool use
          await callbacks.onToolUse(toolCall.name, toolCall.arguments, toolCall.id, tierStr);

          // Check tier restrictions
          if (tier === ActionTier.BLACK && !overrideActive) {
            const reason = `Tool "${toolCall.name}" is BLACK tier and blocked.`;
            callbacks.onBlocked(toolCall.name, reason, tierStr);
            toolResults.push(`[${toolCall.name}] Error: ${reason}`);
            continue;
          }

          if (tier === ActionTier.RED && !overrideActive) {
            if (callbacks.onConfirmationNeeded) {
              callbacks.onConfirmationNeeded(toolCall.name, toolCall.arguments, toolCall.id, tierStr);
            }
            toolResults.push(`[${toolCall.name}] This action requires user confirmation (RED tier). The user has been prompted.`);
            // For now, don't block the loop — inform the LLM and let it respond
            continue;
          }

          // Execute the tool
          const result = await executeToolWithTimeout(toolCall.name, toolCall.arguments, overrideActive);
          const resultText = result.content.map(c => c.text).join('\n');

          callbacks.onToolResult(toolCall.id, resultText, result.isError || false);
          toolResults.push(`[${toolCall.name}] ${resultText}`);
        }

        // Add tool results as a user message (since proxy only supports user/assistant/system)
        chatMessages.push({
          role: 'user',
          content: `<tool_results>\n${toolResults.join('\n\n')}\n</tool_results>\n\nNow respond to the user based on the tool results above. Do not call tools again unless needed.`,
        });

      } catch (err) {
        if (abortSignal?.aborted) {
          callbacks.onError(new Error('Request aborted'));
        } else {
          callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
        return null;
      }
    }

    // Max iterations reached
    callbacks.onDone({
      inputTokens: cumulativeInputTokens,
      outputTokens: cumulativeOutputTokens,
    });
    return null;
  },
};

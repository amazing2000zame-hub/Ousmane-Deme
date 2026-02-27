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

export const openaiAvailable = !!process.env.OPENAI_API_BASE;

const TOOL_TIMEOUT_MS = 60_000;

// Regex to extract content between <tool_call> tags (greedy — grab everything)
const TOOL_CALL_BLOCK_REGEX = /<tool_call>([\s\S]*?)<\/tool_call>/g;

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

  return `## CRITICAL: Tool Calling Protocol

You MUST use tools to answer questions about the cluster, nodes, storage, VMs, etc. DO NOT answer from the cluster_context in the system prompt — that context is for background awareness only. For ANY question requiring live data, call the appropriate tool.

To call a tool, output a <tool_call> XML block:
<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>

Rules:
- Output <tool_call> blocks to invoke tools. This is the ONLY way to call tools.
- You may call multiple tools — use one <tool_call> block per tool.
- After tool calls, the system executes them and returns results. Then respond with the answer.
- Do NOT describe what tool you will use — just call it immediately.
- NEVER say "I don't have access to tools" or "tools aren't available" — you DO have tools. Use them.
- NEVER fabricate or simulate tool results. Always call the actual tool.
- Text AFTER <tool_call> blocks is discarded. Put any text BEFORE the tool calls.

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

  // Find all tool call blocks and extract JSON from each
  let match: RegExpExecArray | null;
  const regex = new RegExp(TOOL_CALL_BLOCK_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const blockContent = match[1].trim();
    // Find the JSON object: first '{' to last '}'
    const firstBrace = blockContent.indexOf('{');
    const lastBrace = blockContent.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      console.warn('[OpenAI Provider] No JSON found in tool_call block:', blockContent.substring(0, 100));
      continue;
    }
    const jsonStr = blockContent.substring(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.name && typeof parsed.name === 'string') {
        toolCalls.push({
          id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
          name: parsed.name,
          arguments: parsed.arguments || {},
        });
      }
    } catch {
      console.warn('[OpenAI Provider] Failed to parse tool call JSON:', jsonStr.substring(0, 100));
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

    // Put tool calling protocol BEFORE the personality/context to ensure model sees it first
    const toolInstructions = buildToolCallingInstructions();
    const fullSystemPrompt = toolInstructions + '\n\n' + systemPrompt;

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

          // Only block truly unknown tools (BLACK = fail-safe for unregistered tools)
          if (tier === ActionTier.BLACK && !overrideActive) {
            const reason = `Tool "${toolCall.name}" is unregistered and blocked.`;
            callbacks.onBlocked(toolCall.name, reason, tierStr);
            toolResults.push(`[${toolCall.name}] Error: ${reason}`);
            continue;
          }

          // Execute the tool (all registered tools auto-execute)
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

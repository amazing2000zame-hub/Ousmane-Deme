/**
 * MCP server instance with all 33 tools registered.
 *
 * Provides executeTool() as the single entry point for all cluster operations.
 * The pipeline: sanitize -> checkSafety -> execute handler -> log to memory store.
 *
 * Uses the MCP SDK McpServer for tool registration (schema validation via Zod),
 * but calls handlers directly via executeTool() for in-process execution.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { checkSafety, type SafetyResult, type ActionTier } from '../safety/tiers.js';
import { sanitizeInput } from '../safety/sanitize.js';
import { setOverrideContext } from '../safety/context.js';
import { memoryStore } from '../db/memory.js';
import { registerClusterTools } from './tools/cluster.js';
import { registerLifecycleTools } from './tools/lifecycle.js';
import { registerSystemTools } from './tools/system.js';
import { registerFileTools } from './tools/files.js';
import { registerTransferTools } from './tools/transfer.js';
import { registerProjectTools } from './tools/projects.js';
import { registerVoiceTools } from './tools/voice.js';
import { registerSmartHomeTools } from './tools/smarthome.js';
import { registerWebTools } from './tools/web.js';
import { registerOpenClawTools } from './tools/openclaw.js';
import { registerDisplayTools } from './tools/display.js';
import { registerTelegramTools } from './tools/telegram.js';
import { registerReminderTools } from './tools/reminders.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format milliseconds as human-readable duration */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolSource = 'llm' | 'monitor' | 'user' | 'api';

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  blocked?: boolean;
  reason?: string;
  tier?: ActionTier;
}

/** Internal tool handler function signature */
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// ---------------------------------------------------------------------------
// Tool registry (populated during registration)
// ---------------------------------------------------------------------------

const toolHandlers = new Map<string, ToolHandler>();

// ---------------------------------------------------------------------------
// MCP server instance
// ---------------------------------------------------------------------------

export const mcpServer = new McpServer({
  name: 'jarvis-mcp',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

// ---------------------------------------------------------------------------
// Registration: intercept tool registrations to capture handlers
// ---------------------------------------------------------------------------

// Monkey-patch the tool() method to capture handler references.
// The MCP SDK registers tools internally; we also need direct access
// to handlers for in-process execution via executeTool().
const originalTool = mcpServer.tool.bind(mcpServer);

// Override with a function that captures handler references
mcpServer.tool = function (...fnArgs: unknown[]): unknown {
  // MCP SDK tool() has many overloads. The handler is always the last argument.
  // The name is always the first argument.
  const name = fnArgs[0] as string;
  const handler = fnArgs[fnArgs.length - 1] as Function;

  // Store a wrapper that calls the handler with the expected signature
  toolHandlers.set(name, async (args: Record<string, unknown>) => {
    try {
      const result = await handler(args, {} as any);
      return result as ToolResult;
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Unhandled error in tool "${name}": ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  });

  // Call the original method for SDK registration
  return (originalTool as Function)(...fnArgs);
} as typeof mcpServer.tool;

// ---------------------------------------------------------------------------
// Register all tools
// ---------------------------------------------------------------------------

registerClusterTools(mcpServer);
registerLifecycleTools(mcpServer);
registerSystemTools(mcpServer);
registerFileTools(mcpServer);
registerTransferTools(mcpServer);
registerProjectTools(mcpServer);
registerVoiceTools(mcpServer);
registerSmartHomeTools(mcpServer);
registerWebTools(mcpServer);
registerOpenClawTools(mcpServer);
registerDisplayTools(mcpServer);
registerTelegramTools(mcpServer);
registerReminderTools(mcpServer);

// ---------------------------------------------------------------------------
// executeTool -- the single entry point for all tool invocations
// ---------------------------------------------------------------------------

/**
 * Execute a tool by name with safety checks, logging, and error handling.
 *
 * Pipeline:
 *  1. Look up handler (fail if unknown tool)
 *  2. Sanitize string arguments
 *  3. Run checkSafety() -- block if not allowed
 *  4. Execute handler
 *  5. Log execution to memory store
 *  6. Return result
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  source: ToolSource = 'api',
  overrideActive: boolean = false,
  keywordApproved: boolean = false,
): Promise<ToolResult> {
  const startTime = Date.now();

  // Step 1: Look up handler
  const handler = toolHandlers.get(name);
  if (!handler) {
    const available = Array.from(toolHandlers.keys()).join(', ');
    return {
      content: [{
        type: 'text',
        text: `Unknown tool "${name}". Available tools: ${available}`,
      }],
      isError: true,
      blocked: true,
      reason: `Tool "${name}" not found`,
    };
  }

  // Step 2: Sanitize string arguments
  const sanitizedArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      sanitizedArgs[key] = sanitizeInput(value);
    } else {
      sanitizedArgs[key] = value;
    }
  }

  // Step 3: Safety check
  const confirmed = Boolean(sanitizedArgs.confirmed);
  const safety: SafetyResult = checkSafety(name, sanitizedArgs, confirmed, overrideActive, keywordApproved);

  if (!safety.allowed) {
    const blockedResult: ToolResult = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          blocked: true,
          tool: name,
          tier: safety.tier,
          reason: safety.reason,
        }, null, 2),
      }],
      isError: true,
      blocked: true,
      reason: safety.reason,
      tier: safety.tier,
    };

    // Log blocked attempt
    try {
      memoryStore.saveEvent({
        type: 'action',
        severity: 'warning',
        source: source === 'llm' ? 'jarvis' : source === 'monitor' ? 'system' : 'user',
        summary: `BLOCKED: ${name} (${safety.tier}) -- ${safety.reason}`,
        details: JSON.stringify({ tool: name, args: sanitizedArgs, safety }),
      });
    } catch {
      // Never crash on logging failure
    }

    return blockedResult;
  }

  // Step 4: Execute handler (set override context for handlers that check it)
  setOverrideContext(overrideActive);
  let result: ToolResult;
  try {
    result = await handler(sanitizedArgs);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[MCP] Tool execution error: ${name} - ${errorMsg}`);
    result = {
      content: [{
        type: 'text',
        text: `Tool "${name}" execution failed: ${errorMsg}`,
      }],
      isError: true,
    };
  } finally {
    setOverrideContext(false);
  }

  // Step 5: Log execution to memory store
  const durationMs = Date.now() - startTime;
  try {
    memoryStore.saveEvent({
      type: 'action',
      severity: result.isError ? 'error' : 'info',
      source: source === 'llm' ? 'jarvis' : source === 'monitor' ? 'system' : 'user',
      summary: `${result.isError ? 'FAILED' : 'OK'}: ${name} (${safety.tier}) [${formatDuration(durationMs)}]`,
      details: JSON.stringify({
        tool: name,
        args: sanitizedArgs,
        tier: safety.tier,
        source,
        durationMs,
        isError: result.isError ?? false,
      }),
    });
  } catch {
    // Never crash on logging failure
  }

  // Warn about slow tools (over 10 seconds)
  if (durationMs > 10_000) {
    console.warn(`[MCP] Slow tool execution: ${name} took ${formatDuration(durationMs)}`);
  }

  // Step 6: Return result with tier info
  result.tier = safety.tier;
  return result;
}

// ---------------------------------------------------------------------------
// getToolList -- list all registered tools with their tiers
// ---------------------------------------------------------------------------

import { getToolTier } from '../safety/tiers.js';

export interface ToolInfo {
  name: string;
  tier: string;
}

/**
 * Get a list of all registered tools with their safety tiers.
 */
export function getToolList(): ToolInfo[] {
  return Array.from(toolHandlers.keys()).map(name => ({
    name,
    tier: getToolTier(name),
  }));
}

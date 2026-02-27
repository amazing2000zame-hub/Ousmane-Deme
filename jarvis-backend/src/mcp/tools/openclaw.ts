/**
 * OpenClaw integration tool -- delegates complex tasks to OpenClaw (Claude Sonnet 4.5)
 * running on agent1. This gives Jarvis the ability to execute arbitrary server
 * operations without needing individual tools for each action.
 *
 * OpenClaw has full shell access, file read/write, and process management
 * capabilities on agent1, with SSH access to all cluster nodes.
 *
 * YELLOW tier: auto-execute with logging.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execOnNodeByName } from '../../clients/ssh.js';

/** Timeout for OpenClaw agent invocations (ms) */
const OPENCLAW_TIMEOUT_MS = 120_000;

/**
 * Register the OpenClaw delegation tool on the MCP server.
 */
export function registerOpenClawTools(server: McpServer): void {
  server.tool(
    'delegate_to_openclaw',
    'Delegate a complex task to OpenClaw, an AI agent (Claude Sonnet 4.5) with full shell access on agent1. Use this when you need to perform server operations, fix issues, install software, edit configs, debug problems, or any task requiring command execution that goes beyond your built-in tools. OpenClaw can SSH to all cluster nodes, read/write files, run commands, and solve problems autonomously. Describe the task clearly and OpenClaw will execute it and report back.',
    {
      task: z.string().describe('Clear description of what needs to be done. Be specific about which nodes, files, services, or issues are involved.'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 120, max: 300)'),
    },
    async ({ task, timeout }) => {
      try {
        const timeoutSec = Math.min(timeout ?? 120, 300);

        console.log(`[OpenClaw] Delegating task: ${task.substring(0, 100)}...`);

        // Escape single quotes in the task for shell safety
        const escapedTask = task.replace(/'/g, "'\\''");

        const command = `openclaw agent --message '${escapedTask}' --agent jarvis --json --timeout ${timeoutSec} 2>&1`;

        const result = await execOnNodeByName('agent1', command, OPENCLAW_TIMEOUT_MS);

        if (result.code !== 0) {
          console.error(`[OpenClaw] Non-zero exit code: ${result.code}`);
          return {
            content: [{
              type: 'text',
              text: `OpenClaw execution failed (exit code ${result.code}):\n${result.stderr || result.stdout}`,
            }],
            isError: true,
          };
        }

        // Parse JSON response from OpenClaw
        try {
          const response = JSON.parse(result.stdout);

          if (response.status !== 'ok') {
            return {
              content: [{
                type: 'text',
                text: `OpenClaw returned status "${response.status}": ${response.summary || 'Unknown error'}`,
              }],
              isError: true,
            };
          }

          // Extract the text response(s) from OpenClaw
          const payloads = response.result?.payloads ?? [];
          const texts = payloads
            .map((p: { text?: string }) => p.text)
            .filter(Boolean);

          const responseText = texts.join('\n\n') || 'OpenClaw completed the task but returned no output.';

          // Include usage stats for logging
          const usage = response.result?.meta?.agentMeta?.usage;
          const durationMs = response.result?.meta?.durationMs;
          const statsLine = usage
            ? `\n\n[OpenClaw stats: ${(durationMs / 1000).toFixed(1)}s, ${usage.input + usage.output} tokens]`
            : '';

          console.log(`[OpenClaw] Task completed in ${durationMs}ms`);

          return {
            content: [{
              type: 'text',
              text: responseText + statsLine,
            }],
          };
        } catch {
          // If stdout isn't valid JSON, return raw output
          return {
            content: [{
              type: 'text',
              text: `OpenClaw response:\n${result.stdout}`,
            }],
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[OpenClaw] Error: ${message}`);
        return {
          content: [{
            type: 'text',
            text: `Failed to reach OpenClaw on agent1: ${message}`,
          }],
          isError: true,
        };
      }
    },
  );
}

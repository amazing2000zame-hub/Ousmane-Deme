/**
 * 3 system command tools -- SSH execution, service management, Wake-on-LAN.
 *
 * execute_ssh and restart_service are YELLOW tier (auto-execute + log).
 * wake_node is YELLOW tier.
 *
 * Command sanitization (allowlist/blocklist) is enforced in execute_ssh.
 * Protected resource checks happen in the executeTool() pipeline before
 * these handlers are called.
 *
 * Every handler is wrapped in try/catch and returns MCP content format.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execOnNodeByName } from '../../clients/ssh.js';
import { sanitizeCommand, sanitizeNodeName, sanitizeInput } from '../../safety/sanitize.js';
import { isOverrideActive } from '../../safety/context.js';

/** WOL API base URL on the management VM */
const WOL_API_BASE = 'http://192.168.1.65:3005';

/** Timeout for WOL API requests */
const WOL_TIMEOUT_MS = 10_000;

/**
 * Register all 3 system tools on the MCP server.
 */
export function registerSystemTools(server: McpServer): void {

  // 1. execute_ssh -- run a command on a cluster node (allowlist enforced)
  server.tool(
    'execute_ssh',
    'Execute a shell command on a cluster node via SSH (command must be in allowlist)',
    {
      node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)'),
      command: z.string().describe('Shell command to execute (must be in allowlist)'),
      timeout: z.number().optional().describe('Command timeout in ms (default: 30000)'),
    },
    async ({ node, command, timeout }) => {
      try {
        // Validate node name
        const safeName = sanitizeNodeName(node);

        // Sanitize and validate command against allowlist/blocklist
        const sanitized = sanitizeInput(command);
        const commandCheck = sanitizeCommand(sanitized, isOverrideActive());

        if (!commandCheck.safe) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Command rejected by safety filter',
                reason: commandCheck.reason,
                command: sanitized.slice(0, 100),
              }, null, 2),
            }],
            isError: true,
          };
        }

        const result = await execOnNodeByName(safeName, sanitized, timeout);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              node: safeName,
              command: sanitized,
              exitCode: result.code,
              stdout: result.stdout,
              stderr: result.stderr,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 2. restart_service -- restart a systemd service and verify it's running
  server.tool(
    'restart_service',
    'Restart a systemd service on a cluster node and verify it is active (YELLOW tier)',
    {
      node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)'),
      service: z.string().describe('Service name (e.g., pvedaemon, pveproxy, corosync)'),
    },
    async ({ node, service }) => {
      try {
        const safeName = sanitizeNodeName(node);
        const safeService = sanitizeInput(service, 200).trim();

        // Validate service name format (no shell metacharacters)
        if (!/^[a-zA-Z0-9@._-]+$/.test(safeService)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'Invalid service name format', service: safeService }, null, 2),
            }],
            isError: true,
          };
        }

        // Restart the service
        const restartResult = await execOnNodeByName(
          safeName,
          `systemctl restart ${safeService}`,
          30_000,
        );

        // Check if service is now active
        const statusResult = await execOnNodeByName(
          safeName,
          `systemctl is-active ${safeService}`,
          10_000,
        );

        const isActive = statusResult.stdout.trim() === 'active';

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              node: safeName,
              service: safeService,
              action: 'restart',
              success: isActive,
              status: statusResult.stdout.trim(),
              restartStderr: restartResult.stderr || undefined,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 3. wake_node -- send Wake-on-LAN packet to bring a node online
  server.tool(
    'wake_node',
    'Send a Wake-on-LAN packet to power on a cluster node (YELLOW tier)',
    {
      node: z.string().describe('Node name to wake (e.g., pve, agent1, agent)'),
    },
    async ({ node }) => {
      try {
        const safeName = sanitizeNodeName(node);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WOL_TIMEOUT_MS);

        try {
          const res = await fetch(`${WOL_API_BASE}/wake/${encodeURIComponent(safeName.toLowerCase())}`, {
            method: 'GET',
            signal: controller.signal,
          });

          const text = await res.text();

          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text };
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                node: safeName,
                action: 'wake',
                httpStatus: res.status,
                response: data,
              }, null, 2),
            }],
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}

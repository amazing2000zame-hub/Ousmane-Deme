/**
 * 8 system command tools -- SSH execution, service management, Wake-on-LAN,
 * and dangerous ORANGE tier operations (delete, execute, install, reboot).
 *
 * YELLOW tier (auto-execute + log):
 *   - execute_ssh (allowlist enforced)
 *   - restart_service
 *   - wake_node
 *
 * ORANGE tier (requires keyword approval):
 *   - delete_file - delete files/directories
 *   - execute_command - run arbitrary shell commands (bypasses allowlist)
 *   - install_package - apt install packages
 *   - manage_service - systemctl operations
 *   - reboot_node - reboot a cluster node
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
    async (args) => {
      try {
        // Accept parameter name variations (model may send host/target instead of node)
        const node = (args as any).node || (args as any).host || (args as any).target || (args as any).hostname;
        const command = (args as any).command || (args as any).cmd;
        const timeout = (args as any).timeout;

        if (!node || !command) {
          return {
            content: [{ type: 'text' as const, text: `Error: missing required parameters. Got: ${JSON.stringify(args)}` }],
            isError: true,
          };
        }

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

  // ---------------------------------------------------------------------------
  // ORANGE tier tools (require keyword approval)
  // ---------------------------------------------------------------------------

  // 4. delete_file -- delete a file or directory on a cluster node
  server.tool(
    'delete_file',
    'Delete a file or directory on a cluster node (ORANGE tier - requires keyword approval)',
    {
      node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)'),
      path: z.string().describe('Absolute path to delete'),
      recursive: z.boolean().optional().describe('Use -r flag for directories (default: false)'),
    },
    async ({ node, path, recursive }) => {
      try {
        const safeName = sanitizeNodeName(node);
        const safePath = sanitizeInput(path, 500).trim();

        // Basic path validation
        if (!safePath.startsWith('/')) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'Path must be absolute (start with /)' }, null, 2),
            }],
            isError: true,
          };
        }

        // Block obviously dangerous paths
        const dangerousPaths = ['/', '/etc', '/var', '/usr', '/bin', '/sbin', '/lib', '/boot', '/root'];
        if (dangerousPaths.includes(safePath)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'Cannot delete protected system path', path: safePath }, null, 2),
            }],
            isError: true,
          };
        }

        const rmFlag = recursive ? '-rf' : '-f';
        const result = await execOnNodeByName(safeName, `rm ${rmFlag} "${safePath}"`, 30_000);

        // Verify deletion
        const checkResult = await execOnNodeByName(safeName, `test -e "${safePath}" && echo exists || echo deleted`, 5_000);
        const deleted = checkResult.stdout.trim() === 'deleted';

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              node: safeName,
              path: safePath,
              recursive: !!recursive,
              deleted,
              stderr: result.stderr || undefined,
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

  // 5. execute_command -- run arbitrary command (bypasses allowlist)
  server.tool(
    'execute_command',
    'Execute any shell command on a cluster node (ORANGE tier - bypasses allowlist, requires keyword approval)',
    {
      node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)'),
      command: z.string().describe('Shell command to execute'),
      timeout: z.number().optional().describe('Command timeout in ms (default: 60000)'),
    },
    async ({ node, command, timeout }) => {
      try {
        const safeName = sanitizeNodeName(node);
        const safeCommand = sanitizeInput(command);

        // Execute directly without allowlist check
        const result = await execOnNodeByName(safeName, safeCommand, timeout ?? 60_000);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              node: safeName,
              command: safeCommand,
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

  // 6. install_package -- install apt packages
  server.tool(
    'install_package',
    'Install apt packages on a cluster node (ORANGE tier - requires keyword approval)',
    {
      node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)'),
      packages: z.array(z.string()).describe('Package names to install'),
    },
    async ({ node, packages }) => {
      try {
        const safeName = sanitizeNodeName(node);

        // Validate package names (alphanumeric, dash, underscore, plus, dot, colon)
        const safePackages = packages.map((pkg) => {
          const safePkg = sanitizeInput(pkg, 100).trim();
          if (!/^[a-zA-Z0-9][a-zA-Z0-9.+:_-]*$/.test(safePkg)) {
            throw new Error(`Invalid package name: ${safePkg}`);
          }
          return safePkg;
        });

        const pkgList = safePackages.join(' ');
        const result = await execOnNodeByName(
          safeName,
          `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkgList}`,
          300_000, // 5 minute timeout for package installation
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              node: safeName,
              packages: safePackages,
              exitCode: result.code,
              success: result.code === 0,
              stdout: result.stdout.slice(-2000), // Last 2KB of output
              stderr: result.stderr || undefined,
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

  // 7. manage_service -- systemctl operations
  server.tool(
    'manage_service',
    'Manage systemd services (start/stop/restart/enable/disable) on a cluster node (ORANGE tier - requires keyword approval)',
    {
      node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)'),
      service: z.string().describe('Service name'),
      action: z.enum(['start', 'stop', 'restart', 'enable', 'disable', 'status']).describe('Action to perform'),
    },
    async ({ node, service, action }) => {
      try {
        const safeName = sanitizeNodeName(node);
        const safeService = sanitizeInput(service, 200).trim();

        // Validate service name format
        if (!/^[a-zA-Z0-9@._-]+$/.test(safeService)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ error: 'Invalid service name format', service: safeService }, null, 2),
            }],
            isError: true,
          };
        }

        const result = await execOnNodeByName(safeName, `systemctl ${action} ${safeService}`, 60_000);

        // Get current status
        const statusResult = await execOnNodeByName(safeName, `systemctl is-active ${safeService}`, 10_000);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              node: safeName,
              service: safeService,
              action,
              exitCode: result.code,
              currentStatus: statusResult.stdout.trim(),
              stdout: result.stdout || undefined,
              stderr: result.stderr || undefined,
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

  // 8. reboot_node -- reboot a cluster node
  server.tool(
    'reboot_node',
    'Reboot a cluster node (ORANGE tier - requires keyword approval). Use with extreme caution!',
    {
      node: z.string().describe('Node name to reboot (e.g., pve, agent1, agent)'),
      delay: z.number().optional().describe('Delay in seconds before reboot (default: 0)'),
    },
    async ({ node, delay }) => {
      try {
        const safeName = sanitizeNodeName(node);
        const delaySeconds = Math.max(0, Math.min(300, delay ?? 0)); // Cap at 5 minutes

        // Warn about Home node (cluster master)
        if (safeName.toLowerCase() === 'home') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                warning: 'Rebooting Home node (cluster master) will temporarily break cluster quorum',
                node: safeName,
                status: 'confirmation_needed',
              }, null, 2),
            }],
          };
        }

        const rebootCommand = delaySeconds > 0
          ? `shutdown -r +${Math.ceil(delaySeconds / 60)} "Scheduled reboot by JARVIS"`
          : 'reboot';

        // Execute reboot (this will likely disconnect SSH)
        const result = await execOnNodeByName(safeName, rebootCommand, 10_000).catch(() => ({
          code: 0,
          stdout: 'Reboot command sent (connection closed as expected)',
          stderr: '',
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              node: safeName,
              action: 'reboot',
              delay: delaySeconds,
              status: 'initiated',
              message: result.stdout || 'Reboot command sent',
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
}

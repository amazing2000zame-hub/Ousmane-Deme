/**
 * 6 VM/CT lifecycle management tools.
 *
 * All tools are RED tier (require confirmed=true for execution).
 * Safety enforcement happens in the executeTool() pipeline -- these handlers
 * assume they are only called after safety checks pass.
 *
 * Every handler is wrapped in try/catch and returns MCP content format.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClientForNode } from '../../clients/proxmox.js';

/**
 * Register all 6 VM/CT lifecycle tools on the MCP server.
 */
export function registerLifecycleTools(server: McpServer): void {

  // ---------------------------------------------------------------------- VMs

  // 1. start_vm
  server.tool(
    'start_vm',
    'Start a QEMU virtual machine (RED tier -- requires confirmation)',
    {
      node: z.string().describe('Node name where the VM resides (e.g., Home, pve)'),
      vmid: z.number().describe('VM ID (e.g., 100)'),
      confirmed: z.boolean().optional().describe('Must be true to execute (safety confirmation)'),
    },
    async ({ node, vmid }) => {
      try {
        const client = getClientForNode(node);
        const upid = await client.startVM(node.toLowerCase(), vmid);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action: 'start_vm', node, vmid, upid }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error starting VM ${vmid}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 2. stop_vm
  server.tool(
    'stop_vm',
    'Stop a QEMU virtual machine (RED tier -- requires confirmation)',
    {
      node: z.string().describe('Node name where the VM resides'),
      vmid: z.number().describe('VM ID'),
      confirmed: z.boolean().optional().describe('Must be true to execute (safety confirmation)'),
    },
    async ({ node, vmid }) => {
      try {
        const client = getClientForNode(node);
        const upid = await client.stopVM(node.toLowerCase(), vmid);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action: 'stop_vm', node, vmid, upid }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error stopping VM ${vmid}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 3. restart_vm
  server.tool(
    'restart_vm',
    'Restart (reboot) a QEMU virtual machine via ACPI (RED tier -- requires confirmation)',
    {
      node: z.string().describe('Node name where the VM resides'),
      vmid: z.number().describe('VM ID'),
      confirmed: z.boolean().optional().describe('Must be true to execute (safety confirmation)'),
    },
    async ({ node, vmid }) => {
      try {
        const client = getClientForNode(node);
        const upid = await client.rebootVM(node.toLowerCase(), vmid);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action: 'restart_vm', node, vmid, upid }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error restarting VM ${vmid}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ----------------------------------------------------------------- Containers

  // 4. start_container
  server.tool(
    'start_container',
    'Start an LXC container (RED tier -- requires confirmation)',
    {
      node: z.string().describe('Node name where the container resides'),
      vmid: z.number().describe('Container ID (e.g., 300)'),
      confirmed: z.boolean().optional().describe('Must be true to execute (safety confirmation)'),
    },
    async ({ node, vmid }) => {
      try {
        const client = getClientForNode(node);
        const upid = await client.startCT(node.toLowerCase(), vmid);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action: 'start_container', node, vmid, upid }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error starting container ${vmid}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 5. stop_container
  server.tool(
    'stop_container',
    'Stop an LXC container (RED tier -- requires confirmation)',
    {
      node: z.string().describe('Node name where the container resides'),
      vmid: z.number().describe('Container ID'),
      confirmed: z.boolean().optional().describe('Must be true to execute (safety confirmation)'),
    },
    async ({ node, vmid }) => {
      try {
        const client = getClientForNode(node);
        const upid = await client.stopCT(node.toLowerCase(), vmid);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action: 'stop_container', node, vmid, upid }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error stopping container ${vmid}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 6. restart_container
  server.tool(
    'restart_container',
    'Restart an LXC container (RED tier -- requires confirmation)',
    {
      node: z.string().describe('Node name where the container resides'),
      vmid: z.number().describe('Container ID'),
      confirmed: z.boolean().optional().describe('Must be true to execute (safety confirmation)'),
    },
    async ({ node, vmid }) => {
      try {
        const client = getClientForNode(node);
        const upid = await client.rebootCT(node.toLowerCase(), vmid);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, action: 'restart_container', node, vmid, upid }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error restarting container ${vmid}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}

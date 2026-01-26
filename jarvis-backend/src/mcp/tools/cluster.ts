/**
 * 9 read-only cluster monitoring tools.
 *
 * All tools are GREEN tier (auto-execute, no confirmation needed).
 * Every handler is wrapped in try/catch and returns MCP content format.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAnyClient, getClientForNode, proxmoxClients } from '../../clients/proxmox.js';
import { execOnNodeByName } from '../../clients/ssh.js';
import { config } from '../../config.js';

/**
 * Register all 9 read-only cluster monitoring tools on the MCP server.
 */
export function registerClusterTools(server: McpServer): void {

  // 1. get_cluster_status -- cluster nodes + quorum info
  server.tool(
    'get_cluster_status',
    'Get cluster status including all nodes and quorum information',
    {},
    async () => {
      try {
        const client = getAnyClient();
        const status = await client.getClusterStatus();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 2. get_node_status -- detailed status for a specific node
  server.tool(
    'get_node_status',
    'Get detailed status for a specific cluster node (CPU, memory, uptime, etc.)',
    { node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)') },
    async ({ node }) => {
      try {
        const client = getClientForNode(node);
        const status = await client.getNodeStatus(node.toLowerCase());
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 3. get_vms -- list all QEMU VMs across the cluster
  server.tool(
    'get_vms',
    'List all QEMU virtual machines across the cluster',
    {},
    async () => {
      try {
        const client = getAnyClient();
        const resources = await client.getClusterResources('vm');
        // Filter to only QEMU VMs (exclude LXC containers)
        const vms = Array.isArray(resources)
          ? resources.filter((r: any) => r.type === 'qemu')
          : resources;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(vms, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 4. get_containers -- list all LXC containers across the cluster
  server.tool(
    'get_containers',
    'List all LXC containers across the cluster',
    {},
    async () => {
      try {
        const client = getAnyClient();
        const resources = await client.getClusterResources('vm');
        // Filter to only LXC containers
        const containers = Array.isArray(resources)
          ? resources.filter((r: any) => r.type === 'lxc')
          : resources;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(containers, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 5. get_storage -- list storage pools across the cluster
  server.tool(
    'get_storage',
    'List all storage pools and their status across the cluster',
    {},
    async () => {
      try {
        const client = getAnyClient();
        const storage = await client.getClusterResources('storage');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(storage, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 6. get_cluster_resources -- get resources filtered by optional type
  server.tool(
    'get_cluster_resources',
    'Get cluster resources, optionally filtered by type (vm, storage, node)',
    { type: z.string().optional().describe('Resource type filter: vm, storage, node (optional)') },
    async ({ type }) => {
      try {
        const client = getAnyClient();
        const resources = await client.getClusterResources(type);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(resources, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 7. get_node_temperature -- read thermal sensors via SSH
  server.tool(
    'get_node_temperature',
    'Get CPU/system temperature readings from a cluster node via SSH',
    { node: z.string().describe('Node name (e.g., Home, pve, agent1, agent)') },
    async ({ node }) => {
      try {
        // Use ; instead of && because some thermal zones may be unreadable
        // (exit code can be non-zero even when most zones return data)
        const result = await execOnNodeByName(
          node,
          'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null; echo "---"; cat /sys/class/thermal/thermal_zone*/type 2>/dev/null',
          10_000,
        );

        if (!result.stdout.trim()) {
          return {
            content: [{ type: 'text' as const, text: `No temperature data available on node ${node}` }],
            isError: true,
          };
        }

        // Parse temperature data
        const parts = result.stdout.split('---');
        const temps = (parts[0] ?? '').trim().split('\n').filter(Boolean);
        const types = (parts[1] ?? '').trim().split('\n').filter(Boolean);

        const readings = temps.map((temp, i) => ({
          zone: types[i] ?? `zone${i}`,
          tempC: (parseInt(temp, 10) / 1000).toFixed(1),
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ node, readings }, null, 2),
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

  // 8. get_recent_tasks -- recent tasks across the cluster
  server.tool(
    'get_recent_tasks',
    'Get recent tasks (backups, migrations, etc.) from the cluster',
    { limit: z.number().optional().describe('Maximum number of tasks to return (default: 50)') },
    async ({ limit }) => {
      try {
        const client = getAnyClient();
        const tasks = await client.getRecentTasks(limit ?? 50);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 9. get_backups -- list backup files on a storage
  server.tool(
    'get_backups',
    'List backup files on a specific storage pool for a node',
    {
      node: z.string().describe('Node name (e.g., Home, pve)'),
      storage: z.string().optional().describe('Storage pool name (default: local)'),
    },
    async ({ node, storage }) => {
      try {
        const storageName = storage ?? 'local';
        const client = getClientForNode(node);
        const nodeLower = node.toLowerCase();
        const content = await client.get<unknown[]>(
          `/nodes/${encodeURIComponent(nodeLower)}/storage/${encodeURIComponent(storageName)}/content?content=backup`,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(content, null, 2) }],
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

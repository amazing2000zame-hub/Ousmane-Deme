/**
 * LLM-optimized Claude tool definitions for all 23 MCP tools.
 *
 * These are hardcoded (not auto-converted from Zod schemas) to give Claude
 * the best possible descriptions for tool selection. Each description guides
 * when and why to use the tool.
 *
 * The `confirmed` parameter is NOT included -- the backend agentic loop
 * handles confirmation flow internally via the safety tier system.
 */

import type Anthropic from '@anthropic-ai/sdk';

export function getClaudeTools(): Anthropic.Tool[] {
  return [
    // -----------------------------------------------------------------------
    // GREEN tier -- read-only cluster monitoring
    // -----------------------------------------------------------------------
    {
      name: 'get_cluster_status',
      description:
        "Get the current status of all Proxmox cluster nodes including quorum, online/offline state, CPU, memory, and uptime. Use this when the user asks about cluster health, node status, or 'how is the cluster doing?'",
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_node_status',
      description:
        'Get detailed status for a specific cluster node. Use when the user asks about a particular node by name.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node name (e.g., "Home", "pve", "agent1", "agent")',
          },
        },
        required: ['node'],
      },
    },
    {
      name: 'get_vms',
      description:
        'List all QEMU virtual machines across the cluster with status and resource usage. Use when the user asks about VMs.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_containers',
      description:
        'List all LXC containers across the cluster. Use when the user asks about containers.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_storage',
      description:
        'List all storage pools and their usage. Use when the user asks about disk space or storage.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_cluster_resources',
      description:
        'Get cluster resources filtered by type (vm, storage, node). Use for general resource queries.',
      input_schema: {
        type: 'object' as const,
        properties: {
          type: {
            type: 'string',
            description: 'Resource type filter: "vm", "storage", or "node"',
            enum: ['vm', 'storage', 'node'],
          },
        },
        required: ['type'],
      },
    },
    {
      name: 'get_node_temperature',
      description:
        'Get CPU/system temperature for a node. Use when the user asks about heat, temperature, or thermal status.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node name (e.g., "Home", "pve", "agent1", "agent")',
          },
        },
        required: ['node'],
      },
    },
    {
      name: 'get_recent_tasks',
      description:
        'Get recent Proxmox tasks (backups, migrations, etc.). Use when the user asks about recent activity or background tasks.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Optional node name to filter tasks',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of tasks to return (default: 10)',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_backups',
      description:
        'List backup files on a storage pool. Use when the user asks about backups.',
      input_schema: {
        type: 'object' as const,
        properties: {
          storage: {
            type: 'string',
            description: 'Storage pool name (e.g., "local", "cluster-backup")',
          },
        },
        required: ['storage'],
      },
    },

    // -----------------------------------------------------------------------
    // GREEN tier -- read-only file operations
    // -----------------------------------------------------------------------
    {
      name: 'list_directory',
      description:
        'List the contents of a directory on any cluster node. Returns a tree-view with file sizes and directory item counts. Use when the user asks to see what files are in a directory, browse a folder, or explore a project structure. Supports all 4 cluster nodes (Home, pve, agent1, agent).',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Cluster node name: "Home", "pve", "agent1", or "agent"',
          },
          path: {
            type: 'string',
            description: 'Absolute directory path (e.g., "/opt/jarvis-backend/src")',
          },
          showHidden: {
            type: 'boolean',
            description: 'Show dotfiles (default: true)',
          },
          maxItems: {
            type: 'number',
            description: 'Max items before summarizing with counts (default: 50)',
          },
        },
        required: ['node', 'path'],
      },
    },
    {
      name: 'get_file_info',
      description:
        'Get detailed metadata about a specific file or directory on any cluster node. Returns size, type, permissions, and modification date. Use when the user asks about a specific file\'s details, size, or when it was last modified.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Cluster node name: "Home", "pve", "agent1", or "agent"',
          },
          path: {
            type: 'string',
            description: 'Absolute file or directory path',
          },
        },
        required: ['node', 'path'],
      },
    },

    // -----------------------------------------------------------------------
    // RED tier -- VM lifecycle (requires user confirmation)
    // -----------------------------------------------------------------------
    {
      name: 'start_vm',
      description:
        'Start a stopped QEMU virtual machine. REQUIRES USER CONFIRMATION. Use when the user explicitly asks to start or power on a VM.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node where the VM resides (e.g., "Home", "pve")',
          },
          vmid: {
            type: 'number',
            description: 'VM ID number (e.g., 100, 101)',
          },
        },
        required: ['node', 'vmid'],
      },
    },
    {
      name: 'stop_vm',
      description:
        'Stop a running QEMU virtual machine. REQUIRES USER CONFIRMATION. Use when the user asks to stop or shut down a VM.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node where the VM resides',
          },
          vmid: {
            type: 'number',
            description: 'VM ID number',
          },
        },
        required: ['node', 'vmid'],
      },
    },
    {
      name: 'restart_vm',
      description:
        'Restart a QEMU virtual machine. REQUIRES USER CONFIRMATION. Use when the user asks to restart or reboot a VM.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node where the VM resides',
          },
          vmid: {
            type: 'number',
            description: 'VM ID number',
          },
        },
        required: ['node', 'vmid'],
      },
    },

    // -----------------------------------------------------------------------
    // RED tier -- Container lifecycle (requires user confirmation)
    // -----------------------------------------------------------------------
    {
      name: 'start_container',
      description:
        'Start a stopped LXC container. REQUIRES USER CONFIRMATION. Use when the user explicitly asks to start a container.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node where the container resides',
          },
          vmid: {
            type: 'number',
            description: 'Container ID number (e.g., 300, 302)',
          },
        },
        required: ['node', 'vmid'],
      },
    },
    {
      name: 'stop_container',
      description:
        'Stop a running LXC container. REQUIRES USER CONFIRMATION. Use when the user asks to stop a container.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node where the container resides',
          },
          vmid: {
            type: 'number',
            description: 'Container ID number',
          },
        },
        required: ['node', 'vmid'],
      },
    },
    {
      name: 'restart_container',
      description:
        'Restart an LXC container. REQUIRES USER CONFIRMATION. Use when the user asks to restart a container.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node where the container resides',
          },
          vmid: {
            type: 'number',
            description: 'Container ID number',
          },
        },
        required: ['node', 'vmid'],
      },
    },

    // -----------------------------------------------------------------------
    // YELLOW tier -- operational commands with controlled side effects
    // -----------------------------------------------------------------------
    {
      name: 'execute_ssh',
      description:
        'Execute a safe read-only SSH command on a cluster node. Only allowlisted commands are permitted. Use for diagnostics, checking logs, or gathering system info.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node name to execute on (e.g., "Home", "pve", "agent1", "agent")',
          },
          command: {
            type: 'string',
            description: 'Shell command to execute (must be in the allowlist)',
          },
        },
        required: ['node', 'command'],
      },
    },
    {
      name: 'restart_service',
      description:
        'Restart a systemd service on a cluster node. Use when the user asks to restart a service like pvedaemon, corosync, etc.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node name where the service runs',
          },
          service: {
            type: 'string',
            description: 'Systemd service name (e.g., "pvedaemon", "corosync")',
          },
        },
        required: ['node', 'service'],
      },
    },
    {
      name: 'wake_node',
      description:
        'Send a Wake-on-LAN packet to power on an offline cluster node. Use when the user asks to wake up or power on a node.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Node name to wake (e.g., "agent1", "agent", "pve")',
          },
        },
        required: ['node'],
      },
    },

    // -----------------------------------------------------------------------
    // YELLOW tier -- file transfer operations
    // -----------------------------------------------------------------------
    {
      name: 'download_file',
      description:
        'Download a file from a public URL to a cluster node. Validates the URL is not internal (SSRF protection), checks disk space, and streams the download. Use when the user asks to download a file from the internet, fetch a URL, or save a remote file. Files over 500MB will ask for confirmation. Only supports http/https URLs.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'Public URL to download (http or https)',
          },
          destNode: {
            type: 'string',
            description: 'Destination node (default: "Home"). Options: "Home", "pve", "agent1", "agent"',
          },
          destPath: {
            type: 'string',
            description: 'Absolute destination file path (e.g., "/root/downloads/archive.tar.gz")',
          },
        },
        required: ['url', 'destPath'],
      },
    },
    {
      name: 'copy_file',
      description:
        'Copy a file between directories on the same cluster node. Checks disk space, auto-renames if destination exists. Use when the user asks to copy, duplicate, or back up a file on the same server.',
      input_schema: {
        type: 'object' as const,
        properties: {
          node: {
            type: 'string',
            description: 'Cluster node name (e.g., "Home", "pve", "agent1", "agent")',
          },
          sourcePath: {
            type: 'string',
            description: 'Absolute source file path',
          },
          destPath: {
            type: 'string',
            description: 'Absolute destination file path',
          },
        },
        required: ['node', 'sourcePath', 'destPath'],
      },
    },
    {
      name: 'transfer_file',
      description:
        'Transfer a file between different cluster nodes via SSH/SFTP. Use when the user asks to move, transfer, or copy a file from one node to another (e.g., "copy the config from Home to agent1"). If source and destination are the same node, this acts as a copy.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sourceNode: {
            type: 'string',
            description: 'Source cluster node name',
          },
          sourcePath: {
            type: 'string',
            description: 'Absolute source file path on source node',
          },
          destNode: {
            type: 'string',
            description: 'Destination cluster node name',
          },
          destPath: {
            type: 'string',
            description: 'Absolute destination file path on destination node',
          },
        },
        required: ['sourceNode', 'sourcePath', 'destNode', 'destPath'],
      },
    },
  ];
}

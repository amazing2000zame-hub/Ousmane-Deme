/**
 * LLM-optimized Claude tool definitions for all 32 MCP tools.
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

    // -----------------------------------------------------------------------
    // GREEN tier -- read-only project intelligence
    // -----------------------------------------------------------------------
    {
      name: 'list_projects',
      description:
        'List all indexed projects across the cluster. Shows project name, node, type, path, and description for each project. Use when the user asks about projects, "show me all projects", "what projects are on the cluster", or wants to know what codebases exist. Supports optional text filter to search by name, description, or type.',
      input_schema: {
        type: 'object' as const,
        properties: {
          filter: {
            type: 'string',
            description: 'Optional text filter to search project names, descriptions, or types (e.g., "node", "python", "jarvis")',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_project_structure',
      description:
        'Show the directory tree of a project. Use when the user asks to see a project\'s structure, files, or layout (e.g., "show me the structure of jarvis-ui", "what files are in the telegram bot project"). Returns a hierarchical tree view. Sensitive directories (.git, node_modules) are excluded.',
      input_schema: {
        type: 'object' as const,
        properties: {
          project: {
            type: 'string',
            description: 'Project name from the registry (e.g., "jarvis-ui", "file-organizer", "homecluster-telegram-bot")',
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum directory depth to show (default: 3)',
          },
        },
        required: ['project'],
      },
    },
    {
      name: 'read_project_file',
      description:
        'Read a source file from a project. Use when the user asks to see the code, read a file, or look at a specific file in a project (e.g., "show me the index.ts from jarvis-backend", "read the package.json from file-organizer"). Blocks sensitive files like .env, private keys, and credentials. File path is relative to the project root.',
      input_schema: {
        type: 'object' as const,
        properties: {
          project: {
            type: 'string',
            description: 'Project name from the registry',
          },
          file: {
            type: 'string',
            description: 'Relative file path within the project (e.g., "src/index.ts", "package.json", "README.md")',
          },
        },
        required: ['project', 'file'],
      },
    },
    {
      name: 'search_project_files',
      description:
        'Search for a text pattern across all files in a project using grep. Use when the user asks to find something in a project\'s code (e.g., "find all TODO comments in jarvis-backend", "search for error handling in the telegram bot", "where is the database connection defined"). Returns matching lines with file paths and line numbers.',
      input_schema: {
        type: 'object' as const,
        properties: {
          project: {
            type: 'string',
            description: 'Project name from the registry',
          },
          pattern: {
            type: 'string',
            description: 'Search pattern (supports regular expressions)',
          },
          fileFilter: {
            type: 'string',
            description: 'Optional file extension filter (e.g., "ts", "py", "json")',
          },
        },
        required: ['project', 'pattern'],
      },
    },
    {
      name: 'analyze_project',
      description:
        'Gather comprehensive project context for in-depth code analysis. Use when the user asks you to analyze, review, or assess a project (e.g., "analyze the telegram bot", "review the file-organizer code", "what could be improved in jarvis-ui"). Reads project structure, manifest, key source files, code metrics, and patterns (TODOs, error handling). Returns structured context that you should then analyze to provide architecture overview, code quality observations, and specific actionable improvement suggestions. Optional focus: architecture, quality, security, performance, or all.',
      input_schema: {
        type: 'object' as const,
        properties: {
          project: {
            type: 'string',
            description: 'Project name from the registry (e.g., "file-organizer", "homecluster-telegram-bot", "jarvis-ui")',
          },
          focus: {
            type: 'string',
            description: 'Analysis focus area: "architecture", "quality", "security", "performance", or "all" (default: "all")',
            enum: ['architecture', 'quality', 'security', 'performance', 'all'],
          },
        },
        required: ['project'],
      },
    },

    // -----------------------------------------------------------------------
    // YELLOW tier -- voice retraining pipeline
    // -----------------------------------------------------------------------
    {
      name: 'extract_voice_audio',
      description:
        'Extract audio segments from a video or audio file for JARVIS voice training. Use when the user provides a video or audio file and wants to extract voice clips for retraining (e.g., "extract the voice from this video", "process this file for voice training"). Converts to 22050Hz mono WAV, detects speech boundaries using silence detection, and segments into 4-16 second clips suitable for XTTS v2 fine-tuning.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sourcePath: {
            type: 'string',
            description: 'Absolute path to source video or audio file on the Home node (e.g., "/opt/jarvis-tts/sources/jarvis-clip.mp4")',
          },
          minDuration: {
            type: 'number',
            description: 'Minimum clip duration in seconds (default: 4)',
          },
          maxDuration: {
            type: 'number',
            description: 'Maximum clip duration in seconds (default: 16)',
          },
        },
        required: ['sourcePath'],
      },
    },
    {
      name: 'prepare_voice_dataset',
      description:
        'Transcribe extracted audio clips and build an LJSpeech-format training dataset. Use after extract_voice_audio to transcribe clips with Whisper and generate metadata.csv. Run this when the user says "prepare the dataset", "transcribe the clips", or after extracting audio segments.',
      input_schema: {
        type: 'object' as const,
        properties: {
          regenerate: {
            type: 'boolean',
            description: 'Re-transcribe all clips even if metadata.csv already exists (default: false)',
          },
        },
        required: [],
      },
    },
    {
      name: 'retrain_voice_model',
      description:
        'Fine-tune the XTTS v2 GPT decoder on the prepared JARVIS voice dataset. Use when the user asks to retrain, improve, or update the JARVIS voice model (e.g., "retrain the voice", "improve voice quality"). Runs inside the TTS Docker container. Produces fine-tuned weights and updated speaker embeddings. Requires a prepared dataset (run prepare_voice_dataset first).',
      input_schema: {
        type: 'object' as const,
        properties: {
          epochs: {
            type: 'number',
            description: 'Number of training epochs (default: 6, more epochs = better quality but longer training)',
          },
        },
        required: [],
      },
    },
    {
      name: 'deploy_voice_model',
      description:
        'Deploy the retrained voice model to the live TTS service. REQUIRES USER CONFIRMATION. Clears cached voice output, restarts the TTS Docker container to load new weights, waits for health check, and runs a test synthesis. Use after retrain_voice_model when the user wants to activate the new voice.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },

    // -----------------------------------------------------------------------
    // Phase 25: Smart Home Tools
    // -----------------------------------------------------------------------
    {
      name: 'get_who_is_home',
      description:
        'Detect who is currently home using network presence (phone detection) and camera AI (car detection). Use when the user asks "is anyone home?", "who\'s home?", "are we alone?", "check if someone is home", or wants to check occupancy. Combines network scanning for known phones with Frigate NVR car detection.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'scan_network_devices',
      description:
        'Scan the network for all connected devices (phones, laptops, etc.). Use when the user asks "what devices are connected?", "show me all devices on the network", or wants a full network scan. Returns device IPs, MAC addresses, and marks known family devices.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_thermostat_status',
      description:
        'Get current thermostat status including temperature, humidity, and HVAC mode. Use when the user asks "what\'s the temperature?", "is the AC on?", "how warm is it?", "check the thermostat", or wants to know the current climate settings.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'set_thermostat',
      description:
        'Set thermostat temperature or change HVAC mode (heat, cool, auto, off). Use when the user says "set temperature to 72", "turn on the AC", "switch to heat mode", "make it warmer", "cool down the house", or wants to adjust climate settings.',
      input_schema: {
        type: 'object' as const,
        properties: {
          temperature: {
            type: 'number',
            description: 'Target temperature in Fahrenheit (50-90)',
          },
          mode: {
            type: 'string',
            enum: ['heat', 'cool', 'heat_cool', 'off', 'auto'],
            description: 'HVAC mode to set',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_lock_status',
      description:
        'Get the current status of all door locks (locked/unlocked). Use when the user asks "are the doors locked?", "check the locks", "is the front door secure?", "lock status", or wants to verify home security.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'lock_door',
      description:
        'Lock a specific door. REQUIRES USER CONFIRMATION. Use when the user says "lock the front door", "secure the house", "lock up", or explicitly asks to lock a door.',
      input_schema: {
        type: 'object' as const,
        properties: {
          lockName: {
            type: 'string',
            description: 'Door lock name or entity ID (e.g., "front_door", "back_door", "lock.front_door")',
          },
        },
        required: ['lockName'],
      },
    },
    {
      name: 'unlock_door',
      description:
        'Unlock a specific door. REQUIRES USER CONFIRMATION. Use when the user says "unlock the front door", "let me in", "open the door", or explicitly asks to unlock a door.',
      input_schema: {
        type: 'object' as const,
        properties: {
          lockName: {
            type: 'string',
            description: 'Door lock name or entity ID (e.g., "front_door", "back_door", "lock.front_door")',
          },
        },
        required: ['lockName'],
      },
    },
    {
      name: 'get_camera_snapshot',
      description:
        'Get a snapshot image from a security camera. Use when the user asks "show me the driveway", "what\'s on the front camera?", "check the backyard camera", or wants to see a live camera view.',
      input_schema: {
        type: 'object' as const,
        properties: {
          camera: {
            type: 'string',
            description: 'Camera name (e.g., "driveway", "front_door", "backyard", "garage")',
          },
        },
        required: ['camera'],
      },
    },
    {
      name: 'query_nvr_detections',
      description:
        'Query recent AI object detections from security cameras (cars, people, packages, pets). Use when the user asks "any cars in the driveway?", "has anyone been outside?", "any deliveries today?", "show me recent detections", "were there any visitors?", or wants to check security camera activity.',
      input_schema: {
        type: 'object' as const,
        properties: {
          camera: {
            type: 'string',
            description: 'Filter by camera name (optional)',
          },
          objectType: {
            type: 'string',
            enum: ['person', 'car', 'package', 'dog', 'cat'],
            description: 'Filter by object type (optional)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20)',
          },
          withinMinutes: {
            type: 'number',
            description: 'Only show detections within last N minutes (optional)',
          },
        },
        required: [],
      },
    },
    {
      name: 'show_live_feed',
      description:
        "Open a live camera feed in the dashboard UI. Use when the user asks to see, view, show, or bring up a camera stream (e.g., 'show me the front door', 'let me see the driveway camera', 'bring up the side house feed').",
      input_schema: {
        type: 'object' as const,
        properties: {
          camera: {
            type: 'string',
            description: 'Camera name (e.g., "front_door", "side_house")',
          },
        },
        required: ['camera'],
      },
    },
  ];
}

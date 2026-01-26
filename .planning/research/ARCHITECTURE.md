# Architecture Patterns: File Operations, Project Intelligence & Voice Retraining

**Domain:** MCP tool integration for file management, project analysis, and TTS voice pipeline
**Researched:** 2026-01-26
**Overall Confidence:** HIGH (verified against existing codebase -- every source file read and analyzed)

---

## Existing Architecture (As-Built, Verified)

The following is the precise current state from reading every source file in the codebase.

### Current Module Map

```
jarvis-backend/src/
  index.ts              -- Express 5 + HTTP server + Socket.IO bootstrap
  config.ts             -- Centralized config from env vars

  ai/
    claude.ts           -- Anthropic SDK client singleton
    local-llm.ts        -- OpenAI-compatible SSE streaming (Qwen)
    loop.ts             -- Agentic tool-calling loop (streams + tool_use blocks)
    router.ts           -- Intent-based LLM provider routing (keyword + entity + follow-up)
    providers.ts        -- LLMProvider interface barrel
    providers/
      claude-provider.ts -- Claude provider implementation
      qwen-provider.ts   -- Qwen provider implementation
    system-prompt.ts    -- JARVIS personality + live cluster context injection
    tools.ts            -- 18 Anthropic tool definitions (hardcoded for optimal descriptions)
    tts.ts              -- TTS provider abstraction (local XTTS > ElevenLabs > OpenAI)
    cost-tracker.ts     -- Token cost accumulation + daily budget enforcement
    memory-extractor.ts -- Extract memories from conversations
    memory-context.ts   -- Build memory context for LLM
    memory-recall.ts    -- Recall relevant memories

  mcp/
    server.ts           -- McpServer instance + executeTool() pipeline
                           Pipeline: sanitize -> checkSafety -> execute handler -> log
    tools/
      cluster.ts        -- 9 GREEN-tier read-only monitoring tools
      lifecycle.ts      -- 6 RED/YELLOW-tier VM/CT start/stop/restart tools
      system.ts         -- 3 YELLOW-tier operational tools (SSH, service restart, WOL)

  safety/
    tiers.ts            -- 4-tier ActionTier enum (GREEN/YELLOW/RED/BLACK) + checkSafety()
    protected.ts        -- Protected resource guard (VMID 103, Docker daemon)
    sanitize.ts         -- Input sanitization + command allowlist/blocklist
    context.ts          -- Override context thread-local state

  db/
    index.ts            -- better-sqlite3 + Drizzle ORM init (WAL mode)
    schema.ts           -- 6 tables: events, conversations, cluster_snapshots,
                           preferences, memories, autonomy_actions
    memory.ts           -- memoryStore API
    memories.ts         -- Memory tier operations
    migrate.ts          -- Schema migrations

  clients/
    proxmox.ts          -- ProxmoxClient class (REST over HTTPS:8006, API token auth)
    ssh.ts              -- SSH connection pool (node-ssh, key-based, lazy connect)

  monitor/              -- Tiered polling, state tracking, runbooks, guardrails
  realtime/             -- Socket.IO: /cluster, /events, /chat, /terminal namespaces
  api/                  -- Express routes: health, auth, memory, tools, monitor, cost, tts
  auth/                 -- JWT sign/verify + login
```

### TTS Service (Separate Process)

```
/opt/jarvis-tts/
  app/server.py         -- FastAPI XTTS v2 server (POST /synthesize, GET /health, GET /voices)
  docker-compose.yml    -- Docker container config (port 5050, 8GB mem limit, 14 CPU limit)
  Dockerfile            -- Python env with TTS, torch, torchaudio
  voices/jarvis/        -- 10 reference WAV clips (22050Hz, mono, 16-bit PCM)
  training/
    dataset/
      metadata.csv      -- LJSpeech-format: 10 entries with transcriptions
      wavs/             -- Training audio clips
    finetune_xtts.py    -- GPT decoder fine-tuning (6 epochs, lr=5e-6, batch=1)
    compute_speaker_embedding.py -- Pre-compute speaker conditioning latents
    extract_gpt_weights.py       -- Extract fine-tuned GPT weights from checkpoint
    output/
      jarvis_speaker.pth         -- Pre-computed speaker embedding
      gpt_finetuned_weights.pth  -- Fine-tuned GPT decoder weights
      mel_stats.pth              -- Mel normalization statistics
  extract-voice.sh      -- Helper: extract audio clips from video via ffmpeg
  prepare-audio.sh      -- Helper: convert audio to XTTS v2 format (22050Hz/mono/PCM)
```

### Current Tool Registration Pattern

This is the critical integration pattern that new tools must follow:

```
1. Define handler in src/mcp/tools/<domain>.ts
   - Export a registerXxxTools(server: McpServer) function
   - Each tool: server.tool(name, description, zodSchema, handler)
   - Handler returns { content: [{ type: 'text', text: ... }], isError?: boolean }

2. Register in src/mcp/server.ts
   - Import registerXxxTools
   - Call registerXxxTools(mcpServer)
   - The monkey-patched mcpServer.tool() captures handler references automatically

3. Add safety tier in src/safety/tiers.ts
   - Add entry to TOOL_TIERS record: toolName: ActionTier.GREEN/YELLOW/RED/BLACK

4. Add Claude tool definition in src/ai/tools.ts
   - Hardcoded Anthropic.Tool object with optimized description for Claude
   - The confirmed parameter is NOT included (handled by safety pipeline)

5. (If needed) Add sanitization in src/safety/sanitize.ts
   - Add allowlist entries for new SSH commands
   - Add blocklist entries for dangerous patterns

6. (If needed) Update router in src/ai/router.ts
   - Add keywords/patterns so the router sends relevant messages to Claude
```

### Current Data Flow: Tool Execution

```
User message -> chat.ts -> router.routeMessage() -> Claude provider
     |
     v
Claude responds with tool_use block
     |
     v
loop.ts processes tool_use:
  1. getToolTier(name) -> GREEN/YELLOW/RED/BLACK
  2. BLACK -> blocked, error returned to Claude
  3. RED -> PendingConfirmation returned to frontend
  4. GREEN/YELLOW -> executeTool()
       |
       v
  mcp/server.ts executeTool():
    1. Look up handler from toolHandlers Map
    2. Sanitize string arguments (sanitizeInput)
    3. checkSafety(name, args, confirmed, overrideActive)
    4. Execute handler function
    5. Log to memoryStore.saveEvent()
    6. Return ToolResult with tier info
```

---

## New Feature Architecture: File Operations

### What This Feature Does

Enables Jarvis to perform file operations across the 4-node cluster:
- Download files from any node to the user (via browser)
- Import/upload files to specific node paths
- List directory contents on any node
- Read file contents from any node

### Integration Strategy: SSH-Based, Not Agent-Based

All file operations go through the existing SSH client (`clients/ssh.ts`). This is the correct approach because:
- SSH is already established to all 4 nodes with key-based auth
- The SSH pool handles connection lifecycle automatically
- No new agent software needed on cluster nodes
- File transfer via SSH (scp/sftp) is battle-tested
- The `node-ssh` library already supports file transfer (putFile, getFile, putDirectory)

Do NOT build a file agent that runs on each node. The SSH approach is simpler, uses existing infrastructure, and requires zero new deployment.

### New Components

```
src/mcp/tools/files.ts      -- File operation MCP tools (4-6 tools)
src/clients/ssh.ts           -- Extended with file transfer methods (getFile, putFile)
src/api/files.ts             -- REST endpoint for file download streaming
```

### Component: File Tools (`src/mcp/tools/files.ts`)

```
Tools to register:

1. list_directory (GREEN)
   - Args: { node: string, path: string }
   - Implementation: execOnNodeByName(node, `ls -la "${path}"`)
   - Returns: Parsed directory listing with names, sizes, permissions, dates

2. read_file (GREEN)
   - Args: { node: string, path: string, lines?: number }
   - Implementation: execOnNodeByName(node, `head -n ${lines} "${path}"`)
   - Safety: Max 500 lines default, path sanitization
   - Returns: File contents as text

3. search_files (GREEN)
   - Args: { node: string, path: string, pattern: string, type?: 'name' | 'content' }
   - Implementation: execOnNodeByName(node, `find "${path}" -name "${pattern}"`)
                 or: execOnNodeByName(node, `grep -rl "${pattern}" "${path}"`)
   - Returns: List of matching file paths

4. file_info (GREEN)
   - Args: { node: string, path: string }
   - Implementation: execOnNodeByName(node, `stat "${path}" && file "${path}"`)
   - Returns: File metadata (size, type, permissions, modified date)

5. download_file (YELLOW)
   - Args: { node: string, path: string }
   - Implementation: Uses node-ssh getFile to transfer to temp directory
   - Returns: Download URL (temporary, served by Express)
   - Note: YELLOW because it transfers data off-node

6. write_file (RED)
   - Args: { node: string, path: string, content: string, confirmed?: boolean }
   - Implementation: Uses node-ssh putFile or echo via SSH
   - Safety: RED tier, requires confirmation
   - Blocklist: Cannot write to /etc/pve/*, /etc/ssh/*, system paths
```

### Safety Tier Assignments

| Tool | Tier | Rationale |
|------|------|-----------|
| `list_directory` | GREEN | Read-only, equivalent to existing SSH `ls` |
| `read_file` | GREEN | Read-only, equivalent to existing SSH `cat` |
| `search_files` | GREEN | Read-only, equivalent to existing SSH `find/grep` |
| `file_info` | GREEN | Read-only, equivalent to existing SSH `stat` |
| `download_file` | YELLOW | Transfers data, creates temp file on backend |
| `write_file` | RED | Modifies filesystem, requires confirmation |

### Path Sanitization (Critical)

File operations introduce **path traversal attacks** as a new threat vector. The existing `sanitizeInput()` strips control characters but does NOT validate filesystem paths.

New sanitization needed in `src/safety/sanitize.ts`:

```
Path safety rules:
1. Resolve and normalize path (collapse ../, ./, //)
2. BLOCK paths starting with: /etc/pve/, /etc/ssh/, /etc/shadow, /proc/, /sys/
3. BLOCK paths containing: ../ (after normalization this catches traversal)
4. BLOCK absolute paths to sensitive locations (defined in a PROTECTED_PATHS list)
5. MAX path length: 1024 characters
6. Characters: alphanumeric, /, -, _, ., space only
```

The protected paths list should mirror the existing `PROTECTED_RESOURCES` pattern from `safety/protected.ts`:

```
New in protected.ts:
  PROTECTED_PATHS = [
    '/etc/pve/',         -- Cluster configuration
    '/etc/ssh/',         -- SSH keys and config
    '/etc/shadow',       -- Password hashes
    '/etc/passwd',       -- User accounts (read OK but write blocked)
    '/root/.ssh/',       -- SSH keys
    '/opt/agent/.env',   -- Agent credentials
  ]
```

### SSH Client Extension

The existing `ssh.ts` exports `execOnNode()` and `execOnNodeByName()` for command execution. For file download, extend with:

```
New exports in ssh.ts:
  getFileFromNode(nodeName: string, remotePath: string, localPath: string): Promise<void>
  putFileToNode(nodeName: string, localPath: string, remotePath: string): Promise<void>
```

The `node-ssh` library already supports `getFile()` and `putFile()` on the SSH connection object. This is a thin wrapper.

### File Download Flow

```
1. Claude calls download_file tool with { node, path }
2. Handler validates path safety
3. Handler calls getFileFromNode() -> saves to /tmp/jarvis-downloads/<uuid>-filename
4. Handler returns JSON: { downloadUrl: "/api/files/download/<uuid>", filename, size }
5. Claude presents the download link to the user
6. User clicks link -> Express serves the file with proper Content-Disposition
7. Cleanup: temp files deleted after 5 minutes (setTimeout or periodic cleanup)
```

New Express route needed:

```
GET /api/files/download/:id
  - Validates id format (UUID)
  - Serves file from temp directory with Content-Disposition: attachment
  - Sets appropriate Content-Type based on file extension
  - Deletes file after serving (or after TTL)
```

### Command Allowlist Updates

The existing `sanitize.ts` has a COMMAND_ALLOWLIST for `execute_ssh`. File tools use `execOnNodeByName()` internally, which also goes through sanitization. The file tools should bypass the command allowlist since they construct commands internally (not from user input). Two approaches:

**Option A (Recommended):** File tool handlers construct commands internally and call `execOnNode()` directly, bypassing `sanitizeCommand()`. The path validation in the tool handler itself provides safety.

**Option B:** Add file-related prefixes to the allowlist (`cat`, `head`, `find`, `stat`, `file`, `grep`). But `cat` and `find` are already in the allowlist (`head`, `tail`, `stat` are present; `cat /sys` is present but generic `cat` is not).

Recommendation: **Option A.** The file tools should own their own safety validation (path sanitization) rather than relying on the generic command allowlist. The command allowlist is designed for `execute_ssh` where the user provides the command. For file tools, the backend constructs the command from validated inputs.

### Integration with Router

Update `src/ai/router.ts` to route file-related messages to Claude:

```
New ENTITY_PATTERNS additions:
  /\b(file|files|folder|directory|download|upload|import)\b/i
  /\b(read|write|list|search|browse)\b/i  -- (some overlap with existing QUERY_KEYWORDS)

New ACTION_KEYWORDS additions:
  'download', 'upload', 'import'
```

---

## New Feature Architecture: Project Intelligence

### What This Feature Does

Enables Jarvis to understand, browse, and analyze the 24+ projects across the cluster:
- List all known projects with metadata
- Read project structure (directory tree, key files)
- Analyze project health (outdated deps, missing configs, Docker status)
- Search across projects for code patterns

### Data Source: File Organizer Registry

The existing File Organizer agent on agent1 (192.168.1.61) maintains a registry at:
```
/opt/cluster-agents/file-organizer/data/registry.json
```

This registry contains 24 indexed projects with:
- `id`: Unique identifier (node-path based)
- `name`: Project name
- `path`: Absolute path on the node
- `node`: Which cluster node (home, pve, agent1)
- `type`: Project type (node, python, docker-compose, docker, make)
- `markers`: Detected marker files (package.json, Dockerfile, pyproject.toml, etc.)
- `lastModified`: Last modification timestamp
- `status`: active/stale
- `version`: Package version (if detected)

### Integration Strategy: Registry as Cache, SSH for Details

The registry provides a fast index for project discovery. For detailed operations (read files, analyze deps), use SSH to the project's node. This is a two-tier approach:

```
Tier 1: Registry query (fast, cached)
  - List all projects
  - Filter by node, type, status
  - Get project metadata

Tier 2: SSH inspection (on-demand, slower)
  - Read package.json, Dockerfile, etc.
  - Run `npm outdated` or `pip list --outdated`
  - Check Docker container status
  - Read directory structure
```

### New Components

```
src/mcp/tools/projects.ts     -- Project intelligence MCP tools (5-7 tools)
src/clients/registry.ts        -- Registry client (fetch + cache from agent1)
```

### Component: Registry Client (`src/clients/registry.ts`)

```
Purpose: Fetch and cache the project registry from agent1

Implementation:
  - SSH to agent1, cat the registry.json file
  - Parse and cache in-memory with 5-minute TTL
  - Provide typed access to project data

Interface:
  getProjects(): Promise<Project[]>
  getProjectById(id: string): Promise<Project | null>
  getProjectsByNode(node: string): Promise<Project[]>
  getProjectsByType(type: string): Promise<Project[]>
  refreshRegistry(): Promise<void>  -- Force cache invalidation
```

Why a dedicated client instead of inline SSH calls:
- Registry access is frequent (multiple tools reference it)
- Caching avoids repeated SSH calls for the same data
- Type safety for the registry schema
- Single point of change if registry location moves

### Component: Project Tools (`src/mcp/tools/projects.ts`)

```
Tools to register:

1. list_projects (GREEN)
   - Args: { node?: string, type?: string }
   - Implementation: Registry client query with optional filters
   - Returns: Project list with name, node, type, path, lastModified

2. get_project_details (GREEN)
   - Args: { project: string }  -- project name or ID
   - Implementation: Registry lookup + SSH to read key files
   - Reads: package.json/pyproject.toml (name, version, deps count),
            Dockerfile existence, docker-compose.yml existence,
            .git status (branch, last commit)
   - Returns: Rich project details

3. get_project_structure (GREEN)
   - Args: { project: string, depth?: number }
   - Implementation: Registry lookup for path/node, then SSH `tree` or `find`
   - Returns: Directory tree (limited depth, excludes node_modules/.git)

4. read_project_file (GREEN)
   - Args: { project: string, file: string }
   - Implementation: Registry lookup for path/node, then SSH `cat`
   - Safety: File path must be within project directory
   - Returns: File contents

5. analyze_project (GREEN)
   - Args: { project: string }
   - Implementation: Registry + SSH to gather:
     - Package outdated status (npm outdated / pip list --outdated)
     - Docker container running status
     - Git status (uncommitted changes, ahead/behind)
     - Disk usage
   - Returns: Health report with findings

6. search_project_code (GREEN)
   - Args: { project: string, pattern: string }
   - Implementation: Registry lookup, then SSH `grep -rn`
   - Returns: Matching lines with file paths and line numbers
```

### Safety Tier Assignments

All project tools are **GREEN** (read-only). The project tools never modify files. If the user wants to modify project files, they use the `write_file` tool from the file operations feature, which is RED tier.

| Tool | Tier | Rationale |
|------|------|-----------|
| `list_projects` | GREEN | Read-only registry query |
| `get_project_details` | GREEN | Read-only SSH + registry |
| `get_project_structure` | GREEN | Read-only directory listing |
| `read_project_file` | GREEN | Read-only file read within project bounds |
| `analyze_project` | GREEN | Read-only health check commands |
| `search_project_code` | GREEN | Read-only grep |

### Project Path Containment

The `read_project_file` tool must enforce that the requested file is within the project's directory. This prevents using project tools as a backdoor for arbitrary file access:

```
Validation:
  1. Look up project from registry -> get project.path and project.node
  2. Resolve requested file: path.resolve(project.path, file)
  3. Verify resolved path starts with project.path
  4. Block if traversal detected (resolved path escapes project root)
```

### Integration with Existing File Tools

The project tools and file tools are complementary:
- **Project tools** are scoped to known projects (safer, more context-aware)
- **File tools** are general-purpose (any path on any node)
- Claude can chain them: `list_projects` -> pick project -> `read_project_file` -> `analyze_project`

### Integration with Router

Update `src/ai/router.ts`:

```
New ENTITY_PATTERNS additions:
  /\b(project|projects|repository|codebase)\b/i
  /\b(jarvis-ui|jarvis-backend|jarvis-tts|proxmox-ui|file-organizer)\b/i
  /\b(package\.json|dockerfile|docker-compose|requirements\.txt)\b/i

New ACTION_KEYWORDS additions:
  'analyze', 'outdated', 'dependencies'
```

---

## New Feature Architecture: Voice Retraining

### What This Feature Does

Provides tools for Jarvis to manage its own voice:
- Extract audio clips from video files (for new training data)
- Prepare audio in XTTS v2 format
- Trigger speaker embedding recomputation
- Trigger GPT fine-tuning
- Monitor training progress

### Current Voice Pipeline (Verified)

```
Data Preparation:
  extract-voice.sh   -- ffmpeg: video -> audio clip (22050Hz, mono, 16-bit PCM)
  prepare-audio.sh   -- ffmpeg: any audio -> XTTS format

Training Pipeline (inside Docker container):
  1. compute_speaker_embedding.py
     - Loads XTTS v2 model
     - Processes all clips in /voices/jarvis/
     - Outputs: jarvis_speaker.pth (combined GPT cond latent + speaker embedding)

  2. finetune_xtts.py
     - Loads XTTS v2 + DVAE
     - Freezes all non-GPT parameters
     - Trains GPT decoder on dataset (6 epochs, lr=5e-6)
     - Outputs: gpt_finetuned/ checkpoint directory

  3. extract_gpt_weights.py
     - Loads checkpoint from finetune output
     - Remaps keys (xtts.gpt.* -> gpt.*)
     - Outputs: gpt_finetuned_weights.pth

Runtime:
  server.py loads:
    1. Base XTTS v2 model
    2. Fine-tuned GPT weights (gpt_finetuned_weights.pth)
    3. Pre-computed speaker embedding (jarvis_speaker.pth)
  Synthesis uses pre-computed embedding (fast) with fine-tuned GPT (better quality)
```

### Integration Strategy: Backend Orchestrates, TTS Container Executes

The voice retraining tools live in the Jarvis backend but delegate execution to:
- **Host shell** for audio extraction (ffmpeg runs on the Home node host)
- **TTS Docker container** for training scripts (Python + PyTorch environment)

The backend does NOT need Python or PyTorch. It orchestrates via:
1. SSH commands to Home node for ffmpeg operations
2. `docker exec` commands to the jarvis-tts container for training

### New Components

```
src/mcp/tools/voice.ts        -- Voice management MCP tools (5-6 tools)
```

No new clients needed. Uses:
- `execOnNodeByName('Home', ...)` for host-level operations
- `execOnNodeByName('Home', 'docker exec jarvis-tts ...')` for container operations

### Component: Voice Tools (`src/mcp/tools/voice.ts`)

```
Tools to register:

1. voice_status (GREEN)
   - Args: {}
   - Implementation: Fetch http://192.168.1.50:5050/health + list voice files
   - Returns: Model status, mode (zero-shot/trained/finetuned),
              reference audio count, embedding status, cache info

2. list_voice_clips (GREEN)
   - Args: {}
   - Implementation: SSH ls /opt/jarvis-tts/voices/jarvis/
   - Returns: Audio clips with names, sizes, durations

3. extract_voice_clip (YELLOW)
   - Args: { inputVideo: string, startTime: string, duration: number, outputName: string }
   - Implementation: SSH to Home: ffmpeg -i ... -ss ... -t ... -vn -acodec pcm_s16le -ar 22050 -ac 1
   - Safety: Validate paths, duration limits (3-60s), output to /opt/jarvis-tts/voices/jarvis/
   - Returns: Extracted clip metadata

4. prepare_audio_clip (YELLOW)
   - Args: { inputFile: string, outputName: string }
   - Implementation: SSH to Home: ffmpeg conversion to XTTS format
   - Returns: Converted clip metadata

5. retrain_voice_embedding (YELLOW)
   - Args: { confirmed?: boolean }
   - Implementation: docker exec jarvis-tts python3 /training/compute_speaker_embedding.py
   - Note: Takes ~60-120s on CPU, blocks the TTS service during execution
   - Returns: New embedding info (num clips, shapes)

6. retrain_voice_model (RED)
   - Args: { epochs?: number, confirmed: boolean }
   - Implementation:
     a. docker exec jarvis-tts python3 /training/finetune_xtts.py
     b. docker exec jarvis-tts python3 /training/extract_gpt_weights.py
     c. docker restart jarvis-tts (to reload weights)
   - Note: Takes 30-90 minutes on CPU, heavy resource usage
   - Returns: Training status and log tail

7. get_training_log (GREEN)
   - Args: { lines?: number }
   - Implementation: SSH tail /opt/jarvis-tts/training/finetune.log
   - Returns: Recent training log output
```

### Safety Tier Assignments

| Tool | Tier | Rationale |
|------|------|-----------|
| `voice_status` | GREEN | Read-only health check |
| `list_voice_clips` | GREEN | Read-only directory listing |
| `extract_voice_clip` | YELLOW | Creates files, runs ffmpeg |
| `prepare_audio_clip` | YELLOW | Creates files, runs ffmpeg |
| `retrain_voice_embedding` | YELLOW | Compute-intensive but non-destructive, can be auto-reloaded |
| `retrain_voice_model` | RED | Very compute-intensive (30-90 min), blocks TTS, requires restart |
| `get_training_log` | GREEN | Read-only log access |

### Command Allowlist for Voice Operations

The voice tools execute commands via `execOnNodeByName('Home', ...)`. Since these commands are constructed internally (not from user input), they should bypass the generic command allowlist. However, the blocklist still applies.

For voice tools specifically, the constructed commands are:
- `ffmpeg -i ... -ss ... -t ... -vn -acodec pcm_s16le -ar 22050 -ac 1 -y /opt/jarvis-tts/voices/jarvis/...`
- `docker exec jarvis-tts python3 /training/compute_speaker_embedding.py`
- `docker exec jarvis-tts python3 /training/finetune_xtts.py`
- `ls /opt/jarvis-tts/voices/jarvis/`
- `tail /opt/jarvis-tts/training/finetune.log`

These are NOT in the current allowlist and should NOT be added there (they are internal commands, not user-facing SSH commands). The voice tool handlers should call `execOnNode()` directly rather than going through the `execute_ssh` tool pipeline.

### Resource Management During Training

Fine-tuning XTTS v2 GPT decoder on CPU is extremely resource-intensive:
- Current config: 14 CPU cores, 8GB memory limit for the TTS container
- Training duration: 30-90 minutes for 6 epochs on 10 samples
- During training, TTS synthesis is unavailable (model weights are being modified)

Mitigation:
- `retrain_voice_model` is RED tier (requires explicit user confirmation)
- The tool description should warn about TTS downtime
- After training completes, the container must be restarted to load new weights
- Consider running training in a separate container to avoid TTS downtime (future enhancement)

### Integration with Router

Update `src/ai/router.ts`:

```
New ENTITY_PATTERNS additions:
  /\b(voice|tts|speech|audio|training|retrain)\b/i
  /\b(xtts|jarvis.?tts|voice.?clone)\b/i

New ACTION_KEYWORDS additions:
  'extract', 'retrain', 'train', 'clip'
```

---

## Component Boundaries Summary

### New Files to Create

| File | Purpose | Depends On |
|------|---------|------------|
| `src/mcp/tools/files.ts` | 6 file operation MCP tools | `clients/ssh.ts`, `safety/sanitize.ts` |
| `src/mcp/tools/projects.ts` | 6 project intelligence MCP tools | `clients/registry.ts`, `clients/ssh.ts` |
| `src/mcp/tools/voice.ts` | 7 voice management MCP tools | `clients/ssh.ts` |
| `src/clients/registry.ts` | Project registry fetch + cache | `clients/ssh.ts` |
| `src/api/files.ts` | File download REST endpoint | Express router |

### Existing Files to Modify

| File | Changes |
|------|---------|
| `src/mcp/server.ts` | Import + call `registerFileTools`, `registerProjectTools`, `registerVoiceTools` |
| `src/safety/tiers.ts` | Add ~19 new tool-to-tier mappings in `TOOL_TIERS` |
| `src/safety/sanitize.ts` | Add path sanitization function (`sanitizePath`) |
| `src/safety/protected.ts` | Add `PROTECTED_PATHS` list |
| `src/ai/tools.ts` | Add ~19 new Claude tool definitions |
| `src/ai/router.ts` | Add file/project/voice keywords to routing patterns |
| `src/clients/ssh.ts` | Add `getFileFromNode()` and `putFileToNode()` methods |
| `src/api/routes.ts` | Mount file download route |

### Files NOT Modified

| File | Why Unchanged |
|------|---------------|
| `src/ai/loop.ts` | Agentic loop is tool-agnostic; new tools work automatically |
| `src/ai/claude.ts` | Client singleton unchanged |
| `src/db/schema.ts` | No new tables needed for these features |
| `src/db/memory.ts` | Existing event logging suffices |
| `src/config.ts` | May add TTS endpoint config but already has `localTtsEndpoint` |
| `src/realtime/chat.ts` | Chat flow unchanged; routing handles the new tool triggers |

---

## Data Flow Diagrams

### File Download Flow

```
User: "Download the nginx config from agent1"
  |
  v
router.ts: matches "download" -> Claude
  |
  v
Claude: tool_use { name: "download_file", input: { node: "agent1", path: "/etc/nginx/nginx.conf" } }
  |
  v
loop.ts: tier=YELLOW -> auto-execute
  |
  v
files.ts handler:
  1. sanitizePath("/etc/nginx/nginx.conf") -> allowed
  2. getFileFromNode("agent1", "/etc/nginx/nginx.conf", "/tmp/jarvis-dl/<uuid>-nginx.conf")
  3. return { downloadUrl: "/api/files/download/<uuid>", filename: "nginx.conf", size: 1234 }
  |
  v
Claude: "Here's the nginx config: [Download link](/api/files/download/<uuid>)"
  |
  v
User clicks link -> files.ts Express route serves file -> cleanup
```

### Project Analysis Flow

```
User: "Analyze the jarvis-backend project"
  |
  v
router.ts: matches "project" + "analyze" -> Claude
  |
  v
Claude: tool_use { name: "analyze_project", input: { project: "jarvis-backend" } }
  |
  v
projects.ts handler:
  1. registry.getProjects() -> find project by name
  2. SSH to Home node:
     a. cat /root/jarvis-backend/package.json (parse deps, version)
     b. npm outdated --json (in project dir)
     c. git -C /root/jarvis-backend status --porcelain
     d. du -sh /root/jarvis-backend
  3. Return structured report
  |
  v
Claude: Presents analysis with findings and recommendations
```

### Voice Retraining Flow

```
User: "Extract a new voice clip from the Iron Man 2 video"
  |
  v
router.ts: matches "voice" + "extract" -> Claude
  |
  v
Claude: tool_use { name: "extract_voice_clip", input: {
  inputVideo: "/path/to/ironman2.mkv",
  startTime: "00:45:23",
  duration: 12,
  outputName: "jarvis-ref-33"
} }
  |
  v
voice.ts handler:
  1. Validate inputs (duration 3-60s, output name safe)
  2. execOnNodeByName("Home", "ffmpeg -i ... -ss 00:45:23 -t 12 ...")
  3. execOnNodeByName("Home", "ls -la /opt/jarvis-tts/voices/jarvis/jarvis-ref-33.wav")
  4. Return clip metadata

...later...

User: "Retrain the voice with the new clips"
  |
  v
Claude: tool_use { name: "retrain_voice_embedding", input: {} }
  |
  v
voice.ts handler:
  1. execOnNodeByName("Home",
     "docker exec jarvis-tts python3 /training/compute_speaker_embedding.py")
  2. Return embedding computation results

Claude: "Embedding updated with 11 clips. Shall I also retrain the GPT model?"
  |
  v
User: "Yes"
  |
  v
Claude: tool_use { name: "retrain_voice_model", input: { epochs: 6 } }
  |
  v (RED tier -> PendingConfirmation -> user confirms in UI)
  |
  v
voice.ts handler:
  1. execOnNodeByName("Home",
     "docker exec jarvis-tts python3 /training/finetune_xtts.py")
  2. execOnNodeByName("Home",
     "docker exec jarvis-tts python3 /training/extract_gpt_weights.py")
  3. execOnNodeByName("Home", "docker restart jarvis-tts")
  4. Wait for health check to pass
  5. Return training results
```

---

## Suggested Build Order

The three features have clear dependency and complexity ordering:

```
Phase 1: File Operations (Foundation Layer)
  Build: src/mcp/tools/files.ts + ssh.ts extensions + safety/sanitize path validation
  Why first: Both project tools and voice tools need file read/list capabilities.
             Path sanitization is foundational safety infrastructure.
  Estimated scope: 4-5 new tools, ~300 lines new code
  Risk: LOW (SSH commands are well-understood, safety patterns established)

Phase 2: Project Intelligence (Data Layer)
  Build: src/clients/registry.ts + src/mcp/tools/projects.ts
  Why second: Depends on file reading capability from Phase 1.
              The registry client is a new client pattern but straightforward.
  Estimated scope: 1 new client + 5-6 tools, ~400 lines new code
  Risk: LOW (Registry is a simple JSON file, SSH commands are familiar)

Phase 3: Voice Retraining (Orchestration Layer)
  Build: src/mcp/tools/voice.ts
  Why last: Most complex (Docker exec, long-running processes, service restart).
            Does not block other features. Requires TTS container running.
  Estimated scope: 6-7 tools, ~350 lines new code
  Risk: MEDIUM (long-running training, resource contention, container restart)
```

### Phase Ordering Rationale

1. **File operations first** because they establish the path sanitization infrastructure that all subsequent file access depends on. The `sanitizePath()` function, `PROTECTED_PATHS` list, and SSH file transfer methods are reused by project tools. Without file ops, project tools cannot safely read files.

2. **Project intelligence second** because it introduces the registry client (a new client pattern alongside proxmox.ts and ssh.ts) and depends on safe file reading from Phase 1. Project browsing and analysis are the highest user-value features -- they make Jarvis useful for daily development work, not just cluster management.

3. **Voice retraining last** because it is the most complex (Docker exec orchestration, long-running processes, service lifecycle management) and the most self-contained (no other features depend on it). If it ships later, no other features are blocked. It also requires the TTS container to be running, which is a separate deployment concern.

### Dependency Graph

```
Phase 1: File Operations
    |
    +-- sanitizePath() function
    |     |
    |     +-- Used by: Phase 2 project tools (path containment)
    |     +-- Used by: Phase 3 voice tools (path validation)
    |
    +-- ssh.ts getFileFromNode()
    |     |
    |     +-- Used by: download_file tool
    |     +-- Potentially used by: project file download (future)
    |
    +-- api/files.ts download endpoint
          |
          +-- Self-contained, no downstream deps

Phase 2: Project Intelligence
    |
    +-- clients/registry.ts
    |     |
    |     +-- Used by: all project tools
    |     +-- Potentially used by: system prompt context (future)
    |
    +-- Phase 1 file reading capability (read_file pattern)

Phase 3: Voice Retraining
    |
    +-- No downstream dependents
    +-- Phase 1 path validation (sanitizePath)
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Agent-Per-Node for File Access

**What:** Deploying a file access daemon/agent on each cluster node.

**Why bad for this project:**
- Adds 4 new services to maintain across the cluster
- Each agent needs security (auth, encryption, access control)
- The SSH infrastructure already provides authenticated, encrypted file access
- More moving parts = more failure modes
- The management overhead vastly exceeds the benefit

**Instead:** Use existing SSH connections via `node-ssh`. The SSH pool in `clients/ssh.ts` already handles connection lifecycle, reconnection, and pooling. File transfer is a native SSH capability.

### Anti-Pattern 2: Exposing Raw File Paths to Claude

**What:** Letting Claude construct arbitrary filesystem paths from user descriptions.

**Why bad:**
- Path traversal attacks via prompt injection
- Claude might construct paths to sensitive files
- User input + LLM reasoning + filesystem = large attack surface

**Instead:** All paths go through `sanitizePath()` validation. Blocked paths are defined declaratively in `PROTECTED_PATHS`. The tool handler validates before executing. For project tools, paths are additionally contained to the project directory.

### Anti-Pattern 3: Synchronous Training in Tool Handler

**What:** Running voice model fine-tuning synchronously in the MCP tool handler and making Claude wait 30-90 minutes for the result.

**Why bad:**
- The agentic loop has a max iteration limit (10 iterations)
- HTTP/WebSocket timeouts will kill the connection long before training completes
- The frontend will show a "thinking" spinner for 30+ minutes
- Resource-intensive training blocks all other TTS requests

**Instead:** For `retrain_voice_model`:
- Start training as a background process: `docker exec -d jarvis-tts python3 /training/finetune_xtts.py`
- Return immediately with "Training started, use get_training_log to monitor progress"
- Claude can periodically check `get_training_log` to report status
- When complete, a separate `apply_trained_model` tool extracts weights and restarts the container

Actually, there is a simpler approach: since the `execOnNodeByName()` function has a configurable timeout (default 30s), simply set a very long timeout for training commands (e.g., 120 minutes). The SSH connection will stream stdout back. The loop.ts tool execution timeout should be extended for this specific tool. However, the agentic loop continues after receiving the tool result, so Claude will process the result when training completes.

**Recommended approach:** Background process with monitoring. Start training detached, return immediately, let the user check progress via `get_training_log`.

### Anti-Pattern 4: Caching Registry Forever

**What:** Fetching the project registry once at startup and never refreshing.

**Why bad:**
- Projects change (new deployments, moved files, deleted projects)
- Registry is updated by the File Organizer agent every 6 hours
- Stale data leads to "project not found" errors when projects have moved

**Instead:** Cache with 5-minute TTL. The registry is a small JSON file (~5KB for 24 projects); fetching it via SSH is fast (<100ms). Provide a `refreshRegistry()` method for explicit invalidation.

### Anti-Pattern 5: Sharing Sanitization Logic Between execute_ssh and File Tools

**What:** Running file tool commands through the same `sanitizeCommand()` allowlist used by `execute_ssh`.

**Why bad:**
- The allowlist is designed for user-facing SSH commands, not internally constructed commands
- File tools would need to add generic commands like `cat`, `find`, `grep` to the allowlist
- Adding generic `cat` to the allowlist weakens security for `execute_ssh` (users could `cat /etc/shadow`)
- The safety models are different: execute_ssh validates user-provided commands; file tools validate user-provided paths

**Instead:** Separate safety models:
- `execute_ssh`: Command allowlist/blocklist (existing, unchanged)
- File tools: Path sanitization + protected paths (new, orthogonal)
- Both share: Input sanitization (`sanitizeInput()`), protected resource checks (`isProtectedResource()`)

---

## Scalability Considerations

| Concern | Current (18 tools) | After (37 tools) | Mitigation |
|---------|---------------------|-------------------|------------|
| Tool count in Claude context | 18 tools ~1500 tokens | 37 tools ~3000 tokens | Still well within Claude's 200K window |
| Tool selection accuracy | Good (18 well-described tools) | May degrade (more tools to choose from) | Group tools by domain in descriptions; test accuracy |
| SSH connection pool | 4 connections (1 per node) | Same 4 connections | Pool already handles concurrent use |
| Registry fetch overhead | N/A | ~100ms per SSH + parse | 5-minute cache eliminates most calls |
| File download temp storage | N/A | /tmp fills up | 5-minute TTL cleanup; max file size limit (100MB) |
| Training resource contention | TTS runs on Home CPU | Training blocks TTS | RED tier for training; background execution |

### Tool Count and Claude Selection Quality

With 37 tools, Claude will receive approximately 3000 additional context tokens for tool definitions. This is well within budget. However, more tools means more opportunity for Claude to select the wrong tool.

Mitigation: **Excellent tool descriptions are critical.** The existing `ai/tools.ts` already uses handcrafted descriptions optimized for Claude's tool selection. Continue this pattern. Each new tool description should:
- Clearly state WHEN to use it (not just what it does)
- Distinguish from similar tools (e.g., `read_file` vs `read_project_file`)
- Include example triggers ("Use when the user asks to...")

---

## Sources

### HIGH Confidence (Verified Against Codebase)

- All component details verified by reading every TypeScript source file in jarvis-backend/src/
- TTS pipeline verified by reading server.py, finetune_xtts.py, compute_speaker_embedding.py, extract_gpt_weights.py
- Docker configuration verified from /opt/jarvis-tts/docker-compose.yml and Dockerfile
- Registry structure verified by fetching live registry.json from agent1
- Voice training data verified from metadata.csv (10 clips, LJSpeech format)
- Shell helper scripts verified from extract-voice.sh and prepare-audio.sh
- SSH client capabilities verified from node-ssh library usage in clients/ssh.ts

### HIGH Confidence (Architecture Patterns)

- MCP tool registration pattern: Verified from 3 existing tool files (cluster.ts, lifecycle.ts, system.ts)
- Safety tier pipeline: Verified from server.ts executeTool() + tiers.ts checkSafety()
- Sanitization pipeline: Verified from sanitize.ts (allowlist/blocklist/metacharacter detection)
- Agentic loop flow: Verified from loop.ts (GREEN/YELLOW auto-exec, RED confirmation, BLACK block)

### MEDIUM Confidence (Implementation Details)

- node-ssh file transfer methods (getFile/putFile): Based on node-ssh library documentation
- Docker exec for training: The commands exist in the training scripts; orchestrating via SSH + docker exec is standard
- Path sanitization approach: Standard filesystem security pattern; specific PROTECTED_PATHS list needs validation

### LOW Confidence (Needs Validation)

- Training duration estimates (30-90 min): Based on single data point from existing finetune.log
- Claude tool selection quality with 37 tools: Empirical testing needed
- Background training process reliability: docker exec -d behavior with long-running Python scripts needs testing

---

*Architecture research for file operations, project intelligence, and voice retraining: 2026-01-26*

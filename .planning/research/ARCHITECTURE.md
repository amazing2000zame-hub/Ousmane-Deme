# Architecture Patterns

**Domain:** AI-powered infrastructure management dashboard (Proxmox homelab cluster)
**Researched:** 2026-01-26
**Overall Confidence:** HIGH (verified against existing infrastructure, MCP spec, and current ecosystem patterns)

---

## Recommended Architecture

### High-Level Overview

Jarvis 3.1 is a **6-component system** deployed as Docker containers on the management VM (192.168.1.65), with external connections to the Proxmox cluster nodes and the local LLM server on Home (192.168.1.50).

```
+------------------------------------------------------------------+
|  Management VM (192.168.1.65) - Docker Compose                    |
|                                                                    |
|  +------------------+     +------------------+                     |
|  |  Nginx Reverse   |---->|  React Frontend  |                     |
|  |  Proxy (:80/443) |     |  (static, :3004) |                     |
|  +--------+---------+     +------------------+                     |
|           |                                                        |
|           |  /api/* /ws/*                                          |
|           v                                                        |
|  +------------------+     +------------------+                     |
|  |  API Gateway     |<--->|  MCP Server      |                     |
|  |  (Express :4000) |     |  (in-process)    |                     |
|  +--------+---------+     +--------+---------+                     |
|           |                        |                               |
|           v                        v                               |
|  +------------------+     +------------------+                     |
|  |  Monitor Service |     |  Memory Store    |                     |
|  |  (event loop)    |     |  (SQLite)        |                     |
|  +------------------+     +------------------+                     |
+------------------------------------------------------------------+
           |                        |
           v                        v
  +------------------+     +------------------+
  | Proxmox Nodes    |     | LLM Endpoints    |
  | (SSH + API:8006) |     | Claude API (ext) |
  | 192.168.1.50/74/ |     | Qwen (local)     |
  | 61/62            |     | 192.168.1.50:8080|
  +------------------+     +------------------+
```

### Architecture Style: Modular Monolith

**NOT microservices.** For a homelab with one developer and one management VM, a modular monolith in a single Node.js process is the right call. The components share an event bus and can import each other directly. Docker containers separate the frontend (static files served by Nginx) from the backend (single Node.js process), but the backend itself is one process with clean module boundaries.

**Rationale:**
- Only 4 CPU cores and 8GB RAM on management VM (already running 16 containers)
- Single developer -- no team coordination overhead to justify microservices
- All components need shared state (cluster status, memory, event bus)
- Inter-process communication overhead is unnecessary at this scale
- Easier debugging, deployment, and monitoring as one process

---

## Component Boundaries

### Component 1: React Frontend (Static SPA)

| Aspect | Detail |
|--------|--------|
| **Responsibility** | eDEX-UI / Iron Man visual dashboard, chat interface, terminal emulator, real-time cluster visualization |
| **Technology** | React 19 + TypeScript + Vite + Tailwind CSS |
| **Deployment** | Multi-stage Docker build -> Nginx serves static files |
| **Port** | :3004 (or behind Nginx Proxy Manager at :80) |
| **Communicates with** | API Gateway via REST + WebSocket |
| **State** | React state + Zustand for global state (cluster data, chat history, UI state) |
| **Does NOT** | Talk to Proxmox, LLMs, or SQLite directly |

**Key frontend subsystems:**
- **Dashboard panels**: 3-column layout (cluster status, Jarvis activity, system terminal)
- **Real-time data layer**: WebSocket connection for push updates + REST for initial load
- **Chat interface**: Streaming LLM responses via SSE or WebSocket
- **Terminal emulator**: xterm.js with WebSocket PTY backend
- **Visualization**: Canvas/SVG for node topology, resource gauges, network graph

### Component 2: API Gateway (Express + WebSocket Server)

| Aspect | Detail |
|--------|--------|
| **Responsibility** | HTTP API, WebSocket server, request routing, authentication, rate limiting |
| **Technology** | Express 5 + ws (WebSocket) + JWT auth |
| **Port** | :4000 (internal to Docker network) |
| **Communicates with** | Frontend (HTTP/WS), MCP Server (in-process), Monitor Service (events), Memory Store (queries) |
| **Does NOT** | Talk to Proxmox or LLMs directly (delegates to MCP Server) |

**API surface:**

```
REST Endpoints:
  GET  /api/cluster/status      -- Full cluster state snapshot
  GET  /api/cluster/resources   -- VMs, containers, storage
  GET  /api/nodes/:id           -- Single node detail
  POST /api/nodes/:id/wake      -- Wake-on-LAN
  GET  /api/memory/events       -- Recent events from memory
  GET  /api/memory/context      -- Current LLM context
  POST /api/chat                -- Send message to Jarvis (returns stream)
  GET  /api/health              -- System health check

WebSocket Channels:
  ws://host/ws/cluster          -- Real-time cluster data push (SSE-like)
  ws://host/ws/chat             -- Bidirectional chat with streaming responses
  ws://host/ws/terminal/:node   -- PTY terminal to cluster node
  ws://host/ws/events           -- Jarvis activity feed (actions, alerts, status)
```

**Why WebSocket over SSE for the primary data channel:**

The dashboard needs WebSocket for two reasons:
1. **Terminal emulation** requires bidirectional communication (user types, server sends output). This is non-negotiable -- xterm.js requires WebSocket.
2. **Chat interface** benefits from bidirectional flow (send message + receive streaming response on same connection).

However, for **cluster status updates** (server-to-client only), SSE would be simpler. The recommendation is to use a **single WebSocket connection multiplexed across channels** rather than mixing protocols. This avoids the complexity of managing both SSE and WebSocket connections, and WebSocket is already required for terminal and chat.

**Multiplexed WebSocket Protocol:**

```typescript
// All messages on a single WebSocket connection use a channel envelope
interface WSMessage {
  channel: 'cluster' | 'chat' | 'events' | 'terminal';
  type: string;           // channel-specific message type
  payload: unknown;       // channel-specific data
  requestId?: string;     // for request-response correlation
}

// Examples:
{ channel: 'cluster', type: 'status_update', payload: { nodes: [...] } }
{ channel: 'chat', type: 'token', payload: { content: 'Hello' } }
{ channel: 'events', type: 'action', payload: { action: 'restart_vm', vmid: 100 } }
{ channel: 'terminal', type: 'output', payload: { data: '...' } }
```

**Alternative considered:** Separate WebSocket connections per feature. Rejected because the management VM has limited resources and connection overhead matters. Multiplexing is standard practice (Socket.IO rooms, GraphQL subscriptions).

**Update cadence for cluster data:**

| Data Type | Method | Frequency | Rationale |
|-----------|--------|-----------|-----------|
| Node status (up/down) | WebSocket push | Every 10s | Critical, must be near-real-time |
| Resource usage (CPU/RAM/disk) | WebSocket push | Every 15s | Balance between freshness and Proxmox API load |
| VM/container status | WebSocket push | Every 15s + on-change | Most changes are manual, but detect crash fast |
| Temperature | WebSocket push | Every 30s | Slow-changing metric |
| Storage details | REST on-demand | On page load + manual refresh | Rarely changes |
| Jarvis activity feed | WebSocket push | On event | Event-driven, no polling |

### Component 3: MCP Server (In-Process Module)

| Aspect | Detail |
|--------|--------|
| **Responsibility** | Tool registry, tool execution, Proxmox API interaction, SSH command execution, Docker management |
| **Technology** | @modelcontextprotocol/sdk (TypeScript), in-process with API Gateway |
| **Protocol** | MCP over in-process function calls (NOT stdio, NOT HTTP) |
| **Communicates with** | API Gateway (called by), Proxmox nodes (SSH/API), Docker daemon, Memory Store (logs actions) |
| **Does NOT** | Handle HTTP requests, manage WebSocket connections, or talk to LLMs directly |

**Why in-process instead of stdio/HTTP transport:**

The MCP spec defines stdio and Streamable HTTP transports for when the server is a separate process. But in Jarvis 3.1, the MCP server is part of the same Node.js process as the API Gateway. This is deliberate:
- No serialization overhead for tool calls
- Shared memory for cluster state cache
- Simpler deployment (one process, one container)
- The API Gateway IS the MCP client -- it calls tools programmatically when the LLM requests them

The MCP SDK's `McpServer` class is used for tool registration and schema validation, but the transport is replaced with direct function calls. If a future need arises (e.g., external MCP client access), a stdio or HTTP transport can be added as a thin adapter.

**Tool Registry (organized by domain):**

```typescript
// Tool categories and their tools
const TOOL_CATEGORIES = {
  // CLUSTER MONITORING (read-only, always safe)
  'cluster.status':          'Get full cluster status (nodes, quorum, health)',
  'cluster.resources':       'List all VMs/containers across cluster',
  'cluster.node_detail':     'Get detailed info for a specific node',
  'cluster.storage':         'List storage pools and usage',

  // VM/CONTAINER MANAGEMENT (write, requires confirmation for destructive)
  'vm.list':                 'List VMs on a node or cluster-wide',
  'vm.status':               'Get VM status and resource usage',
  'vm.start':                'Start a stopped VM',
  'vm.stop':                 'Stop a running VM (graceful)',
  'vm.shutdown':             'Shutdown a VM via ACPI',
  'vm.restart':              'Restart a VM',
  'container.list':          'List LXC containers',
  'container.start':         'Start a container',
  'container.stop':          'Stop a container',

  // SYSTEM COMMANDS (write, SSH-based)
  'system.exec':             'Execute a shell command on a node via SSH',
  'system.service_status':   'Check systemd service status',
  'system.service_restart':  'Restart a systemd service',
  'system.updates':          'Check available package updates',
  'system.reboot':           'Reboot a node (DANGEROUS)',

  // DOCKER MANAGEMENT (write, management VM only)
  'docker.list':             'List Docker containers',
  'docker.status':           'Get container status and logs',
  'docker.restart':          'Restart a Docker container',
  'docker.logs':             'Get recent logs from a container',

  // NETWORK
  'network.ping':            'Ping a host',
  'network.wake':            'Send Wake-on-LAN packet',

  // MEMORY (read, queries memory store)
  'memory.recent_events':    'Get recent cluster events',
  'memory.search':           'Search event history',
  'memory.context':          'Get current context summary for LLM',
};
```

**Safety boundaries (3-tier model):**

```typescript
enum ToolRisk {
  READ = 'read',           // Always safe: status queries, list operations
  WRITE = 'write',         // Modifies state: start/stop VM, restart service
  DANGEROUS = 'dangerous', // Could cause outage: reboot node, delete VM
}

// Safety enforcement:
// READ     -> Execute immediately, no confirmation
// WRITE    -> Execute, log to memory, report to user
// DANGEROUS -> Require explicit user confirmation via chat before executing
//              OR require autonomous mode to be enabled for auto-remediation
```

**Proxmox API integration pattern:**

```typescript
// Use Proxmox REST API directly (not pvesh CLI)
// Reason: Management VM is NOT a Proxmox node, so pvesh is not available
// The API Gateway runs on the management VM (192.168.1.65), which is a
// regular Ubuntu VM, not a PVE host.

class ProxmoxClient {
  // Authenticate via API token (not password)
  // Token configured per-node or cluster-wide
  constructor(config: {
    host: string;           // e.g., '192.168.1.50'
    tokenId: string;        // e.g., 'root@pam!jarvis'
    tokenSecret: string;    // the API token value
    verifySsl: boolean;     // false for self-signed certs
  }) {}

  async get(path: string): Promise<any>;   // GET /api2/json/{path}
  async post(path: string, data?: any): Promise<any>;
}

// SSH client for node-level commands
class SSHClient {
  // Uses ssh2 library (pure JS, no child_process)
  // Connection pooling: maintain persistent connections to each node
  // Timeout: 10s connect, 30s command, 300s for long operations
  constructor(config: {
    host: string;
    username: string;       // 'root'
    privateKey: Buffer;     // from /root/.ssh/id_ed25519
  }) {}

  async exec(command: string, timeout?: number): Promise<string>;
}
```

**Critical design decision: Proxmox REST API vs pvesh CLI**

The existing proxmox-ui codebase uses `pvesh` CLI commands via `child_process.exec()`. This only works when running ON a Proxmox node. The management VM (192.168.1.65) is a regular Ubuntu VM, so `pvesh` is not available. Jarvis 3.1 MUST use the Proxmox REST API over HTTPS (port 8006) instead. This is actually better:
- Proper API with JSON responses (no shell parsing)
- API tokens instead of PAM passwords
- Connection pooling possible
- No command injection risk
- Works from any network location

### Component 4: LLM Router (Hybrid Intelligence Layer)

| Aspect | Detail |
|--------|--------|
| **Responsibility** | Route requests to appropriate LLM, manage context window, stream responses, handle tool calls |
| **Technology** | Custom router module, Anthropic SDK (Claude), OpenAI-compatible client (Qwen) |
| **Communicates with** | API Gateway (called by), Claude API (external), Qwen/llama-server (192.168.1.50:8080), MCP Server (tool execution), Memory Store (context retrieval) |
| **Does NOT** | Handle HTTP, manage UI state, or access Proxmox directly |

**Routing Strategy: Confidence-Based Cascading**

```typescript
interface LLMRouter {
  // Route a user message to the appropriate LLM
  route(message: string, context: ConversationContext): Promise<LLMResponse>;
}

// Decision tree:
//
// 1. Is this a TOOL CALL request? (e.g., "restart VM 100", "check cluster status")
//    YES -> Use Qwen locally for intent extraction + tool parameter parsing
//           Then execute tool via MCP Server
//           Then format response with Qwen
//    NO  -> Continue to step 2
//
// 2. Is this a COMPLEX reasoning task?
//    Indicators: multi-step analysis, "explain why", "what should I do about",
//                debugging a problem, architectural questions, long responses
//    YES -> Use Claude API
//    NO  -> Continue to step 3
//
// 3. Is this a ROUTINE task?
//    Indicators: status queries, simple questions, acknowledgments,
//                "what time is it", personality/chat
//    YES -> Use Qwen locally
//    NO  -> Default to Claude API (when in doubt, use the smarter model)
```

**Why this routing strategy:**

| Criterion | Qwen 2.5 7B (Local) | Claude API (Cloud) |
|-----------|---------------------|-------------------|
| Latency | ~150ms first token | ~500-1500ms first token |
| Speed | ~6.5 tok/s generation | ~50+ tok/s generation |
| Cost | Free (electricity only) | ~$3-15/MTok |
| Context | 4096 tokens | 200K tokens |
| Tool use | Basic (needs structured prompts) | Native tool use |
| Reasoning | Good for simple tasks | Excellent for complex analysis |
| Availability | Always (LAN only) | Requires internet |

**Practical routing rules:**

```typescript
enum LLMTarget {
  LOCAL = 'local',    // Qwen 2.5 7B on 192.168.1.50:8080
  CLOUD = 'cloud',    // Claude API
}

function classifyRequest(message: string, context: ConversationContext): LLMTarget {
  // Rule 1: If internet is down, always use local
  if (!internetAvailable) return LLMTarget.LOCAL;

  // Rule 2: Simple tool calls -> local
  // Pattern: imperative commands like "start X", "check Y", "show Z"
  if (isSimpleToolCall(message)) return LLMTarget.LOCAL;

  // Rule 3: Status queries with known format -> local
  if (isStatusQuery(message)) return LLMTarget.LOCAL;

  // Rule 4: Conversational/personality -> local
  if (isSmallTalk(message)) return LLMTarget.LOCAL;

  // Rule 5: Complex analysis, debugging, multi-step -> cloud
  if (isComplexReasoning(message)) return LLMTarget.CLOUD;

  // Rule 6: Long context needed (>3000 tokens in context) -> cloud
  if (context.totalTokens > 3000) return LLMTarget.CLOUD;

  // Rule 7: User explicitly requests Claude -> cloud
  if (message.includes('@claude') || message.includes('think harder'))
    return LLMTarget.CLOUD;

  // Default: local for speed, unless conversation is going deep
  return context.messageCount > 5 ? LLMTarget.CLOUD : LLMTarget.LOCAL;
}
```

**Tool calling implementation:**

For Claude: Use native tool use (function calling). Claude receives tool definitions and returns structured tool_use blocks. The API Gateway executes the tool via MCP Server and returns results.

For Qwen: Use structured prompt engineering. Qwen 2.5 7B supports function calling via a specific prompt format, but reliability is lower than Claude. Use a two-step pattern:
1. Send message with tool descriptions in system prompt
2. Parse Qwen's response for tool call intent (JSON extraction)
3. If parsing fails, fall back to keyword matching for common commands
4. Execute tool and format response

**Fallback chain:**
```
Claude API (primary for complex)
  -> timeout/error -> retry once
  -> still fails -> fall back to Qwen local
  -> Qwen local fails -> return error message with personality
```

### Component 5: Memory Store (SQLite + Context Engine)

| Aspect | Detail |
|--------|--------|
| **Responsibility** | Persist events, actions, cluster snapshots, conversation history. Build LLM context. |
| **Technology** | better-sqlite3 (synchronous, fast), sqlite-vec for optional vector search |
| **Location** | Docker volume mounted at /data/jarvis.db |
| **Communicates with** | API Gateway (queries), MCP Server (writes events), LLM Router (provides context) |
| **Does NOT** | Make decisions, call APIs, or manage connections |

**Schema:**

```sql
-- Core tables
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,          -- 'alert', 'action', 'status', 'chat', 'metric'
  severity TEXT DEFAULT 'info', -- 'info', 'warning', 'error', 'critical'
  source TEXT NOT NULL,         -- 'monitor', 'user', 'jarvis', 'system'
  node TEXT,                    -- which node, if applicable
  summary TEXT NOT NULL,        -- human-readable one-liner
  details TEXT,                 -- JSON blob with full details
  resolved BOOLEAN DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT              -- 'jarvis' or 'user'
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,     -- groups messages in a conversation
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT NOT NULL,           -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  model TEXT,                   -- 'claude', 'qwen', null
  tokens_used INTEGER,
  tool_calls TEXT               -- JSON array of tool calls made
);

CREATE TABLE cluster_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  snapshot TEXT NOT NULL        -- JSON: full cluster state at point in time
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for fast context retrieval
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_node ON events(node);
CREATE INDEX idx_events_unresolved ON events(resolved) WHERE resolved = 0;
CREATE INDEX idx_conversations_session ON conversations(session_id);
```

**Context injection pattern (how memory feeds the LLM):**

```typescript
interface ContextBuilder {
  // Build a context string for the LLM system prompt
  // This is injected BEFORE the user's message
  buildContext(): Promise<string>;
}

// The context is a structured markdown document:
function buildLLMContext(): string {
  return `
## Current Cluster State
${formatClusterStatus(latestSnapshot)}

## Recent Events (last 1 hour)
${formatRecentEvents(recentEvents)}

## Unresolved Issues
${formatUnresolvedIssues(unresolvedEvents)}

## Recent Actions Taken
${formatRecentActions(recentActions)}

## User Preferences
${formatPreferences(preferences)}
  `.trim();
}
```

**Context window management:**

```
For Qwen (4096 token context):
  - System prompt (personality):     ~300 tokens
  - Context injection (cluster):     ~500-800 tokens (aggressive trimming)
  - Conversation history:            ~1500-2000 tokens (last 4-6 messages)
  - User message + response space:   ~1000-1500 tokens

  Strategy: Keep context SMALL. Only include:
  - Current node status (1 line per node)
  - Last 3 unresolved events
  - Last 2 actions taken
  - Last 4 conversation messages

For Claude (200K token context):
  - System prompt (personality):     ~500 tokens
  - Context injection (cluster):     ~2000-5000 tokens (full detail)
  - Conversation history:            ~5000-20000 tokens (full session)
  - User message + response space:   ~190K+ tokens

  Strategy: Be GENEROUS. Include:
  - Full cluster state with all nodes, VMs, storage
  - All unresolved events
  - All actions in last 24 hours
  - Full conversation history for session
  - Relevant past conversation snippets (searched by topic)
```

**Why better-sqlite3 instead of async SQLite:**

better-sqlite3 is synchronous, which sounds wrong for Node.js but is actually correct here:
- SQLite queries on a local file complete in microseconds (not milliseconds)
- No I/O wait -- the file is memory-mapped by the OS
- Synchronous API eliminates callback complexity
- better-sqlite3 is 5-10x faster than async alternatives for SQLite
- Used by Drizzle ORM, Turso, and many production Node.js apps

### Component 6: Monitor Service (Autonomous Event Loop)

| Aspect | Detail |
|--------|--------|
| **Responsibility** | Periodic health checks, anomaly detection, autonomous remediation, alert generation |
| **Technology** | Node.js setInterval + EventEmitter pattern |
| **Communicates with** | MCP Server (executes checks via tools), Memory Store (reads/writes events), LLM Router (for complex diagnosis), API Gateway (pushes events to frontend) |
| **Does NOT** | Handle HTTP, manage UI, or talk to Proxmox directly (uses MCP tools) |

**Event loop architecture:**

```typescript
class MonitorService extends EventEmitter {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  start() {
    // Tier 1: Critical (every 10 seconds)
    this.schedule('node_heartbeat', 10_000, this.checkNodeHeartbeats);

    // Tier 2: Important (every 30 seconds)
    this.schedule('vm_status', 30_000, this.checkVMStatus);
    this.schedule('resource_usage', 30_000, this.checkResourceUsage);

    // Tier 3: Routine (every 5 minutes)
    this.schedule('storage_health', 300_000, this.checkStorageHealth);
    this.schedule('service_status', 300_000, this.checkCriticalServices);
    this.schedule('temperature', 300_000, this.checkTemperatures);

    // Tier 4: Background (every 30 minutes)
    this.schedule('update_check', 1_800_000, this.checkUpdates);
    this.schedule('cluster_snapshot', 1_800_000, this.takeClusterSnapshot);
  }
}
```

**Remediation pipeline:**

```
Detection -> Classification -> Decision -> Action -> Verification -> Report

1. DETECTION
   Monitor check detects anomaly
   Example: Node 'agent' not responding to ping

2. CLASSIFICATION
   Compare against known patterns
   Example: Node down -> severity: CRITICAL

3. DECISION (autonomous vs. notify)
   if (severity == CRITICAL && autoRemediate) {
     // Known fix available?
     if (knownRemediations[issue]) -> proceed to ACTION
     else -> ESCALATE to LLM for diagnosis
   }
   if (severity == WARNING) -> LOG and NOTIFY user
   if (severity == INFO) -> LOG only

4. ACTION
   Execute remediation via MCP tools
   Example: Send Wake-on-LAN to 'agent' node

5. VERIFICATION
   Wait and re-check
   Example: Wait 60s, ping agent again

6. REPORT
   Log event to memory, push to frontend, optionally email
   Example: "Node 'agent' was down. Sent WOL. Node recovered in 45s."
```

**Known remediation playbooks:**

```typescript
const REMEDIATIONS: Record<string, RemediationPlaybook> = {
  'node_unreachable': {
    steps: [
      { action: 'network.ping', retries: 3, delay: 5000 },
      { action: 'network.wake', wait: 60000 },
      { action: 'network.ping', retries: 5, delay: 10000 },
    ],
    escalate_if_failed: true,
    max_auto_attempts: 2,
  },
  'vm_crashed': {
    steps: [
      { action: 'vm.status', /* verify it's actually down */ },
      { action: 'vm.start', wait: 30000 },
      { action: 'vm.status', /* verify it came up */ },
    ],
    escalate_if_failed: true,
    max_auto_attempts: 1,
  },
  'service_down': {
    steps: [
      { action: 'system.service_status', /* confirm down */ },
      { action: 'system.service_restart', wait: 10000 },
      { action: 'system.service_status', /* verify up */ },
    ],
    escalate_if_failed: true,
    max_auto_attempts: 2,
  },
  'high_cpu': {
    // No auto-remediation -- just alert and log
    steps: [],
    notify: true,
    escalate_to_llm: true, // Ask Claude to analyze what's causing it
  },
  'disk_full': {
    // No auto-remediation -- too dangerous
    steps: [],
    notify: true,
    severity: 'critical',
    escalate_to_llm: true,
  },
};
```

---

## Data Flow

### Flow 1: User Opens Dashboard (Initial Load)

```
Browser                API Gateway              MCP Server          Proxmox Nodes
  |                       |                        |                     |
  |-- GET /api/cluster -->|                        |                     |
  |                       |-- cluster.status() --->|                     |
  |                       |                        |-- GET /api2/json -->|
  |                       |                        |<-- JSON response ---|
  |                       |<-- ClusterState -------|                     |
  |<-- JSON response -----|                        |                     |
  |                       |                        |                     |
  |-- WS /ws/cluster ---->|                        |                     |
  |   (upgrade)           |                        |                     |
  |<== connected =========|                        |                     |
  |                       |                        |                     |
  |   [every 15s]         |                        |                     |
  |<== status_update =====|<-- poll via tools ---->|<-- API calls ------>|
```

### Flow 2: User Sends Chat Message

```
Browser            API Gateway       LLM Router        Memory         MCP Server    LLM
  |                    |                |                |                |           |
  |-- WS chat msg ---->|                |                |                |           |
  |                    |-- route() ---->|                |                |           |
  |                    |                |-- getContext()->|                |           |
  |                    |                |<-- context -----|                |           |
  |                    |                |                                 |           |
  |                    |                |-- classify request              |           |
  |                    |                |-- (local or cloud?)             |           |
  |                    |                |                                 |           |
  |                    |                |-- stream request -------------------------------->|
  |                    |                |<-- token stream -----------------------------------|
  |                    |<-- tokens -----|                                 |           |
  |<== WS tokens ======|                |                                |           |
  |                    |                |                                 |           |
  |                    |                |   [if tool_use in response]     |           |
  |                    |                |-- execute tool ---------------->|           |
  |                    |                |<-- tool result -----------------|           |
  |                    |                |-- continue with result ---------------------->|
  |                    |                |<-- more tokens --------------------------------|
  |<== WS tokens ======|<-- tokens -----|                                |           |
  |                    |                |                                 |           |
  |                    |                |-- saveConversation() --------->|            |
```

### Flow 3: Autonomous Monitoring Detects Issue

```
Monitor Service     MCP Server      Proxmox       Memory       LLM Router     API Gateway
  |                    |               |              |              |              |
  |-- checkNodes() --->|               |              |              |              |
  |                    |-- ping ------>|              |              |              |
  |                    |<-- timeout ---|              |              |              |
  |<-- node_down ------|               |              |              |              |
  |                    |               |              |              |              |
  |-- logEvent() ------------------------------------>|              |              |
  |                    |               |              |              |              |
  |-- pushEvent() ----------------------------------------------------------->|
  |                    |               |              |              |   (WS push to frontend)
  |                    |               |              |              |              |
  |-- remediate:WOL -->|               |              |              |              |
  |                    |-- WOL pkt --->|              |              |              |
  |                    |<-- sent ------|              |              |              |
  |                    |               |              |              |              |
  |   [wait 60s]       |               |              |              |              |
  |-- verify: ping --->|               |              |              |              |
  |                    |-- ping ------>|              |              |              |
  |                    |<-- success ---|              |              |              |
  |<-- node_up --------|               |              |              |              |
  |                    |               |              |              |              |
  |-- logResolution() ------------------------------->|              |              |
  |-- pushEvent() ----------------------------------------------------------->|
```

### Flow 4: Terminal Session

```
Browser (xterm.js)     API Gateway          SSH Client         Cluster Node
  |                       |                     |                   |
  |-- WS /ws/terminal --->|                     |                   |
  |   {node: 'pve'}       |                     |                   |
  |                       |-- ssh connect() --->|                   |
  |                       |                     |-- SSH handshake ->|
  |                       |                     |<-- shell ready ---|
  |<== connected =========|                     |                   |
  |                       |                     |                   |
  |== keystroke =========>|                     |                   |
  |                       |-- write to PTY ---->|-- stdin --------->|
  |                       |<-- PTY output ------|<-- stdout --------|
  |<== output ============|                     |                   |
  |                       |                     |                   |
  |== resize event ======>|                     |                   |
  |                       |-- resize PTY ------>|                   |
```

---

## Inter-Component Communication

### Internal (within Node.js process)

| From | To | Method | Why |
|------|----|--------|-----|
| API Gateway | MCP Server | Direct function call | Same process, no serialization needed |
| API Gateway | LLM Router | Direct function call | Same process |
| API Gateway | Memory Store | Direct function call (sync) | better-sqlite3 is synchronous |
| API Gateway | Monitor Service | EventEmitter | Loose coupling, monitor emits events |
| Monitor Service | MCP Server | Direct function call | Execute tools |
| Monitor Service | Memory Store | Direct function call | Log events |
| Monitor Service | LLM Router | Direct function call | Escalate complex issues |
| LLM Router | MCP Server | Direct function call | Execute tool calls from LLM |
| LLM Router | Memory Store | Direct function call | Get context, save conversations |

### External (network calls)

| From | To | Protocol | Port | Auth |
|------|----|----------|------|------|
| Frontend | API Gateway | HTTP + WebSocket | :4000 (via Nginx) | JWT token |
| API Gateway (via MCP) | Proxmox Nodes | HTTPS | :8006 | API token |
| API Gateway (via MCP) | Proxmox Nodes | SSH | :22 | SSH key |
| LLM Router | Claude API | HTTPS | :443 | API key |
| LLM Router | Qwen/llama-server | HTTP | :8080 | None (LAN) |
| Monitor Service (via MCP) | WOL API | HTTP | :3005 | None (LAN) |

---

## Docker Deployment Architecture

### Container Layout

```yaml
# docker-compose.yml for Jarvis 3.1
services:
  # Frontend: React SPA served by Nginx
  jarvis-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile  # multi-stage: node build -> nginx serve
    ports:
      - "3004:80"             # or behind nginx-proxy-manager
    networks:
      - jarvis-net
    restart: unless-stopped

  # Backend: Node.js API + MCP + Monitor + Memory
  jarvis-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "4000:4000"           # internal, not exposed publicly
    volumes:
      - jarvis-data:/data     # SQLite database
      - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro  # SSH key for node access
    environment:
      - NODE_ENV=production
      - PORT=4000
      - CLAUDE_API_KEY=${CLAUDE_API_KEY}
      - QWEN_API_URL=http://192.168.1.50:8080
      - PROXMOX_NODES=192.168.1.50,192.168.1.74,192.168.1.61,192.168.1.62
      - PROXMOX_TOKEN_ID=root@pam!jarvis
      - PROXMOX_TOKEN_SECRET=${PROXMOX_TOKEN_SECRET}
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/data/jarvis.db
      - WOL_API_URL=http://192.168.1.65:3005
    networks:
      - jarvis-net
    restart: unless-stopped
    depends_on:
      - jarvis-frontend

volumes:
  jarvis-data:
    driver: local

networks:
  jarvis-net:
    driver: bridge
```

### Nginx Configuration (frontend container)

```nginx
server {
    listen 80;

    # Serve React SPA
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;  # SPA fallback
    }

    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://jarvis-backend:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Proxy WebSocket connections to backend
    location /ws/ {
        proxy_pass http://jarvis-backend:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;  # Keep WS alive for 24h
    }
}
```

### Resource Budget on Management VM

```
Current usage:  2.3 GB RAM, 16 containers running
Available:      5.5 GB RAM, 4 CPUs, 31 GB disk free

Jarvis 3.1 budget:
  jarvis-frontend:  ~50 MB RAM (Nginx + static files)
  jarvis-backend:   ~200-400 MB RAM (Node.js + SQLite + SSH connections)
  ---
  Total:            ~250-450 MB RAM

  This is well within budget. Even with spikes during LLM streaming
  and multiple WebSocket connections, staying under 1 GB is realistic.
```

---

## Patterns to Follow

### Pattern 1: Event-Driven Internal Communication

**What:** Use Node.js EventEmitter for loose coupling between Monitor, API Gateway, and Memory.

**When:** Any component produces information another needs asynchronously.

**Example:**
```typescript
// Monitor emits events
monitor.on('alert', (event: ClusterEvent) => {
  memory.saveEvent(event);              // Persist
  gateway.broadcast('events', event);   // Push to all connected clients
});

// API Gateway listens for push events
monitor.on('cluster_update', (status: ClusterStatus) => {
  gateway.broadcast('cluster', { type: 'status_update', payload: status });
});
```

### Pattern 2: Tool Execution Pipeline

**What:** Every tool call goes through a consistent pipeline: validate -> execute -> log -> respond.

**When:** Any MCP tool is invoked (by LLM or by Monitor).

**Example:**
```typescript
async function executeTool(name: string, args: unknown, source: 'llm' | 'monitor' | 'user') {
  // 1. Validate
  const tool = registry.get(name);
  const validated = tool.schema.parse(args);

  // 2. Safety check
  if (tool.risk === 'dangerous' && source === 'llm') {
    return { requiresConfirmation: true, tool: name, args: validated };
  }

  // 3. Execute
  const result = await tool.handler(validated);

  // 4. Log
  memory.saveEvent({
    type: 'action',
    source,
    summary: `${name}(${JSON.stringify(validated)})`,
    details: JSON.stringify(result),
  });

  // 5. Return
  return result;
}
```

### Pattern 3: Graceful Degradation

**What:** Every external dependency has a fallback path.

**When:** Network failures, service outages, API rate limits.

**Example:**
```typescript
// LLM fallback chain
async function chat(message: string): Promise<string> {
  try {
    if (target === 'cloud') {
      return await claudeChat(message);    // Try Claude first
    }
  } catch (e) {
    logger.warn('Claude unavailable, falling back to local');
  }

  try {
    return await qwenChat(message);        // Fall back to local Qwen
  } catch (e) {
    logger.error('Local LLM also unavailable');
  }

  return "I'm having trouble with my language systems. The cluster tools still work -- try a direct command.";
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shell Command Execution via child_process

**What:** Using `exec('pvesh get /nodes')` or `exec('ssh root@host command')` to interact with cluster.

**Why bad:** Command injection risk. No connection pooling. Shell parsing fragility. Only works on PVE nodes.

**Instead:** Use Proxmox REST API via HTTPS (port 8006) with API tokens. Use `ssh2` library for SSH (pure JS, connection pooling, no shell).

### Anti-Pattern 2: Polling from Frontend

**What:** Frontend `setInterval` calling REST endpoints every N seconds for real-time data.

**Why bad:** Unnecessary HTTP overhead. Delayed updates. Increased server load with multiple clients.

**Instead:** WebSocket push from backend. Backend polls Proxmox on schedule, pushes changes to all connected clients. Frontend is purely reactive.

### Anti-Pattern 3: Separate Processes for Each Component

**What:** Running MCP server, monitor, memory store, and API as separate containers/processes.

**Why bad:** IPC overhead. Shared state requires message passing. Complex deployment. Unnecessary for single-user homelab.

**Instead:** Single Node.js process with clean module boundaries. Components communicate via function calls and EventEmitter.

### Anti-Pattern 4: Storing Raw LLM Responses in Context

**What:** Feeding entire previous LLM responses back into the context window.

**Why bad:** Context window fills quickly (especially 4096-token Qwen). Redundant information. Previous responses may contain outdated cluster state.

**Instead:** Store structured summaries. Context injection builds fresh state from current data, not from stale LLM responses.

### Anti-Pattern 5: Direct Database Access from Frontend

**What:** Exposing SQLite queries via REST API without an abstraction layer.

**Why bad:** Couples frontend to database schema. SQL injection risk. No business logic enforcement.

**Instead:** API returns domain objects (ClusterStatus, Event, Conversation). Memory store is accessed only by backend components through a typed repository pattern.

---

## Suggested Build Order (Dependencies)

The components have clear dependency relationships that dictate build order:

```
Phase 1: Foundation
  [Memory Store]  -- no dependencies, foundation for everything
  [MCP Server]    -- needs Proxmox API client, SSH client

Phase 2: Intelligence
  [LLM Router]    -- needs MCP Server (tool execution) + Memory Store (context)

Phase 3: Interface
  [API Gateway]   -- needs MCP Server + LLM Router + Memory Store
  [Frontend]      -- needs API Gateway (API contract)

Phase 4: Autonomy
  [Monitor Service] -- needs MCP Server + Memory Store + LLM Router + API Gateway (push)
```

**Why this order:**

1. **Memory Store first** because every other component writes to or reads from it. Building it first means everything else can log and retrieve data from day one.

2. **MCP Server second** because it is the "hands" of the system -- the only component that actually talks to the cluster. Without tools, neither the LLM nor the monitor can do anything.

3. **LLM Router third** because it needs both tools (MCP) and context (Memory) to function. Building it requires the foundation to already exist.

4. **API Gateway and Frontend together** because the API Gateway is just a thin HTTP/WS layer over the existing components, and the Frontend is the visual consumer. These can be developed in parallel with stub data initially.

5. **Monitor Service last** because it requires all other components to exist. It uses MCP tools to check things, Memory to log events, LLM Router to analyze complex issues, and API Gateway to push updates to the frontend.

---

## Scalability Considerations

| Concern | Current (4 nodes) | At 10 nodes | At 20+ nodes |
|---------|-------------------|-------------|--------------|
| Proxmox API polling | 4 nodes * 15s = manageable | Increase interval to 30s | Batch queries, use Proxmox cluster API |
| WebSocket connections | 1-3 clients | 5-10 clients | Consider Socket.IO rooms for selective updates |
| SQLite performance | Trivial | Still fine (<100K rows) | Consider WAL mode, periodic cleanup |
| SSH connections | 4 persistent | 10 persistent | Connection pool with limits |
| LLM context size | Small cluster = small context | Summarize per-node, don't list all | Hierarchical summaries |

For a 4-node homelab, scalability is a non-concern. The architecture supports growth to ~20 nodes without changes. Beyond that, the modular monolith could be decomposed, but that's far future.

---

## Sources

### HIGH Confidence (Official Documentation + Verified)
- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25) - Protocol architecture, message format, security model
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Server implementation, tool registration, transport options
- [Proxmox VE API Documentation](https://pve.proxmox.com/pve-docs/api-viewer/) - REST API endpoints, authentication

### MEDIUM Confidence (Multiple Sources Agree)
- [SSE vs WebSockets comparison (SoftwareMill)](https://softwaremill.com/sse-vs-websockets-comparing-real-time-communication-protocols/) - Real-time protocol comparison
- [Proxmox MCP Enhanced (GitHub)](https://github.com/chajus1/proxmox-mcp-enhanced) - Tool organization patterns, safety boundaries
- [MCP Proxmox Node.js (GitHub)](https://github.com/gilby125/mcp-proxmox) - Permission levels, TypeScript implementation
- [SQLite RAG patterns](https://www.inferable.ai/blog/posts/sqlite-rag) - SQLite + vector search for LLM context
- [Hybrid LLM routing research](https://journal-isi.org/index.php/isi/article/download/1170/595) - Confidence-based cascading, cost analysis
- [Self-healing infrastructure (WJAETS 2025)](https://journalwjaets.com/sites/default/files/fulltext_pdf/WJAETS-2025-0810.pdf) - Event-driven remediation pipelines

### LOW Confidence (Single Source, Unverified)
- LiteLLM routing specifics for Qwen 2.5 7B - needs validation with actual model
- Qwen 2.5 7B function calling reliability - needs empirical testing
- better-sqlite3 performance claims - likely true but not benchmarked for this specific workload

---

*Architecture research: 2026-01-26*

# Phase 1: Backend Foundation & Safety Layer - Research

**Researched:** 2026-01-26
**Domain:** Node.js backend with MCP tool server, Proxmox REST API integration, SQLite persistence, Docker deployment
**Confidence:** HIGH

## Summary

This research covers the eight specific technical questions needed to plan Phase 1 well: Proxmox API token creation, MCP SDK + Express 5 integration, SSH key Docker mounting, Drizzle ORM + better-sqlite3, Socket.IO with Express 5, MCP tool definition patterns, Docker Compose setup, and JWT auth for a single-operator system.

The findings are well-supported by official documentation. The Proxmox REST API token auth is straightforward (`pveum user token add root@pam jarvis --privsep 0` on each PVE node). The MCP TypeScript SDK provides `McpServer.tool()` and `McpServer.registerTool()` methods with Zod schema validation. Express 5 integration uses `@modelcontextprotocol/express` with `createMcpExpressApp()` for DNS rebinding protection, with Streamable HTTP transport wired via POST/GET/DELETE routes on `/mcp`. Socket.IO 4 works with Express 5 using the standard `http.createServer(app)` pattern. Drizzle ORM connects to better-sqlite3 synchronously with TypeScript-first schema definitions and programmatic migrations at startup.

**Primary recommendation:** Build the backend as a single Express 5 process that hosts the MCP tool server in-process (direct function calls, not HTTP transport), uses Socket.IO for real-time push, persists to SQLite via Drizzle ORM, and connects to Proxmox nodes via REST API with token auth + SSH with key auth. Deploy as a Docker container with read-only SSH key mount.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.2.0 | HTTP API server | Express 5 has async error handling; official MCP SDK Express middleware exists |
| @modelcontextprotocol/sdk | ^1.25.0 | MCP server SDK | Official TypeScript SDK; Zod validation; tool/resource/prompt primitives |
| @modelcontextprotocol/express | latest | Express adapter | Thin adapter: `createMcpExpressApp()`, DNS rebinding protection |
| socket.io | ^4.8.0 | WebSocket server | Auto-reconnect, rooms/namespaces, heartbeats; required for real-time push |
| better-sqlite3 | ^12.6.0 | SQLite driver | Synchronous, fastest Node.js SQLite; prebuilt Linux binaries |
| drizzle-orm | ^0.45.0 | TypeScript ORM | SQL-first, 7.4KB, zero deps; sits on better-sqlite3; TypeScript schema = types |
| node-ssh | ^13.2.0 | SSH client | Promise-based ssh2 wrapper; clean API for command execution |
| zod | ^3.25.0 | Schema validation | Required peer dep of MCP SDK; also used for API request validation |
| jsonwebtoken | ^9.0.0 | JWT auth | Standard JWT signing/verification; single-user token auth |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-kit | ^0.30.0 | Migration CLI | Generate and apply SQL migrations from Drizzle schema changes |
| cors | ^2.8.0 | CORS middleware | Express CORS for frontend container cross-origin requests |
| dotenv | ^16.4.0 | Env vars | Load .env file for config (API keys, secrets) |
| @types/better-sqlite3 | latest | Type defs | TypeScript support for better-sqlite3 |
| @types/express | latest | Type defs | TypeScript support for Express |
| @types/cors | latest | Type defs | TypeScript support for cors |
| @types/jsonwebtoken | latest | Type defs | TypeScript support for jsonwebtoken |
| typescript | ~5.6.2 | Compiler | TypeScript compilation |
| tsx | latest | Dev runner | Run TypeScript directly in development |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom Proxmox client (fetch) | proxmox-api npm | proxmox-api is GPL-3.0, stale (1yr), 1.1K weekly downloads; custom client preferred |
| jsonwebtoken | jose | jose is more modern (ESM-first), but jsonwebtoken is simpler for single-user |
| node-ssh | raw ssh2 | ssh2 gives more control but node-ssh's promise API is cleaner for command execution |
| @modelcontextprotocol/express | express-mcp-handler | Third-party; official adapter is preferred for long-term compatibility |

**Installation:**

```bash
# Core
npm install express socket.io cors
npm install @modelcontextprotocol/sdk @modelcontextprotocol/express zod
npm install better-sqlite3 drizzle-orm
npm install node-ssh
npm install jsonwebtoken dotenv

# Dev dependencies
npm install -D typescript tsx drizzle-kit
npm install -D @types/express @types/cors @types/better-sqlite3 @types/jsonwebtoken @types/node
```

---

## Architecture Patterns

### Recommended Project Structure

```
jarvis-backend/
├── src/
│   ├── index.ts              # Entry point: Express app, Socket.IO, startup
│   ├── config.ts             # Environment variables, node definitions
│   ├── auth/
│   │   └── jwt.ts            # JWT sign/verify, middleware
│   ├── api/
│   │   ├── routes.ts         # Express REST routes
│   │   └── health.ts         # Health endpoint
│   ├── mcp/
│   │   ├── server.ts         # McpServer instance, tool registration
│   │   ├── tools/
│   │   │   ├── cluster.ts    # Read-only cluster tools
│   │   │   ├── lifecycle.ts  # VM/CT start/stop/restart
│   │   │   └── system.ts     # SSH exec, service management
│   │   └── safety.ts         # Tier enforcement, protected resources, DAG
│   ├── clients/
│   │   ├── proxmox.ts        # Proxmox REST API client
│   │   └── ssh.ts            # SSH client with connection pooling
│   ├── db/
│   │   ├── schema.ts         # Drizzle schema definitions
│   │   ├── index.ts          # Database connection
│   │   └── memory.ts         # Memory store (event persistence, queries)
│   ├── realtime/
│   │   └── socket.ts         # Socket.IO setup, namespaces, event emission
│   └── safety/
│       ├── tiers.ts          # Green/Yellow/Red/Black classification
│       ├── protected.ts      # Protected resource list, dependency DAG
│       └── sanitize.ts       # Input sanitization for prompt injection prevention
├── drizzle/                  # Generated migrations
├── drizzle.config.ts         # Drizzle Kit config
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

### Pattern 1: In-Process MCP Server (Not HTTP Transport)

**What:** The MCP server runs in the same Node.js process as Express. Tools are called via direct function imports, not via Streamable HTTP transport.

**When to use:** Single-process backend where both the API and MCP tools live together. This is the correct pattern for Jarvis 3.1.

**Why:** No serialization overhead. Shared memory for cluster state cache. Simpler deployment. The API Gateway IS the MCP client -- it calls tools programmatically.

**Example:**

```typescript
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { proxmoxClient } from '../clients/proxmox.js';
import { checkSafety } from '../safety/tiers.js';

export const mcpServer = new McpServer({
  name: 'jarvis-mcp',
  version: '1.0.0',
});

// Register tools
mcpServer.tool(
  'get_cluster_status',
  { /* no params */ },
  async () => {
    const status = await proxmoxClient.getClusterStatus();
    return {
      content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
    };
  }
);

// For external MCP client access (future), expose via Streamable HTTP:
// app.post('/mcp', mcpHandler);
// app.get('/mcp', mcpSseHandler);
// app.delete('/mcp', mcpDeleteHandler);
```

**Note on future external access:** If Claude Desktop or another MCP client needs to connect externally, add Streamable HTTP transport as a thin adapter on `/mcp` routes using `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. The in-process tools remain unchanged.

### Pattern 2: Express 5 + Socket.IO on Shared HTTP Server

**What:** Express 5 and Socket.IO share a single `http.Server` instance. Express handles REST, Socket.IO handles WebSocket.

**When to use:** Always. This is the standard pattern for Express + Socket.IO coexistence.

**Example:**

```typescript
// src/index.ts
import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';

const app = express();
const server = createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: ['http://192.168.1.65:3004'],  // Frontend container
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 10000,
});

app.use(cors({ origin: 'http://192.168.1.65:3004', credentials: true }));
app.use(express.json());

// REST routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO namespaces
const clusterNs = io.of('/cluster');
const eventsNs = io.of('/events');

clusterNs.on('connection', (socket) => {
  console.log('Client connected to /cluster');
  // Send initial state, then push updates
});

// IMPORTANT: listen on `server`, NOT `app`
server.listen(4000, () => {
  console.log('Jarvis backend running on port 4000');
});
```

### Pattern 3: Tiered Safety Enforcement Pipeline

**What:** Every tool call passes through a safety check before execution. Actions are classified into tiers, and protected resources are hard-coded.

**When to use:** Every single tool invocation, whether from LLM, monitor, or user.

**Example:**

```typescript
// src/safety/tiers.ts
export enum ActionTier {
  GREEN = 'green',    // Auto-execute: read-only
  YELLOW = 'yellow',  // Execute + log: service restarts, container ops
  RED = 'red',        // Require confirmation flag: VM start/stop
  BLACK = 'black',    // Always blocked: node reboot, cluster config
}

export const PROTECTED_RESOURCES = {
  nodes: ['agent1'],              // Jarvis host node
  vmids: [103],                   // Management VM
  services: ['docker.service'],   // Docker daemon on management VM
  networks: ['192.168.1.61', '192.168.1.65'],
} as const;

export function checkSafety(
  tool: string,
  args: Record<string, unknown>,
  tier: ActionTier,
  confirmed: boolean = false
): { allowed: boolean; reason?: string } {
  // Check protected resources
  const targetNode = args.node as string | undefined;
  const targetVmid = args.vmid as number | undefined;

  if (targetNode && PROTECTED_RESOURCES.nodes.includes(targetNode)) {
    return { allowed: false, reason: `Node '${targetNode}' is protected (Jarvis host)` };
  }
  if (targetVmid && PROTECTED_RESOURCES.vmids.includes(targetVmid)) {
    return { allowed: false, reason: `VMID ${targetVmid} is protected (management VM)` };
  }

  // Tier enforcement
  if (tier === ActionTier.BLACK) {
    return { allowed: false, reason: `Action tier BLACK: always blocked` };
  }
  if (tier === ActionTier.RED && !confirmed) {
    return { allowed: false, reason: `Action tier RED: requires confirmation` };
  }

  return { allowed: true };
}
```

### Anti-Patterns to Avoid

- **child_process.exec for Proxmox ops:** Command injection risk. Management VM has no pvesh. Use REST API.
- **Docker socket mount:** Root-equivalent access to host. Use SSH to management VM instead.
- **Raw LLM text to shell:** Never pass LLM output directly to exec(). Always use structured tool calls with validated params.
- **Separate MCP process:** Unnecessary IPC overhead for a single-user system. Keep in-process.
- **Polling from frontend:** Backend polls Proxmox on schedule, pushes via Socket.IO. Frontend is purely reactive.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP tool schema validation | Custom JSON Schema parser | Zod via MCP SDK | SDK validates automatically; Zod gives TypeScript type inference |
| SSH connection management | Raw ssh2 + manual pool | node-ssh (^13.2.0) | Promise API, TypeScript, connection reuse built-in |
| SQLite ORM layer | Raw SQL strings | Drizzle ORM | Type-safe queries, auto-generated types from schema, migration tooling |
| WebSocket reconnection | Custom reconnect logic | Socket.IO | Built-in exponential backoff, heartbeat, room management |
| JWT token handling | Custom crypto | jsonwebtoken | Battle-tested, 50M+ weekly downloads, handles signing/verification/expiry |
| CORS handling | Manual headers | cors npm package | Handles preflight, credentials, multiple origins correctly |

**Key insight:** Phase 1 has zero novel problems. Every component (REST API, JWT, WebSocket, ORM, SSH, MCP) has a mature, well-documented library. The innovation is in the integration and safety layer, not in any individual component.

---

## Common Pitfalls

### Pitfall 1: Proxmox Self-Signed TLS Rejection

**What goes wrong:** Node.js `fetch()` rejects HTTPS connections to Proxmox nodes (port 8006) because they use self-signed certificates.
**Why it happens:** Node.js enforces TLS certificate verification by default.
**How to avoid:** Set `NODE_TLS_REJECT_UNAUTHORIZED=0` as environment variable, OR use a custom fetch agent with `rejectUnauthorized: false`. The environment variable approach is simpler for a trusted LAN.
**Warning signs:** `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `SELF_SIGNED_CERT_IN_CHAIN` errors.

```typescript
// Option 1: Environment variable (simplest, affects all HTTPS in process)
// Set in docker-compose.yml: NODE_TLS_REJECT_UNAUTHORIZED=0

// Option 2: Per-request agent (more targeted)
import https from 'node:https';
const agent = new https.Agent({ rejectUnauthorized: false });

async function proxmoxFetch(url: string, options: RequestInit = {}) {
  // Node.js 22 fetch with custom dispatcher
  return fetch(url, {
    ...options,
    // @ts-expect-error -- Node.js undici dispatcher
    dispatcher: new (await import('undici')).Agent({
      connect: { rejectUnauthorized: false }
    })
  });
}
```

**Confidence:** HIGH -- Self-signed certs on PVE are the default. Verified in cluster CLAUDE.md.

### Pitfall 2: better-sqlite3 Native Module in Docker Alpine

**What goes wrong:** `better-sqlite3` requires native compilation. On Alpine Linux (node:22-alpine), the build may fail or produce incompatible binaries if build tools are missing.
**Why it happens:** Alpine uses musl libc, not glibc. better-sqlite3 has prebuilt binaries for glibc but may need compilation on Alpine.
**How to avoid:** Install build dependencies in the Docker image OR use a multi-stage build where compilation happens in a full Node image and the binary is copied to Alpine.

```dockerfile
# Option 1: Install build tools on Alpine
FROM node:22-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "dist/index.js"]

# Option 2: Multi-stage (smaller final image)
FROM node:22 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
CMD ["node", "dist/index.js"]
```

**Confidence:** HIGH -- Well-documented Alpine/native module issue.

### Pitfall 3: SSH Key Permissions Inside Docker Container

**What goes wrong:** SSH key mounted as read-only volume has incorrect permissions (too open). SSH refuses to use a key with permissions wider than 600.
**Why it happens:** Volume mounts inherit host file permissions but `:ro` prevents `chmod` inside the container.
**How to avoid:** Ensure the key file on the host has 600 permissions. If permissions cannot be set correctly, copy the key at container startup and chmod it.

```yaml
# docker-compose.yml
volumes:
  - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro
```

```bash
# On the host, ensure correct permissions:
chmod 600 /root/.ssh/id_ed25519
```

```dockerfile
# If host permissions are wrong, copy + chmod in entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# entrypoint.sh:
#!/bin/sh
cp /app/.ssh/id_ed25519 /tmp/ssh_key
chmod 600 /tmp/ssh_key
export SSH_KEY_PATH=/tmp/ssh_key
exec node dist/index.js
```

**Confidence:** HIGH -- Docker compose issue #6751 confirms read-only volume permission quirks.

### Pitfall 4: Socket.IO CORS Misconfiguration

**What goes wrong:** Frontend container on port 3004 cannot connect to backend container on port 4000 due to CORS.
**Why it happens:** Socket.IO v3+ requires explicit CORS configuration. The frontend and backend are on different Docker containers (different ports).
**How to avoid:** Configure CORS on both Express and Socket.IO with matching origins.

```typescript
const corsOptions = {
  origin: ['http://192.168.1.65:3004', 'http://localhost:3004'],
  credentials: true,
};

app.use(cors(corsOptions));

const io = new SocketIOServer(server, {
  cors: corsOptions,
});
```

**Confidence:** HIGH -- Standard Socket.IO v3+ requirement, extensively documented.

### Pitfall 5: Drizzle ORM Async Confusion with better-sqlite3

**What goes wrong:** Developer uses `await` with Drizzle + better-sqlite3 queries, expecting async behavior. In reality, better-sqlite3 is synchronous.
**Why it happens:** Drizzle's API looks async (returns what appears to be a promise) but with the better-sqlite3 driver, operations are actually synchronous.
**How to avoid:** Understand that Drizzle over better-sqlite3 executes synchronously. The `await` keyword is harmless but the operation blocks the event loop (microseconds for SQLite, so this is fine).

```typescript
// This works and is synchronous under the hood:
const events = db.select().from(eventsTable).where(
  eq(eventsTable.type, 'alert')
).all();

// Using await is also fine (resolves immediately):
const events = await db.select().from(eventsTable).all();
```

**Confidence:** HIGH -- Drizzle docs confirm better-sqlite3 driver is synchronous.

---

## Code Examples

### 1. Proxmox API Token Creation (Manual Prerequisite)

**Confidence:** HIGH -- Verified via Proxmox official documentation.

Run on each PVE node (Home, pve, agent1) via SSH:

```bash
# Create API token for root@pam with full privileges (no privsep)
pveum user token add root@pam jarvis --privsep 0

# Output will look like:
# +------------+--------------------------------------+
# | key        | value                                |
# +============+======================================+
# | full-tokenid | root@pam!jarvis                    |
# +------------+--------------------------------------+
# | info       |                                      |
# +------------+--------------------------------------+
# | value      | xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx |
# +------------+--------------------------------------+

# IMPORTANT: The token value is shown ONCE. Save it immediately.
# The token ID is: root@pam!jarvis
# The token secret is the UUID value shown

# Verify token exists:
pveum user token list root@pam

# To remove and recreate if needed:
pveum user token remove root@pam jarvis
```

**Note:** The `agent` node (192.168.1.62) is a lightweight utility node. Create the token there too if Jarvis needs to manage it, but it may not have VMs worth managing.

**Note:** The `--privsep 0` flag gives the token full root permissions. This is acceptable for a single-operator homelab where Jarvis needs full cluster control. In a multi-user environment, you would use `--privsep 1` and assign specific ACLs.

### 2. Proxmox REST API Client

**Confidence:** HIGH -- Verified via Proxmox wiki and API docs.

```typescript
// src/clients/proxmox.ts
interface ProxmoxConfig {
  host: string;
  port?: number;
  tokenId: string;     // 'root@pam!jarvis'
  tokenSecret: string; // UUID from token creation
}

const NODES: ProxmoxConfig[] = [
  { host: '192.168.1.50', tokenId: 'root@pam!jarvis', tokenSecret: process.env.PVE_TOKEN_SECRET! },
  { host: '192.168.1.74', tokenId: 'root@pam!jarvis', tokenSecret: process.env.PVE_TOKEN_SECRET! },
  { host: '192.168.1.61', tokenId: 'root@pam!jarvis', tokenSecret: process.env.PVE_TOKEN_SECRET! },
  { host: '192.168.1.62', tokenId: 'root@pam!jarvis', tokenSecret: process.env.PVE_TOKEN_SECRET! },
];

export class ProxmoxClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ProxmoxConfig) {
    this.baseUrl = `https://${config.host}:${config.port || 8006}/api2/json`;
    this.authHeader = `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`;
  }

  async get<T = unknown>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: this.authHeader },
    });
    if (!response.ok) {
      throw new Error(`Proxmox API error: ${response.status} ${response.statusText}`);
    }
    const json = await response.json() as { data: T };
    return json.data;
  }

  async post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`Proxmox API error: ${response.status} ${response.statusText}`);
    }
    const json = await response.json() as { data: T };
    return json.data;
  }

  // Key endpoints:
  async getNodes() { return this.get('/nodes'); }
  async getNodeStatus(node: string) { return this.get(`/nodes/${node}/status`); }
  async getClusterResources(type?: string) {
    const query = type ? `?type=${type}` : '';
    return this.get(`/cluster/resources${query}`);
  }
  async getClusterStatus() { return this.get('/cluster/status'); }
  async startVM(node: string, vmid: number) {
    return this.post(`/nodes/${node}/qemu/${vmid}/status/start`);
  }
  async stopVM(node: string, vmid: number) {
    return this.post(`/nodes/${node}/qemu/${vmid}/status/stop`);
  }
  async startCT(node: string, vmid: number) {
    return this.post(`/nodes/${node}/lxc/${vmid}/status/start`);
  }
  async stopCT(node: string, vmid: number) {
    return this.post(`/nodes/${node}/lxc/${vmid}/status/stop`);
  }
}
```

**Key facts about Proxmox REST API:**
- All responses wrapped in `{ data: ... }` envelope
- API tokens do NOT need CSRF tokens for POST/PUT/DELETE (unlike ticket auth)
- Self-signed TLS on all nodes -- must disable verification
- Cluster-wide queries available at `/cluster/resources` (no need to query each node individually for VM lists)
- Node-specific queries at `/nodes/{node}/...` for detailed metrics

### 3. MCP Tool Registration with Zod Schemas

**Confidence:** HIGH -- Verified via MCP TypeScript SDK GitHub, npm docs, and MCPcat guide.

```typescript
// src/mcp/tools/cluster.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { proxmoxClient } from '../../clients/proxmox.js';

export function registerClusterTools(server: McpServer) {
  // Read-only tool: no parameters
  server.tool(
    'get_cluster_status',
    'Get full cluster status including all nodes, quorum, and health',
    {},  // empty schema = no params
    async () => {
      try {
        const status = await proxmoxClient.getClusterStatus();
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching cluster status: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Read-only tool with parameters
  server.tool(
    'get_node_status',
    'Get detailed metrics for a specific cluster node (CPU, RAM, uptime, temperature)',
    {
      node: z.string().describe('Node name: Home, pve, agent1, or agent'),
    },
    async ({ node }) => {
      try {
        const status = await proxmoxClient.getNodeStatus(node);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Lifecycle tool with safety check
  server.tool(
    'start_vm',
    'Start a stopped VM. Requires node name and VMID. Will be blocked if targeting protected resources.',
    {
      node: z.string().describe('Node the VM is on'),
      vmid: z.number().int().positive().describe('VM ID to start'),
      confirmed: z.boolean().default(false).describe('Must be true for lifecycle actions'),
    },
    async ({ node, vmid, confirmed }) => {
      // Safety check
      const safety = checkSafety('start_vm', { node, vmid }, ActionTier.RED, confirmed);
      if (!safety.allowed) {
        return {
          content: [{ type: 'text', text: `BLOCKED: ${safety.reason}` }],
          isError: true,
        };
      }

      try {
        const result = await proxmoxClient.startVM(node, vmid);
        return {
          content: [{ type: 'text', text: `VM ${vmid} start initiated on ${node}` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to start VM ${vmid}: ${error}` }],
          isError: true,
        };
      }
    }
  );
}
```

**MCP SDK tool registration API (two forms):**

```typescript
// Form 1: server.tool(name, schema, handler) -- simple
server.tool('tool_name', { param: z.string() }, async ({ param }) => {
  return { content: [{ type: 'text', text: 'result' }] };
});

// Form 2: server.tool(name, description, schema, handler) -- with description
server.tool('tool_name', 'Human-readable description', { param: z.string() }, async ({ param }) => {
  return { content: [{ type: 'text', text: 'result' }] };
});

// Form 3: server.registerTool(name, metadata, handler) -- newer API
server.registerTool('tool_name', {
  title: 'Display Name',
  description: 'Description for LLM',
  inputSchema: { param: z.string() },
}, async ({ param }) => {
  return { content: [{ type: 'text', text: 'result' }] };
});
```

**Error handling pattern:**
- Always wrap handler body in try/catch
- Return `{ isError: true }` on failure instead of throwing
- Never let an unhandled promise rejection crash the MCP server
- Set timeouts on all external calls (Proxmox API, SSH)

### 4. Drizzle ORM + better-sqlite3 Setup

**Confidence:** HIGH -- Verified via Drizzle official docs and npm.

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default("(datetime('now'))"),
  type: text('type').notNull(),          // 'alert', 'action', 'status', 'metric'
  severity: text('severity').default('info'),  // 'info', 'warning', 'error', 'critical'
  source: text('source').notNull(),      // 'monitor', 'user', 'jarvis', 'system'
  node: text('node'),
  summary: text('summary').notNull(),
  details: text('details'),              // JSON string
  resolved: integer('resolved', { mode: 'boolean' }).default(false),
  resolvedAt: text('resolved_at'),
  resolvedBy: text('resolved_by'),
});

export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  timestamp: text('timestamp').notNull().default("(datetime('now'))"),
  role: text('role').notNull(),          // 'user', 'assistant', 'system', 'tool'
  content: text('content').notNull(),
  model: text('model'),                  // 'claude', 'qwen', null
  tokensUsed: integer('tokens_used'),
  toolCalls: text('tool_calls'),         // JSON string
});

export const clusterSnapshots = sqliteTable('cluster_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull().default("(datetime('now'))"),
  snapshot: text('snapshot').notNull(),  // JSON string
});

export const preferences = sqliteTable('preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});
```

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';

const sqlite = new Database(process.env.DB_PATH || '/data/jarvis.db');

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
```

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/jarvis.db',
  },
});
```

```typescript
// Programmatic migration at startup (recommended for Docker)
// src/db/migrate.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index.js';

export function runMigrations() {
  migrate(db, { migrationsFolder: './drizzle' });
  console.log('Database migrations applied');
}
```

```typescript
// src/db/memory.ts -- Memory store operations
import { db } from './index.js';
import { events, conversations, clusterSnapshots, preferences } from './schema.js';
import { eq, desc, and, gte } from 'drizzle-orm';

export const memoryStore = {
  // Write an event
  saveEvent(event: typeof events.$inferInsert) {
    return db.insert(events).values(event).run();
  },

  // Read recent events
  getRecentEvents(limit = 50) {
    return db.select().from(events).orderBy(desc(events.timestamp)).limit(limit).all();
  },

  // Read unresolved events
  getUnresolved() {
    return db.select().from(events).where(eq(events.resolved, false)).all();
  },

  // Read events since timestamp
  getEventsSince(since: string) {
    return db.select().from(events)
      .where(gte(events.timestamp, since))
      .orderBy(desc(events.timestamp))
      .all();
  },

  // Save conversation message
  saveMessage(msg: typeof conversations.$inferInsert) {
    return db.insert(conversations).values(msg).run();
  },

  // Save cluster snapshot
  saveSnapshot(snapshot: string) {
    return db.insert(clusterSnapshots).values({ snapshot }).run();
  },

  // Get/set preferences
  getPreference(key: string) {
    return db.select().from(preferences).where(eq(preferences.key, key)).get();
  },

  setPreference(key: string, value: string) {
    return db.insert(preferences)
      .values({ key, value })
      .onConflictDoUpdate({ target: preferences.key, set: { value, updatedAt: new Date().toISOString() } })
      .run();
  },
};
```

**Migration strategy:** Use `drizzle-kit generate` during development to create SQL migration files. At container startup, run `migrate()` programmatically. This ensures the database schema is always current without manual steps.

### 5. Socket.IO with Express 5

**Confidence:** HIGH -- Standard pattern, verified via Socket.IO v4 docs.

```typescript
// src/realtime/socket.ts
import { Server as SocketIOServer, Namespace } from 'socket.io';
import type { Server as HttpServer } from 'node:http';

export function setupSocketIO(server: HttpServer) {
  const io = new SocketIOServer(server, {
    cors: {
      origin: [
        'http://192.168.1.65:3004',  // Frontend in Docker
        'http://localhost:3004',       // Dev
      ],
      credentials: true,
    },
    pingInterval: 25000,  // Client ping every 25s
    pingTimeout: 10000,   // Disconnect if no pong in 10s
  });

  // Namespace: /cluster -- real-time cluster status
  const clusterNs = io.of('/cluster');
  clusterNs.use((socket, next) => {
    // JWT auth middleware for WebSocket
    const token = socket.handshake.auth?.token;
    if (!token || !verifyJWT(token)) {
      return next(new Error('Authentication required'));
    }
    next();
  });
  clusterNs.on('connection', (socket) => {
    console.log(`Client connected to /cluster: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`Client disconnected from /cluster: ${socket.id}`);
    });
  });

  // Namespace: /events -- Jarvis activity feed
  const eventsNs = io.of('/events');
  eventsNs.on('connection', (socket) => {
    // Send recent events on connect
  });

  return { io, clusterNs, eventsNs };
}

// Broadcast helper
export function broadcastClusterUpdate(clusterNs: Namespace, data: unknown) {
  clusterNs.emit('cluster:status', data);
}

export function broadcastEvent(eventsNs: Namespace, event: unknown) {
  eventsNs.emit('jarvis:event', event);
}
```

### 6. JWT Auth for Single-User System

**Confidence:** HIGH -- Standard JWT pattern.

```typescript
// src/auth/jwt.ts
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const TOKEN_EXPIRY = '7d';  // Single-user, long-lived token is fine

// Generate a token (called once at login or via CLI)
export function generateToken(): string {
  return jwt.sign(
    { role: 'operator', iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// Verify token
export function verifyJWT(token: string): boolean {
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

// Express middleware
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip health check
  if (req.path === '/api/health') return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Login endpoint: single-user, password from env
export function handleLogin(req: Request, res: Response) {
  const { password } = req.body;
  if (password !== process.env.JARVIS_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = generateToken();
  res.json({ token, expiresIn: TOKEN_EXPIRY });
}
```

**Design choice:** Single-user system means no user table, no registration, no RBAC. Just a shared password (set via environment variable) that issues a JWT. The JWT is then used for both REST API calls (Bearer header) and Socket.IO connections (handshake auth).

### 7. Docker Compose Configuration

**Confidence:** HIGH -- Standard Docker Compose patterns.

```yaml
# docker-compose.yml
version: '3.8'

services:
  jarvis-backend:
    build:
      context: ./jarvis-backend
      dockerfile: Dockerfile
    container_name: jarvis-backend
    ports:
      - "4000:4000"
    volumes:
      - jarvis-data:/data                           # SQLite database
      - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro  # SSH key (read-only)
    environment:
      - NODE_ENV=production
      - PORT=4000
      - DB_PATH=/data/jarvis.db
      - JWT_SECRET=${JWT_SECRET}
      - JARVIS_PASSWORD=${JARVIS_PASSWORD}
      - PVE_TOKEN_ID=root@pam!jarvis
      - PVE_TOKEN_SECRET=${PVE_TOKEN_SECRET}
      - NODE_TLS_REJECT_UNAUTHORIZED=0  # Accept self-signed Proxmox certs
    networks:
      - jarvis-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:4000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  # Future: jarvis-frontend (Phase 2)
  # jarvis-frontend:
  #   build:
  #     context: ./jarvis-ui
  #     dockerfile: Dockerfile
  #   container_name: jarvis-frontend
  #   ports:
  #     - "3004:80"
  #   networks:
  #     - jarvis-net
  #   restart: unless-stopped
  #   depends_on:
  #     - jarvis-backend

volumes:
  jarvis-data:
    driver: local

networks:
  jarvis-net:
    driver: bridge
```

```dockerfile
# jarvis-backend/Dockerfile
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./

# Create SSH directory
RUN mkdir -p /app/.ssh && chmod 700 /app/.ssh

# Create data directory for SQLite
RUN mkdir -p /data

EXPOSE 4000

CMD ["node", "dist/index.js"]
```

### 8. SSH Key Docker Mounting

**Confidence:** HIGH -- Standard Docker volume mount pattern; permission workaround verified.

```yaml
# In docker-compose.yml:
volumes:
  - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro
```

```typescript
// src/clients/ssh.ts
import { NodeSSH } from 'node-ssh';
import { readFileSync } from 'node:fs';

const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/app/.ssh/id_ed25519';

// Connection pool: maintain one connection per node
const connections = new Map<string, NodeSSH>();

export async function getSSHConnection(host: string): Promise<NodeSSH> {
  const existing = connections.get(host);
  if (existing?.isConnected()) {
    return existing;
  }

  const ssh = new NodeSSH();
  await ssh.connect({
    host,
    username: 'root',
    privateKey: SSH_KEY_PATH,
    readyTimeout: 10000,  // 10s connection timeout
  });

  connections.set(host, ssh);
  return ssh;
}

export async function execOnNode(
  host: string,
  command: string,
  timeout = 30000
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const ssh = await getSSHConnection(host);

  const result = await ssh.execCommand(command, {
    execOptions: { timeout },
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
  };
}

// Cleanup on shutdown
export function closeAllConnections() {
  for (const [host, ssh] of connections) {
    ssh.dispose();
    connections.delete(host);
  }
}
```

**Security notes:**
- Mount as `:ro` -- container cannot modify the key
- Host key must have 600 permissions before mounting
- node-ssh accepts `privateKey` as a file path (reads it itself)
- Connection pooling: maintain persistent SSH connections to reduce handshake overhead
- Timeout every command at 30s by default; longer for operations like backups

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pvesh CLI for Proxmox | REST API with token auth | PVE 5.0+ (tokens), always for remote | No shell parsing, no command injection, works from any host |
| MCP stdio transport | Streamable HTTP transport | MCP spec 2025-11 | Remote server support; but in-process is fine for our use case |
| MCP `server.tool()` | MCP `server.registerTool()` | SDK v1.25+ | Both work; `registerTool` adds title and output schema |
| Drizzle `db.insert().returning()` | Same (stable) | N/A | SQLite returning() support added in Drizzle 0.28+ |
| Express 4 | Express 5 | 2024 stable release | Async error handling, removed deprecated methods |
| Socket.IO 2 (auto-CORS) | Socket.IO 3+ (explicit CORS) | 2020 | Must configure CORS explicitly |

**Deprecated/outdated:**
- `@modelcontextprotocol/sdk` v2 expected Q1 2026, but v1.x remains recommended for production. v1.x gets 6 months maintenance after v2 ships.
- The MCP SDK still supports `server.tool()` alongside `server.registerTool()`. Both are valid in v1.x.
- Express 4 is still widely used but Express 5 is now stable with async middleware support.

---

## Open Questions

### 1. Proxmox API Token: Same Secret Across Nodes?

**What we know:** Each PVE node in a cluster shares the same user database (stored in `/etc/pve/priv/`). A token created on one node should be usable cluster-wide.

**What's unclear:** Whether `pveum user token add` needs to be run on every node individually, or just once on any cluster node.

**Recommendation:** Run the command on ONE node (Home, the cluster master). Verify by testing the token against each node's API endpoint. If it fails on a node, create the token on that node too. This is a manual prerequisite to document in the plan.

**Confidence:** MEDIUM -- Cluster-shared user DB is documented, but token propagation timing is not explicitly stated.

### 2. MCP Server.tool() vs registerTool()

**What we know:** Both APIs exist in v1.25+. `server.tool()` is the simpler form. `server.registerTool()` adds `title` and `outputSchema` fields.

**What's unclear:** Whether `server.tool()` will be deprecated in v2.

**Recommendation:** Use `server.tool()` for Phase 1. It is simpler and sufficient. If v2 deprecates it, migration to `registerTool()` is trivial (add title/outputSchema fields). Do not over-engineer for a hypothetical v2 migration.

**Confidence:** HIGH for current API stability; LOW for v2 migration path.

### 3. Streamable HTTP Transport Needed?

**What we know:** The MCP tools will be called in-process by the backend. External MCP client access is not needed in Phase 1.

**What's unclear:** Whether Phase 3 (AI Chat) will use MCP's Streamable HTTP transport to connect Claude, or whether the backend will be the MCP client itself (calling tools programmatically).

**Recommendation:** Do NOT set up Streamable HTTP transport in Phase 1. The backend calls tools directly. If external transport is needed later, add it as a thin adapter in Phase 3. This avoids unnecessary complexity now.

**Confidence:** HIGH -- In-process is correct for Phase 1.

---

## Sources

### Primary (HIGH confidence)
- [Proxmox VE API Wiki](https://pve.proxmox.com/wiki/Proxmox_VE_API) - Token auth, API endpoints, curl examples
- [Proxmox pveum documentation](https://pve.proxmox.com/pve-docs/pveum-plain.html) - User management, token creation
- [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - Tool registration, Express middleware, transport
- [MCP TypeScript SDK npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - Version 1.25+, peer deps
- [MCP SDK server.md docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) - registerTool, Streamable HTTP, Express
- [MCPcat TypeScript Tools Guide](https://mcpcat.io/guides/adding-custom-tools-mcp-server-typescript/) - Tool definition, error handling, return types
- [Drizzle ORM SQLite Getting Started](https://orm.drizzle.team/docs/get-started/sqlite-new) - Schema, connection, queries
- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations) - Generate, push, programmatic migration
- [Socket.IO v4 Server Options](https://socket.io/docs/v4/server-options/) - CORS config, ping/pong
- [Socket.IO v4 Namespaces](https://socket.io/docs/v4/namespaces/) - Namespace creation, middleware, auth
- [Socket.IO + Express Tutorial](https://socket.io/docs/v4/tutorial/step-3) - Express integration pattern

### Secondary (MEDIUM confidence)
- [Docker SSH Key Best Practices](https://nickjanetakis.com/blog/docker-tip-56-volume-mounting-ssh-keys-into-a-docker-container) - Volume mount patterns
- [Docker Compose read-only volumes issue](https://github.com/docker/compose/issues/6751) - Permission quirks
- [DigitalOcean JWT Express Tutorial](https://www.digitalocean.com/community/tutorials/nodejs-jwt-expressjs) - JWT auth pattern
- [VideoSDK Socket.IO + Express Guide](https://www.videosdk.live/developer-hub/socketio/socketio-and-express) - Integration patterns for 2025
- [Better Stack Drizzle ORM Guide](https://betterstack.com/community/guides/scaling-nodejs/drizzle-orm/) - Setup walkthrough
- [Proxmox Forum: API Token Usage](https://forum.proxmox.com/threads/connect-to-pve-using-api-token.162118/) - Real-world token auth

### Tertiary (LOW confidence)
- Express 5 + @modelcontextprotocol/express compatibility -- assumed based on Express 5 backward compatibility; no explicit test found
- MCP SDK v2 migration path -- v2 expected Q1 2026 but no public API preview
- Proxmox API token cluster-wide propagation timing -- expected to work immediately via shared pmxcfs, but not explicitly documented

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via npm registry, official docs
- Architecture: HIGH - Patterns verified against MCP SDK examples and Express/Socket.IO docs
- Pitfalls: HIGH - All pitfalls verified against official documentation and community issues
- Proxmox API token creation: HIGH - pveum command verified via Proxmox wiki
- MCP tool definition: HIGH - Verified via SDK GitHub, npm, and MCPcat guide
- Docker deployment: HIGH - Standard Docker patterns, well-documented
- JWT auth: HIGH - Standard pattern, 50M+ weekly downloads on jsonwebtoken

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days -- stack is stable, MCP SDK v2 may change but v1.x is supported)

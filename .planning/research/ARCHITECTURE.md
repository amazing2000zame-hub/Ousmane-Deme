# Architecture Patterns: Milestone Integration

**Domain:** Hybrid LLM routing, persistent memory, Docker deployment, and E2E testing for Jarvis 3.1
**Researched:** 2026-01-26
**Overall Confidence:** HIGH (verified against existing codebase, current ecosystem patterns, and official documentation)

---

## Existing Architecture (As-Built)

Before detailing how new features integrate, here is the precise current state based on full codebase analysis.

### Current Module Map

```
jarvis-backend/src/
  index.ts              -- Express 5 + HTTP server + Socket.IO bootstrap
  config.ts             -- Centralized config from env vars

  ai/
    claude.ts           -- Anthropic SDK client singleton (claudeClient, claudeAvailable flag)
    local-llm.ts        -- OpenAI-compatible SSE streaming against llama-server
    loop.ts             -- Agentic tool-calling loop (Claude-only, streams + tool_use blocks)
    system-prompt.ts    -- JARVIS personality + live cluster context injection
    tools.ts            -- 18 Anthropic tool definitions (hardcoded, not auto-generated)

  mcp/
    server.ts           -- McpServer instance + executeTool() pipeline (sanitize -> safety -> execute -> log)
    tools/
      cluster.ts        -- 9 GREEN-tier read-only tools
      lifecycle.ts       -- 6 RED-tier VM/CT start/stop/restart tools
      system.ts          -- 3 YELLOW-tier operational tools (SSH, service restart, WOL)

  safety/
    tiers.ts            -- 4-tier ActionTier enum (GREEN/YELLOW/RED/BLACK) + checkSafety()
    protected.ts        -- Protected resource guard (VMID 103, Docker daemon)
    sanitize.ts         -- Input sanitization for tool arguments
    context.ts          -- Override context thread-local state

  db/
    index.ts            -- better-sqlite3 + Drizzle ORM init (WAL mode)
    schema.ts           -- 5 tables: events, conversations, cluster_snapshots, preferences, autonomy_actions
    memory.ts           -- memoryStore API: events, messages, snapshots, preferences, autonomy actions
    migrate.ts          -- Dual-path migration (Drizzle folder OR direct SQL)

  monitor/
    index.ts            -- Tiered polling lifecycle (start/stop, 4 intervals)
    poller.ts           -- pollCritical(12s), pollImportant(32s), pollRoutine(5m), pollBackground(30m)
    state-tracker.ts    -- State change detection for nodes/VMs
    thresholds.ts       -- Threshold violation detection
    runbooks.ts         -- Autonomous remediation execution
    guardrails.ts       -- Kill switch, autonomy levels, rate limiting
    reporter.ts         -- Email notification support
    types.ts            -- StateChange, ThresholdViolation, Incident types

  realtime/
    socket.ts           -- Socket.IO server setup, 4 namespaces, JWT auth middleware
    chat.ts             -- /chat namespace: smart routing (needsTools() keyword check), session management
    emitter.ts          -- /cluster namespace: 5 polling loops pushing data to clients
    terminal.ts         -- /terminal namespace: SSH PTY via xterm.js

  clients/
    proxmox.ts          -- ProxmoxClient class (REST over HTTPS:8006, API token auth)
    ssh.ts              -- SSH connection pool (node-ssh, key-based, lazy connect)

  api/
    routes.ts           -- Express Router: /api/health, /api/auth, /api/memory/*, /api/tools/*, /api/monitor/*
    health.ts           -- Health check endpoint

  auth/
    jwt.ts              -- JWT sign/verify + login handler
```

### Current Communication Flow

```
Frontend (React 19 + Zustand + Socket.IO client)
     |
     | HTTP REST + Socket.IO (4 namespaces)
     v
Express 5 + Socket.IO Server (:4000)
     |
     +-- /cluster NS --> emitter.ts --> proxmox.ts (REST) + ssh.ts (temperatures)
     +-- /events  NS --> poller.ts --> proxmox.ts + state-tracker + runbooks
     +-- /chat    NS --> chat.ts --> ai/loop.ts (Claude) OR ai/local-llm.ts (Qwen)
     +-- /terminal NS --> terminal.ts --> ssh.ts (PTY)
     |
     +-- mcp/server.ts --> executeTool() --> tools/*.ts --> proxmox.ts / ssh.ts
     +-- db/memory.ts --> SQLite (better-sqlite3 + Drizzle)
```

### Current Smart Routing (chat.ts)

The existing routing is keyword-based, already functional:

```typescript
// If message contains tool-related keywords AND Claude is available:
//   -> Claude (full agentic loop with tool_use)
// Else:
//   -> Qwen local (text-only, no tools)
```

This is the **exact integration point** for the hybrid LLM upgrade.

### Existing Docker Setup

Both Dockerfiles exist and are functional:
- `jarvis-backend/Dockerfile` -- Multi-stage Node 22-slim, prebuild-install for better-sqlite3
- `jarvis-ui/Dockerfile` -- Multi-stage Node 20-alpine build, Nginx serve
- `docker-compose.yml` at root -- Backend service defined; frontend commented out
- Backend Dockerfile already handles SSH key mount, data volume, and native module build

---

## Integration Architecture: Four New Features

### Overview

Each new feature targets a specific layer of the existing architecture. The key insight is that the existing code already has the **seams** where these features plug in.

```
+-------------------------------------------------------------------+
|  FEATURE 1: Hybrid LLM Router                                     |
|  Replaces: ai/claude.ts + ai/local-llm.ts + chat.ts routing       |
|  New files: ai/router.ts, ai/providers.ts, ai/cost-tracker.ts     |
+-------------------------------------------------------------------+
|  FEATURE 2: Persistent Memory TTL Tiers                            |
|  Extends: db/schema.ts + db/memory.ts + ai/system-prompt.ts       |
|  New files: db/context-builder.ts, db/consolidator.ts              |
+-------------------------------------------------------------------+
|  FEATURE 3: Docker Deployment                                      |
|  Modifies: docker-compose.yml, Dockerfiles, nginx.conf             |
|  New: .env.production, deploy.sh                                   |
+-------------------------------------------------------------------+
|  FEATURE 4: E2E Testing                                            |
|  New: tests/ directory, playwright.config.ts, vitest.config.ts     |
|  Tests against live Proxmox API + Socket.IO connections             |
+-------------------------------------------------------------------+
```

---

## Feature 1: Hybrid LLM Router

### Problem

The current system has two separate code paths:
1. `ai/loop.ts` -- Claude-only agentic loop (streaming + tool_use, tightly coupled to Anthropic SDK types)
2. `ai/local-llm.ts` -- Qwen text-only streaming (no tool support)
3. `realtime/chat.ts` -- Hardcoded keyword-based routing between the two

The routing logic is embedded in chat.ts, making it impossible to use from monitor/poller.ts or API routes. Claude and Qwen have completely different interfaces with no abstraction.

### Integration Points

| Existing Component | How It Changes | Impact |
|---------------------|----------------|--------|
| `ai/claude.ts` | Wrapped by new provider abstraction | No direct changes, becomes internal |
| `ai/local-llm.ts` | Wrapped by new provider abstraction, gains tool support | Extended, not replaced |
| `ai/loop.ts` | Generalized to accept any provider, not just Claude | Signature changes |
| `ai/tools.ts` | Converted to provider-neutral format | Tool definitions become provider-agnostic |
| `ai/system-prompt.ts` | Context budget varies by provider | Parameterized by model context window |
| `realtime/chat.ts` | Delegates routing to ai/router.ts | Simplified, no longer owns routing logic |
| `config.ts` | New config: cost thresholds, routing preferences | Extended |

### New Components

```
ai/
  providers.ts          -- LLMProvider interface + Claude/Qwen implementations
  router.ts             -- Route decision engine (replaces chat.ts keyword logic)
  cost-tracker.ts       -- Token counting, cost accumulation, budget enforcement
```

### Component: LLMProvider Interface

```typescript
// ai/providers.ts

interface LLMProvider {
  name: string;                              // 'claude' | 'qwen-local'
  available: boolean;                        // Runtime availability check
  supportsTools: boolean;                    // Can handle tool_use blocks?
  maxContextTokens: number;                  // 200K for Claude, 4096 for Qwen
  costPerInputToken: number;                 // 0 for local, $X for Claude
  costPerOutputToken: number;                // 0 for local, $X for Claude

  chat(params: ChatParams): Promise<ChatResult>;  // Unified interface
}

interface ChatParams {
  messages: Message[];                       // Provider-neutral message format
  systemPrompt: string;
  tools?: ToolDefinition[];                  // Only sent if provider supports tools
  callbacks: StreamCallbacks;                // Reuse existing StreamCallbacks from loop.ts
  abortSignal?: AbortSignal;
  maxTokens?: number;
}

interface ChatResult {
  pendingConfirmation: PendingConfirmation | null;  // From existing loop.ts type
  usage: { inputTokens: number; outputTokens: number };
  provider: string;
}
```

**Key design decision: Unified interface, NOT unified SDK.**

Do NOT use LiteLLM, OpenRouter, or any external gateway. Reasons:
- Only two providers (Claude API + local llama-server) -- gateway is overkill
- Claude's tool_use protocol is unique; OpenAI-compatible endpoints cannot replicate it
- The existing Anthropic SDK and fetch-based Qwen client work perfectly
- Adding a gateway adds latency, complexity, and a new dependency
- Keep the abstraction thin: just an interface over the two existing implementations

**Confidence: HIGH** -- The existing code already has both providers working. This is a refactor to create a common interface, not a rewrite.

### Component: Router Decision Engine

```typescript
// ai/router.ts

interface RouteDecision {
  provider: 'claude' | 'qwen-local';
  reason: string;
  toolsRequired: boolean;
}

function routeMessage(
  message: string,
  context: RoutingContext,
  config: RoutingConfig,
): RouteDecision;
```

**Routing rules (ordered by priority):**

| Priority | Condition | Route To | Reason |
|----------|-----------|----------|--------|
| 1 | Claude API key missing | Qwen local | Only option |
| 2 | Override passkey detected | Claude | Safety-critical, needs full tool access |
| 3 | Message contains tool keywords | Claude | Tool_use support required |
| 4 | Conversation has pending confirmation | Claude | Must continue agentic loop |
| 5 | Cost budget exceeded for period | Qwen local | Cost control |
| 6 | Context window > 3000 tokens | Claude | Qwen's 4096 limit too small |
| 7 | Simple conversation/greeting | Qwen local | Save Claude tokens |
| 8 | Default | Qwen local | Prefer local for speed + cost |

**Why keyword-based routing instead of a learned router:**

Research shows (xRouter, RouteLLM) that even RL-trained routers converge to simple heuristics. For a two-provider system with clearly different capabilities (tool_use vs text-only), keyword matching is the right approach. The existing `needsTools()` function in chat.ts already works well. Upgrade it with:
- Configurable keyword lists
- Context-aware overrides (budget, availability)
- Telemetry to refine rules over time

### Component: Cost Tracker

```typescript
// ai/cost-tracker.ts

interface CostTracker {
  recordUsage(provider: string, input: number, output: number): void;
  getCurrentPeriodCost(): number;           // Cost in current billing period
  isOverBudget(): boolean;                  // Check against configured limit
  getUsageStats(): UsageStats;              // For dashboard display
}
```

Storage: Use the existing `preferences` table for budget config and `events` table for usage logs. No new tables needed.

### Data Flow Change: Chat Message

```
BEFORE:
  chat:send -> chat.ts -> needsTools() -> Claude loop.ts OR Qwen local-llm.ts

AFTER:
  chat:send -> chat.ts -> router.routeMessage() -> provider.chat() -> callbacks
                             |                          |
                             v                          v
                       cost-tracker.record()     same StreamCallbacks
```

The chat.ts handler becomes thinner. It no longer owns routing logic. It calls `router.routeMessage()`, gets a provider, and calls `provider.chat()`. The StreamCallbacks interface stays identical.

### Tool Support for Qwen (Future Enhancement)

The local Qwen model currently has NO tool support. Adding tool_use to Qwen requires:
1. Structured prompt engineering (Qwen 2.5 supports function calling via ChatML format)
2. JSON extraction from Qwen's response to identify tool calls
3. Same safety pipeline (checkSafety, executeTool)

This is a **separate phase** from the basic routing refactor. Build the abstraction first, then add Qwen tool support later. The provider interface makes this a clean extension.

**Confidence: MEDIUM** -- Qwen 2.5 7B's function calling reliability at Q4_K_M quantization needs empirical testing. The abstraction should be designed to handle unreliable tool extraction gracefully (fall back to text-only).

---

## Feature 2: Persistent Memory with TTL Tiers

### Problem

The current memory system stores everything but has no strategy for:
- What to include in the LLM context window
- When to expire old data
- How to consolidate repeated events into summaries
- Different retention for different data types

The system prompt's `buildClusterSummary()` fetches live state on every message, which is good. But conversation history and event history grow unbounded, and there is no "long-term memory" -- JARVIS forgets everything between sessions.

### Existing Memory Infrastructure

The current `db/memory.ts` already provides:
- `saveEvent()` / `getRecentEvents()` / `getEventsSince()` / `resolveEvent()`
- `saveMessage()` / `getSessionMessages()` / `getRecentSessions()`
- `saveSnapshot()` / `getLatestSnapshot()`
- `setPreference()` / `getPreference()`
- `saveAutonomyAction()` / `cleanupOldActions(30)`

The `conversations` table stores all messages with sessionId, role, content, model, and tokensUsed.

### Integration Points

| Existing Component | How It Changes | Impact |
|---------------------|----------------|--------|
| `db/schema.ts` | New table: `memory_tiers` for long-term knowledge | Schema migration |
| `db/memory.ts` | New methods for tiered retrieval and TTL cleanup | Extended API |
| `ai/system-prompt.ts` | `buildClusterSummary()` becomes `buildContext()` with tiered memory | Core change |
| `monitor/poller.ts` | `pollBackground()` triggers consolidation | New cleanup task |
| `config.ts` | TTL durations, context budget per provider | Extended |

### New Components

```
db/
  context-builder.ts    -- Assemble LLM context from tiered memory sources
  consolidator.ts       -- Periodic event consolidation (many events -> summary)
```

### Three-Tier Memory Architecture

```
+----------------------------------------------------------+
|  Tier 1: Working Memory (in-process, ephemeral)           |
|  Source: Live Proxmox API polls, current session messages  |
|  TTL: Session lifetime (cleared on disconnect)            |
|  Size: ~500-2000 tokens                                   |
|  Contains: Current node status, quorum, VM states         |
|  Already exists: buildClusterSummary() in system-prompt.ts|
+----------------------------------------------------------+
|  Tier 2: Short-Term Memory (SQLite, days)                 |
|  Source: events table, conversations table                |
|  TTL: 7 days (configurable)                               |
|  Size: ~500-1000 tokens (summarized for context)          |
|  Contains: Recent events, recent conversations, actions   |
|  Partially exists: memoryStore.getRecentEvents()          |
+----------------------------------------------------------+
|  Tier 3: Long-Term Memory (SQLite, permanent)             |
|  Source: Consolidated from Tier 2 by consolidator         |
|  TTL: Permanent (manual cleanup only)                     |
|  Size: ~200-500 tokens (high-signal summaries only)       |
|  Contains: Learned patterns, user preferences, recurring  |
|  issues, node personality notes                           |
|  NEW: Requires new table and consolidation logic          |
+----------------------------------------------------------+
```

### New Schema: memory_tiers Table

```sql
CREATE TABLE memory_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  tier TEXT NOT NULL,               -- 'short' | 'long'
  category TEXT NOT NULL,           -- 'event_summary' | 'user_preference' | 'pattern' | 'node_note'
  key TEXT NOT NULL UNIQUE,         -- Dedup key (e.g., 'pattern:agent1_nic_hang')
  content TEXT NOT NULL,            -- Human-readable summary
  relevance_score REAL DEFAULT 1.0, -- Decays over time, boosted by access
  access_count INTEGER DEFAULT 0,   -- How many times included in context
  last_accessed TEXT,               -- When last included in LLM context
  expires_at TEXT                   -- NULL for permanent, datetime for TTL
);

CREATE INDEX idx_memory_tier ON memory_tiers(tier);
CREATE INDEX idx_memory_category ON memory_tiers(category);
CREATE INDEX idx_memory_expires ON memory_tiers(expires_at);
CREATE INDEX idx_memory_relevance ON memory_tiers(relevance_score DESC);
```

### Context Builder

```typescript
// db/context-builder.ts

interface ContextBudget {
  totalTokens: number;          // Max tokens for context section
  tier1Tokens: number;          // Budget for live state
  tier2Tokens: number;          // Budget for recent events/actions
  tier3Tokens: number;          // Budget for long-term knowledge
}

function buildLLMContext(budget: ContextBudget): string {
  // 1. Tier 1: Live cluster state (from existing buildClusterSummary)
  //    Always included, ~500-800 tokens

  // 2. Tier 2: Recent events + unresolved issues
  //    Sorted by severity DESC, timestamp DESC
  //    Truncated to budget

  // 3. Tier 3: Long-term knowledge relevant to current context
  //    Sorted by relevance_score DESC
  //    Only include if budget allows

  // 4. Assemble into structured text block
  return `<cluster_context>
${tier1Content}
</cluster_context>

<recent_activity>
${tier2Content}
</recent_activity>

<knowledge>
${tier3Content}
</knowledge>`;
}
```

**Context budgets by provider:**

| Provider | Total Budget | Tier 1 (Live) | Tier 2 (Recent) | Tier 3 (Knowledge) |
|----------|-------------|---------------|-----------------|---------------------|
| Claude | 5000 tokens | 1000 | 2500 | 1500 |
| Qwen local | 1500 tokens | 800 | 500 | 200 |

### Consolidation Engine

```typescript
// db/consolidator.ts

// Runs on pollBackground() interval (every 30 minutes)
async function consolidateMemory(): Promise<void> {
  // 1. TTL cleanup: Delete expired short-term memories
  deleteExpiredMemories();

  // 2. Event consolidation: Group similar recent events into summaries
  //    Example: 15 "Node agent temp warning" events -> "agent node experienced
  //    repeated thermal warnings over 3 hours"
  consolidateRepeatedEvents();

  // 3. Relevance decay: Reduce relevance_score of unaccessed memories
  //    score *= 0.95 per consolidation cycle
  decayUnusedMemories();

  // 4. Conversation mining: Extract learned facts from recent conversations
  //    Example: User said "I prefer short responses" -> store as user preference
  //    NOTE: This is a FUTURE enhancement, not MVP
}
```

**Critical design constraint:** The consolidator must be simple and deterministic. Do NOT use LLM calls for consolidation (expensive, slow, unreliable). Use pattern matching and SQL aggregation instead. LLM-powered summarization can be added later as an enhancement.

### Integration with Existing Cleanup

The existing `pollBackground()` in `monitor/poller.ts` already calls `memoryStore.cleanupOldActions(30)`. The new consolidation hooks into the same cycle:

```
pollBackground() [every 30 min]
  -> Storage capacity check (existing)
  -> cleanupOldActions(30) (existing)
  -> consolidateMemory() (NEW)
```

**Confidence: HIGH** -- The existing memory infrastructure provides a solid foundation. The three-tier model adds structure without requiring major schema changes. The new `memory_tiers` table is additive.

---

## Feature 3: Docker Deployment

### Problem

The current Docker setup is partially functional:
- Backend Dockerfile works (multi-stage, handles better-sqlite3 native module)
- Frontend Dockerfile works (multi-stage, Nginx serve)
- docker-compose.yml has backend defined, frontend commented out
- The frontend currently runs via `npm run dev` (Vite dev server), not containerized
- No production .env template
- No deployment script for the management VM

### Current Docker State (Verified from Files)

**Backend Dockerfile** (`jarvis-backend/Dockerfile`):
- Stage 1: `node:22-slim`, `npm ci --ignore-scripts`, `prebuild-install` for better-sqlite3
- Stage 2: `node:22-slim`, copies dist + node_modules, creates `/app/.ssh` and `/data`
- Missing: `USER node` (runs as root), no build-essential in builder (relies on prebuild)

**Frontend Dockerfile** (`jarvis-ui/Dockerfile`):
- Stage 1: `node:20-alpine`, `npm install` (should be `npm ci`), builds with Vite
- Stage 2: `nginx:alpine`, copies dist to `/usr/share/nginx/html`
- Has `nginx.conf` with SPA fallback, gzip, security headers
- Missing: No API proxy configuration (frontend connects directly to backend)

**docker-compose.yml**:
- Backend service: port 4000, data volume, SSH key mount, env vars
- Frontend: commented out
- Network: `jarvis-net` bridge

### Integration Points

| Existing Component | How It Changes | Impact |
|---------------------|----------------|--------|
| `jarvis-backend/Dockerfile` | Harden: add build-essential, USER node, healthcheck | Security + reliability |
| `jarvis-ui/Dockerfile` | Fix: npm ci, add API/WS proxy in nginx.conf | Production-ready |
| `docker-compose.yml` | Enable frontend, add env vars for all features | Full stack deployment |
| `jarvis-ui/nginx.conf` | Add reverse proxy for /api and /socket.io | Single entry point |
| `.env` files | Create .env.production template | Deployment standardization |

### Target Docker Architecture

```
Management VM (192.168.1.65)
  |
  +-- Docker Compose
       |
       +-- jarvis-frontend (nginx:alpine)
       |     Port 3004:80
       |     Serves: React SPA static files
       |     Proxies: /api/* -> jarvis-backend:4000
       |     Proxies: /socket.io/* -> jarvis-backend:4000 (WebSocket upgrade)
       |
       +-- jarvis-backend (node:22-slim)
             Port 4000 (internal only, not exposed to host)
             Volumes:
               - jarvis-data:/data (SQLite)
               - SSH key mount (read-only)
             Env: ANTHROPIC_API_KEY, PVE_TOKEN_SECRET, JWT_SECRET, etc.
             Connects to:
               - Proxmox nodes (HTTPS:8006, SSH:22)
               - llama-server (HTTP:8080 on 192.168.1.50)
               - Claude API (HTTPS, external)
```

### Critical: Nginx Reverse Proxy for Socket.IO

The current `nginx.conf` only serves static files. For production, Nginx must proxy both REST and WebSocket traffic to the backend. Socket.IO requires specific proxy configuration:

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript
               application/javascript application/json application/xml;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Socket.IO WebSocket + polling (MUST be before /api)
    location /socket.io/ {
        proxy_pass http://jarvis-backend:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # REST API proxy
    location /api/ {
        proxy_pass http://jarvis-backend:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
```

### Backend Dockerfile Improvements

The existing Dockerfile has a subtle issue: `--ignore-scripts` prevents better-sqlite3 from compiling, then `prebuild-install` tries to download a prebuilt binary. This works on x86_64 but is fragile. A more robust approach:

```dockerfile
# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app

# Install build tools for native modules
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 build-essential && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:22-slim
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends wget && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

RUN mkdir -p /app/.ssh && chmod 700 /app/.ssh
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --spider -q http://localhost:4000/api/health || exit 1

CMD ["node", "dist/index.js"]
```

### SSH Key Access in Container

The backend needs SSH access to cluster nodes. The current approach (volume-mounting the host SSH key) is correct:

```yaml
volumes:
  - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro
```

The config already sets `SSH_KEY_PATH=/app/.ssh/id_ed25519`. No changes needed here.

### Environment Variable Strategy

```
.env.production (template, NOT committed):
  NODE_ENV=production
  PORT=4000
  JWT_SECRET=<generate-unique>
  JARVIS_PASSWORD=<set-password>
  JARVIS_OVERRIDE_KEY=<set-passkey>
  ANTHROPIC_API_KEY=<claude-api-key>
  PVE_TOKEN_ID=root@pam!jarvis
  PVE_TOKEN_SECRET=<proxmox-token>
  DB_PATH=/data/jarvis.db
  SSH_KEY_PATH=/app/.ssh/id_ed25519
  LOCAL_LLM_ENDPOINT=http://192.168.1.50:8080
  LOCAL_LLM_MODEL=qwen2.5-7b-instruct-q4_k_m.gguf
  NODE_TLS_REJECT_UNAUTHORIZED=0
```

### Resource Budget Validation

The management VM (192.168.1.65) has 4 vCPUs, 8GB RAM, and already runs 16 Docker containers. Based on the existing docker-compose and typical Node.js memory footprint:

| Container | Expected RAM | Expected CPU |
|-----------|-------------|-------------|
| jarvis-backend | 150-300 MB | 0.2-0.5 cores (idle), spikes during LLM streaming |
| jarvis-frontend | 20-50 MB | Near zero (Nginx serving static files) |
| **Total** | **170-350 MB** | **0.2-0.5 cores** |

This is well within the available budget. Set memory limits in docker-compose as guardrails:

```yaml
deploy:
  resources:
    limits:
      memory: 512M
```

**Confidence: HIGH** -- Both Dockerfiles already exist and work. This is hardening and completing what is 80% done.

---

## Feature 4: E2E Testing

### Problem

The project has zero tests. No unit tests, no integration tests, no E2E tests. For a system that manages live infrastructure with autonomous remediation capabilities, this is a significant gap.

### Testing Strategy

Given the nature of Jarvis (infrastructure management against live Proxmox API), the testing approach must be:

1. **Unit tests (Vitest)**: Test pure logic in isolation -- routing decisions, safety tier checks, context building, cost tracking
2. **Integration tests (Vitest)**: Test module interactions with real SQLite (in-memory), mocked Proxmox API
3. **E2E tests (Playwright)**: Test the full stack through the browser -- dashboard loads, chat works, tools execute against live cluster

### Integration Points

| Existing Component | How It's Tested | New Infrastructure |
|---------------------|-----------------|-------------------|
| `ai/router.ts` | Unit test routing decisions | Vitest |
| `safety/tiers.ts` | Unit test tier classification | Vitest |
| `db/memory.ts` | Integration test with in-memory SQLite | Vitest |
| `db/context-builder.ts` | Unit test context assembly | Vitest |
| `mcp/server.ts` | Integration test executeTool pipeline | Vitest + mocked proxmox |
| `realtime/chat.ts` | E2E test through browser | Playwright |
| Full dashboard | E2E: login, view cluster, send chat, view terminal | Playwright |

### New Components

```
tests/
  vitest.config.ts       -- Vitest configuration
  playwright.config.ts   -- Playwright configuration

  unit/
    router.test.ts       -- LLM routing logic
    tiers.test.ts        -- Safety tier classification
    cost-tracker.test.ts -- Cost tracking and budget checks
    context-builder.test.ts -- Context assembly

  integration/
    memory.test.ts       -- Memory store with real SQLite
    tools.test.ts        -- Tool execution pipeline (mocked Proxmox)
    safety.test.ts       -- Full safety pipeline

  e2e/
    dashboard.spec.ts    -- Login, view cluster status
    chat.spec.ts         -- Send message, receive streaming response
    tools.spec.ts        -- Execute tool via chat, verify result
    terminal.spec.ts     -- Open terminal session

  fixtures/
    proxmox-responses.ts -- Recorded Proxmox API responses for mocking
    cluster-state.ts     -- Standard cluster state for tests

  helpers/
    test-db.ts           -- In-memory SQLite for integration tests
    mock-proxmox.ts      -- HTTP mock server for Proxmox API
    test-auth.ts         -- JWT token generation for tests
```

### E2E Test Architecture Against Live Infrastructure

The E2E tests have a unique requirement: they test against the **real** Proxmox cluster API, not mocks. This is because:
- The system's value is in real cluster management
- Mocking the Proxmox API defeats the purpose of E2E testing
- The homelab environment is always available

**Safety constraints for E2E tests:**
- Only use GREEN-tier (read-only) tools in automated tests
- Never start/stop VMs or containers in automated tests
- Test RED/BLACK tier tools only via the confirmation UI flow (verify the confirmation dialog appears, do not confirm)
- Use a dedicated test session ID prefix (`test-`) for cleanup

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://192.168.1.65:3004',   // Management VM
    // OR for local dev:
    // baseURL: 'http://localhost:5173',
  },
  webServer: {
    // For CI/local dev, start the backend
    command: 'npm run dev',
    port: 4000,
    reuseExistingServer: true,
  },
});
```

### Test Against Live vs. Mock

| Test Type | Proxmox API | LLM | SQLite | Frontend |
|-----------|-------------|-----|--------|----------|
| Unit | Not used | Not used | Not used | Not used |
| Integration | Mocked (HTTP mock) | Mocked | Real (in-memory) | Not used |
| E2E (local dev) | Live cluster | Mocked (fast, deterministic) | Real (file) | Real (browser) |
| E2E (deployed) | Live cluster | Real (both providers) | Real (file) | Real (browser) |

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
```

### Mock Strategy for Integration Tests

For integration tests that need Proxmox API responses without hitting the live cluster:

```typescript
// tests/helpers/mock-proxmox.ts
// Record real responses once, replay in tests

import { createServer } from 'node:http';

// Recorded from live cluster
const MOCK_RESPONSES = {
  '/api2/json/cluster/status': { data: [/* recorded data */] },
  '/api2/json/cluster/resources?type=node': { data: [/* recorded data */] },
  '/api2/json/cluster/resources?type=vm': { data: [/* recorded data */] },
};

export function startMockProxmox(port: number): Promise<() => void> {
  const server = createServer((req, res) => {
    const response = MOCK_RESPONSES[req.url ?? ''];
    if (response) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise(resolve => {
    server.listen(port, () => {
      resolve(() => server.close());
    });
  });
}
```

**Confidence: MEDIUM** -- The testing architecture is well-established (Vitest + Playwright is the standard 2025/2026 stack for Vite projects). However, testing against live Proxmox infrastructure introduces test stability risks (node offline = test failure). Need clear test categories: stable (mocked) vs. live (may flake).

---

## Suggested Build Order

The four features have clear dependency relationships:

```
Phase 1: Hybrid LLM Router
  Depends on: Nothing new (refactors existing code)
  Blocks: Persistent Memory (context builder needs to know provider budgets)
  Deliverables: ai/providers.ts, ai/router.ts, ai/cost-tracker.ts
  Risk: Low (refactoring known code)

Phase 2: Persistent Memory + TTL Tiers
  Depends on: Hybrid LLM Router (context budgets per provider)
  Blocks: Nothing (independent)
  Deliverables: db/context-builder.ts, db/consolidator.ts, schema migration
  Risk: Low (extending existing SQLite infrastructure)

Phase 3: Docker Deployment
  Depends on: All code changes complete (Phases 1-2)
  Blocks: E2E Testing (tests run against deployed containers)
  Deliverables: Updated Dockerfiles, docker-compose.yml, nginx.conf, deploy script
  Risk: Low (Docker setup already 80% done)

Phase 4: E2E Testing
  Depends on: Docker Deployment (tests against running stack)
  Blocks: Nothing
  Deliverables: tests/ directory, vitest.config.ts, playwright.config.ts
  Risk: Medium (live infrastructure testing requires stability patterns)
```

**Why this order:**

1. **LLM Router first** because it refactors the AI module without changing external behavior. It creates the provider abstraction that all other features depend on. The context builder needs to know provider budgets. Cost tracking provides data for the dashboard.

2. **Persistent Memory second** because it extends the database layer (additive changes) and integrates with the newly abstracted LLM providers. The context builder needs to produce different-sized context blocks for Claude vs. Qwen.

3. **Docker Deployment third** because it should package the complete, working application. Deploying before features are complete means redeploying after every change. Deploy once when the code is stable.

4. **E2E Testing last** because it tests the deployed system end-to-end. You cannot write meaningful E2E tests until the features exist and the deployment pipeline works. Unit tests for individual features (router, memory) should be written alongside the feature code in Phases 1-2.

**Exception: Write unit tests alongside feature code.** While the E2E test infrastructure goes in Phase 4, individual unit tests for the router, cost tracker, and context builder should be created during Phases 1-2. Phase 4 is for the E2E test harness + integration test infrastructure.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: External LLM Gateway for Two Providers

**What:** Using LiteLLM, OpenRouter, or a separate gateway service to abstract Claude + Qwen.

**Why bad for this project:**
- Adds a new service to manage on resource-constrained management VM
- Claude's tool_use protocol is fundamentally different from OpenAI's function calling
- Two providers do not justify gateway overhead
- Adds latency hop on every request
- New dependency to monitor, update, and debug

**Instead:** Thin TypeScript interface (LLMProvider) with two implementations. Direct SDK calls. The abstraction lives in application code, not in a proxy.

### Anti-Pattern 2: LLM-Powered Memory Consolidation

**What:** Using Claude or Qwen to summarize/consolidate events into long-term memories.

**Why bad:**
- Expensive (Claude API calls for background maintenance)
- Slow (blocks consolidation on LLM response time)
- Unreliable (LLM may hallucinate or produce poor summaries)
- Circular dependency (memory system depends on LLM, LLM depends on memory)

**Instead:** SQL aggregation + pattern matching for consolidation. Group similar events by key, count occurrences, produce deterministic summaries. Simple, fast, free.

### Anti-Pattern 3: Exposing Backend Port to Host Network

**What:** Mapping port 4000 to the management VM's network so the frontend connects directly.

**Why bad:**
- Two exposed ports (3004 for frontend, 4000 for backend)
- No single entry point
- WebSocket connections bypass any future TLS termination
- CORS configuration complexity

**Instead:** Frontend Nginx proxies all traffic. Only port 3004 is exposed. Backend port 4000 is internal to the Docker network. Single entry point, single CORS origin.

### Anti-Pattern 4: Testing Against Live LLM in CI

**What:** Running E2E tests that require Claude API responses.

**Why bad:**
- Tests become flaky (API latency, rate limits, model behavior changes)
- Tests cost money per run
- Tests are slow (seconds per LLM response)
- Non-deterministic (same prompt, different response)

**Instead:** Mock LLM responses in integration tests. For E2E, test the UI flow (message sent, streaming tokens appear) with a lightweight mock server that returns canned responses. Only test against real LLM in manual/smoke tests.

### Anti-Pattern 5: Unbounded Event Storage

**What:** Storing every event forever without TTL, letting the SQLite database grow unbounded.

**Why bad:**
- SQLite performance degrades with millions of rows (especially without VACUUM)
- Context retrieval queries slow down
- Disk space consumption on resource-constrained VM
- Old events lose relevance but still consume query time

**Instead:** TTL-based cleanup in pollBackground() (already partially implemented with `cleanupOldActions(30)`). Extend to all event types with configurable retention: 7 days for raw events, 30 days for actions, permanent for long-term memories.

---

## Sources

### HIGH Confidence (Verified Against Codebase)
- All component details verified by reading every TypeScript source file in jarvis-backend/src/
- Docker configuration verified from existing Dockerfiles and docker-compose.yml
- Current routing logic verified from realtime/chat.ts source code
- Memory schema verified from db/schema.ts and db/memory.ts source code

### HIGH Confidence (Official Documentation)
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) -- Tool use, streaming, message format
- [Socket.IO v4 documentation](https://socket.io/docs/v4/) -- Namespace configuration, proxy setup
- [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) -- proxy_pass + upgrade headers
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/) -- Best practices for Node.js
- [better-sqlite3 Docker](https://github.com/WiseLibs/better-sqlite3/discussions/1270) -- Native module compilation in containers

### MEDIUM Confidence (Multiple Sources Agree)
- [Multi-tier persistent memory for LLMs](https://healthark.ai/persistent-memory-for-llms-designing-a-multi-tier-context-system/) -- TTL tiers, relevance scoring, context budgets
- [Playwright E2E testing guide](https://www.deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/) -- WebSocket handling, auto-waiting
- [Vitest + Playwright complementary testing](https://www.browserstack.com/guide/vitest-vs-playwright) -- Unit vs E2E responsibilities
- [LLM cost optimization patterns](https://byteiota.com/llm-cost-optimization-stop-overpaying-5-10x-in-2026/) -- Tiered routing, local-first strategy
- [xRouter cost-aware routing research](https://arxiv.org/html/2510.08439v1) -- RL-trained routers converge to simple heuristics

### LOW Confidence (Needs Validation)
- Qwen 2.5 7B function calling reliability at Q4_K_M quantization -- needs empirical testing
- Exact memory overhead of jarvis-backend container -- estimate based on similar Node.js apps
- Playwright WebSocket test stability against live Proxmox -- needs testing in practice

---

*Architecture research for milestone integration: 2026-01-26*

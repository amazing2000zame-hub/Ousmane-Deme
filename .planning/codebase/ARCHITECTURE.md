# Architecture

**Analysis Date:** 2026-01-31

## Pattern Overview

**Overall:** Real-time event-driven architecture with autonomous monitoring

**Key Characteristics:**
- WebSocket-based bidirectional communication (Socket.IO) between backend and frontend
- Intent-based AI routing (Claude for cluster actions, Qwen for conversation)
- 4-tier safety system (GREEN/YELLOW/ORANGE/RED/BLACK) for action classification
- Multi-namespace Socket.IO design for separation of concerns
- Autonomous monitoring with tiered polling intervals (12s critical, 32s important, 5min routine, 30min background)
- SQLite-based event sourcing for all cluster state changes and AI interactions

## Layers

**Presentation Layer:**
- Purpose: React-based UI with real-time updates
- Location: `jarvis-ui/src/`
- Contains: Components, Zustand stores, Socket.IO hooks, visualization effects
- Depends on: Backend Socket.IO namespaces, REST API for auth/tools
- Used by: End users via browser

**API Gateway Layer:**
- Purpose: HTTP REST endpoints and Socket.IO namespace orchestration
- Location: `jarvis-backend/src/api/`, `jarvis-backend/src/realtime/`
- Contains: Express routes, Socket.IO handlers, JWT authentication middleware
- Depends on: MCP server, AI providers, database, Proxmox clients
- Used by: Frontend (both REST and WebSocket)

**AI Orchestration Layer:**
- Purpose: Intent routing, multi-provider LLM coordination, tool execution pipeline
- Location: `jarvis-backend/src/ai/`, `jarvis-backend/src/mcp/`
- Contains: Router, providers (Claude/Qwen), MCP server, tool registry, safety enforcement
- Depends on: External APIs (Anthropic, local Qwen), safety layer, database
- Used by: Chat/voice handlers in realtime layer

**Safety & Validation Layer:**
- Purpose: Multi-tier action classification, input sanitization, protected resource checks
- Location: `jarvis-backend/src/safety/`
- Contains: Tier classification, path sanitization, keyword approval, context overrides
- Depends on: Configuration (protected paths, tier mappings)
- Used by: MCP server before every tool execution

**Infrastructure Integration Layer:**
- Purpose: External service clients and SSH execution
- Location: `jarvis-backend/src/clients/`
- Contains: Proxmox API client, SSH client with connection pooling, Frigate client, Home Assistant client
- Depends on: undici (HTTP), node-ssh (SSH), environment configuration
- Used by: MCP tools, monitor service, emitter service

**Autonomous Monitoring Layer:**
- Purpose: State tracking, threshold evaluation, automatic remediation
- Location: `jarvis-backend/src/monitor/`
- Contains: State tracker, threshold evaluator, poller (4 tiers), guardrails, runbooks
- Depends on: Proxmox clients, events namespace for emission
- Used by: Background polling loops started in index.ts

**Data Persistence Layer:**
- Purpose: Event sourcing, conversation history, cluster snapshots, memories
- Location: `jarvis-backend/src/db/`
- Contains: Drizzle ORM schema, memory store, memory bank (TTL tiers)
- Depends on: SQLite (better-sqlite3)
- Used by: All layers that emit events or store state

## Data Flow

**Cluster State Polling Flow:**

1. `realtime/emitter.ts` polls Proxmox API every 10-30s via `clients/proxmox.ts`
2. Data normalized into typed structures (NodeData, VMData, StorageData, QuorumData)
3. Emitted to Socket.IO `/cluster` namespace
4. Frontend `hooks/useClusterSocket.ts` receives events
5. Updates Zustand `stores/cluster.ts` (with reference equality diffing for PERF-17)
6. React components re-render only changed items

**AI Chat Interaction Flow:**

1. User sends message via `components/center/ChatPanel.tsx`
2. Frontend `hooks/useChatSocket.ts` emits `chat:send` to `/chat` namespace
3. Backend `realtime/chat.ts` receives message
4. `ai/router.ts` evaluates intent → routes to Claude or Qwen provider
5. `ai/loop.ts` streams response with tool execution pipeline
6. Each tool call goes through `mcp/server.ts` → `safety/tiers.ts` → tool handler
7. Tool results and streaming tokens emitted back to client
8. Frontend updates `stores/chat.ts` and displays in UI
9. All events logged to `db/schema.ts` events table

**Autonomous Monitoring Flow:**

1. `monitor/index.ts` starts 4 tiered polling loops on startup
2. `monitor/poller.ts` executes critical (12s), important (32s), routine (5min), background (30min)
3. `monitor/state-tracker.ts` detects state changes (node offline, VM status change)
4. `monitor/thresholds.ts` evaluates resource thresholds (CPU >80%, disk >90%)
5. Events emitted to `/events` namespace
6. Frontend `hooks/useEventsSocket.ts` receives and pushes to `stores/cluster.ts`
7. `components/alerts/AlertNotification.tsx` displays toast notifications
8. Events stored in `db/memory.ts` for historical analysis

**Tool Execution Pipeline:**

1. Tool call initiated from AI loop or API endpoint
2. `mcp/server.ts` executeTool() entry point
3. `safety/sanitize.ts` sanitizes all inputs (node names, paths)
4. `safety/tiers.ts` checkSafety() enforces tier rules
5. For ORANGE tier: `safety/keyword-approval.ts` validates approval keyword
6. For RED tier: requires `confirmed: true` flag in args
7. Tool handler executes (e.g., `mcp/tools/lifecycle.ts`)
8. Result logged to `db/memory.ts` as autonomy action
9. Success/failure emitted back through Socket.IO

**State Management:**
- Frontend: Zustand stores with devtools middleware (`stores/` directory)
- Backend: In-memory state in emitter/monitor modules + SQLite persistence
- Real-time sync: Socket.IO push model (no polling from frontend)

## Key Abstractions

**MCP Server (Model Context Protocol):**
- Purpose: Unified tool registry and execution pipeline
- Examples: `mcp/server.ts`, `mcp/tools/*.ts`
- Pattern: Tool registration via SDK, direct handler invocation for in-process execution

**Socket.IO Namespaces:**
- Purpose: Logical separation of real-time channels
- Examples: `/cluster` (state), `/events` (alerts), `/terminal` (SSH PTY), `/chat` (AI), `/voice` (voice mode)
- Pattern: Namespace-level JWT auth middleware, typed event emitters

**Zustand Stores:**
- Purpose: Frontend global state with minimal boilerplate
- Examples: `stores/cluster.ts`, `stores/chat.ts`, `stores/auth.ts`
- Pattern: create() with devtools, selector-based subscriptions, reference equality for performance

**AI Providers:**
- Purpose: Abstract multi-LLM support behind common interface
- Examples: `ai/providers/claude-provider.ts`, `ai/providers/qwen-provider.ts`
- Pattern: LLMProvider interface with streamChat() method, tool format normalization

**Safety Tiers:**
- Purpose: Classify every cluster action by risk level
- Examples: ActionTier enum in `safety/tiers.ts`, TOOL_TIERS mapping
- Pattern: Fail-safe (unknown = BLACK), tier-specific enforcement logic

**Memory Store:**
- Purpose: Event sourcing and persistent state
- Examples: `db/memory.ts` (in-memory + SQLite), `db/memories.ts` (TTL tiers)
- Pattern: Drizzle ORM schema with insert/query helpers, TTL-based expiration

**Proxmox Client:**
- Purpose: Type-safe Proxmox VE API wrapper
- Examples: `clients/proxmox.ts`
- Pattern: Per-node instances with token auth, undici Agent for self-signed TLS, cached cluster status

**SSH Client:**
- Purpose: Connection pooling for cluster SSH operations
- Examples: `clients/ssh.ts`
- Pattern: node-ssh with connection map, exec helper with timeout, PTY support for terminal

## Entry Points

**Backend Server:**
- Location: `jarvis-backend/src/index.ts`
- Triggers: `npm run dev` or Docker container start
- Responsibilities: Express setup, Socket.IO initialization, migration runner, service startup (emitter, monitor, MQTT alert, memory cleanup)

**Frontend Application:**
- Location: `jarvis-ui/src/main.tsx` → `App.tsx`
- Triggers: Vite dev server or nginx serving static build
- Responsibilities: Root render, auth check, Socket.IO connection establishment, theme application

**MCP Tool Execution:**
- Location: `jarvis-backend/src/mcp/server.ts` executeTool()
- Triggers: AI tool calls, API /api/tools/execute, monitor autonomous actions
- Responsibilities: Sanitize → checkSafety → execute handler → log → return result

**AI Chat Handler:**
- Location: `jarvis-backend/src/realtime/chat.ts` setupChatHandlers()
- Triggers: Socket.IO `chat:send` event from frontend
- Responsibilities: Intent routing, provider selection, streaming loop, tool execution, TTS synthesis, memory extraction

**Voice Handler:**
- Location: `jarvis-backend/src/realtime/voice.ts` setupVoiceHandlers()
- Triggers: Socket.IO `voice:audio_chunk` from frontend
- Responsibilities: STT transcription (Whisper), intent routing, streaming response with sentence-level TTS, Opus encoding

**Terminal Handler:**
- Location: `jarvis-backend/src/realtime/terminal.ts` setupTerminalHandlers()
- Triggers: Socket.IO `terminal:start` from frontend
- Responsibilities: SSH PTY allocation, bidirectional data streaming, resize handling, session cleanup

## Error Handling

**Strategy:** Layered error boundaries with fail-safe defaults

**Patterns:**
- Backend tool execution: Try-catch in executeTool(), errors returned as `{ isError: true, content }`, never throw to AI
- Socket.IO errors: Per-socket error events (`chat:error`, `voice:error`), connection errors trigger logout
- Frontend: Toast notifications (sonner) for user-facing errors, console.error for debugging, auth errors trigger logout
- AI provider fallback: Claude unavailable → route to Qwen (cost fallback), TTS unavailable → text-only mode
- Safety tier blocks: Return `{ blocked: true, reason, tier }`, frontend displays confirmation UI for RED tier
- Database migrations: Try-catch in startup, log warning and continue without persistence if failed
- SSH operations: 15s timeout on all SSH exec calls, connection cleanup on error

## Cross-Cutting Concerns

**Logging:**
- Backend: console.log with module prefixes (`[Monitor]`, `[Chat]`, `[MCP]`)
- Frontend: Performance comments inline (PERF-XXX), minimal console output in production
- Database: All events, actions, and errors logged to SQLite `events` table

**Validation:**
- Input: Zod schemas for MCP tool parameters (SDK-provided validation)
- Paths: `safety/paths.ts` sanitizePath() prevents directory traversal, checks against protected paths
- Node names: `safety/sanitize.ts` sanitizeNodeName() validates against config.nodes
- URLs: `safety/urls.ts` validateUrl() for download_file and web_search tools

**Authentication:**
- Backend: JWT tokens (jsonwebtoken), auth middleware on all /api/* routes except login and public image proxies
- Socket.IO: Handshake auth middleware on all namespaces, token passed in `socket.handshake.auth.token`
- Frontend: Zustand auth store with localStorage persistence, token injected into fetch and Socket.IO clients

---

*Architecture analysis: 2026-01-31*

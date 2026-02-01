# Codebase Structure

**Analysis Date:** 2026-01-31

## Directory Layout

```
jarvis-backend/
├── src/
│   ├── __tests__/         # Vitest unit tests
│   ├── ai/                # AI orchestration (router, providers, tools, TTS, STT)
│   │   └── providers/     # LLM provider implementations
│   ├── api/               # Express REST routes
│   ├── auth/              # JWT authentication
│   ├── clients/           # External service clients (Proxmox, SSH, Frigate, HA)
│   ├── db/                # Database schema and memory stores
│   ├── mcp/               # Model Context Protocol server and tools
│   │   └── tools/         # Tool implementations by category
│   ├── monitor/           # Autonomous monitoring system
│   ├── presence/          # User presence detection
│   ├── realtime/          # Socket.IO handlers (chat, voice, terminal, emitter)
│   ├── safety/            # Safety tier system and validation
│   ├── services/          # Background services (cleanup, alerts, MQTT)
│   ├── config.ts          # Configuration singleton
│   └── index.ts           # Application entry point
├── data/                  # SQLite database files (gitignored)
├── dist/                  # Compiled JavaScript output
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
└── Dockerfile             # Container image definition

jarvis-ui/
├── src/
│   ├── audio/             # Audio processing utilities
│   ├── components/        # React components
│   │   ├── alerts/        # Alert/notification toasts
│   │   ├── boot/          # Boot sequence animation
│   │   ├── camera/        # Camera/security panels
│   │   ├── center/        # Center display (chat, globe, activity feed)
│   │   ├── layout/        # Top-level layout (Dashboard, TopBar)
│   │   ├── left/          # Left sidebar (nodes, VMs, storage)
│   │   ├── right/         # Right sidebar (terminal, cost)
│   │   └── shared/        # Reusable components
│   ├── effects/           # Visual effects (scan lines, grid background)
│   ├── hooks/             # Custom React hooks (Socket.IO, keyboard nav, voice)
│   ├── services/          # API clients and Socket.IO factories
│   ├── stores/            # Zustand state management
│   ├── theme/             # Tailwind color theme definitions
│   ├── types/             # TypeScript type definitions
│   ├── utils/             # Helper functions (format, etc.)
│   ├── vendor/            # Third-party code (globe.js)
│   ├── App.tsx            # Root component with auth routing
│   ├── main.tsx           # ReactDOM entry point
│   └── index.css          # Global Tailwind styles
├── public/                # Static assets
├── dist/                  # Production build output
├── package.json           # Dependencies and scripts
├── vite.config.ts         # Vite bundler configuration
└── Dockerfile             # Container image with nginx
```

## Directory Purposes

**jarvis-backend/src/ai/**
- Purpose: AI provider orchestration, intent routing, tool execution loop
- Contains: Claude/Qwen providers, router, cost tracker, TTS/STT, memory extraction, context management
- Key files: `router.ts` (intent-based routing), `loop.ts` (streaming execution), `tts.ts` (XTTS synthesis + caching)

**jarvis-backend/src/api/**
- Purpose: HTTP REST endpoints for auth, health, tools, camera, memory
- Contains: Express routers with auth middleware
- Key files: `routes.ts` (main router + monitor routes), `health.ts`, `camera.ts`, `cost.ts`, `memory.ts`, `tts.ts`

**jarvis-backend/src/clients/**
- Purpose: External service integration with connection management
- Contains: Proxmox client (per-node instances), SSH client (connection pool), Frigate, Home Assistant, registry
- Key files: `proxmox.ts` (API wrapper), `ssh.ts` (exec + PTY), `frigate.ts` (camera events)

**jarvis-backend/src/db/**
- Purpose: Database schema and in-memory state stores
- Contains: Drizzle ORM schema, memory store (events + preferences), memory bank (TTL tiers), migrations
- Key files: `schema.ts` (tables), `memory.ts` (event store), `memories.ts` (semantic memory), `migrate.ts`

**jarvis-backend/src/mcp/**
- Purpose: Tool registry and execution pipeline with safety enforcement
- Contains: MCP server, tool registration functions
- Key files: `server.ts` (executeTool entry point), `tools/*.ts` (9 tool categories)

**jarvis-backend/src/mcp/tools/**
- Purpose: Tool implementations grouped by domain
- Contains: cluster.ts, lifecycle.ts, system.ts, files.ts, transfer.ts, projects.ts, voice.ts, smarthome.ts, web.ts
- Key files: `cluster.ts` (13 tools), `lifecycle.ts` (start/stop/restart VMs), `files.ts` (read/list with path safety)

**jarvis-backend/src/monitor/**
- Purpose: Autonomous monitoring with tiered polling
- Contains: State tracker, threshold evaluator, poller loops, guardrails, runbooks, reporter
- Key files: `index.ts` (lifecycle), `poller.ts` (4 polling tiers), `state-tracker.ts`, `thresholds.ts`

**jarvis-backend/src/realtime/**
- Purpose: Socket.IO namespace handlers for bidirectional communication
- Contains: Chat, voice, terminal, emitter (polling), socket setup, timing utilities
- Key files: `chat.ts` (AI chat), `voice.ts` (voice mode), `terminal.ts` (SSH PTY), `emitter.ts` (cluster state polling)

**jarvis-backend/src/safety/**
- Purpose: Multi-tier safety system and input validation
- Contains: Tier classification, path sanitization, protected resource checks, keyword approval, context overrides
- Key files: `tiers.ts` (4-tier system), `paths.ts` (path validation), `sanitize.ts`, `keyword-approval.ts`

**jarvis-backend/src/services/**
- Purpose: Background services started on server init
- Contains: Memory cleanup (TTL expiration), alert monitor (REST fallback), MQTT alert service
- Key files: `memory-cleanup.ts`, `alert-monitor.ts`, `mqtt-alert-service.ts`

**jarvis-ui/src/components/**
- Purpose: React component tree organized by layout region
- Contains: 8 subdirectories for logical grouping
- Key files: `layout/Dashboard.tsx` (3-column grid), `center/ChatPanel.tsx`, `right/TerminalPanel.tsx`

**jarvis-ui/src/hooks/**
- Purpose: Custom React hooks for shared logic
- Contains: Socket.IO hooks (cluster, events, chat, voice), terminal hook, keyboard nav, speech recognition
- Key files: `useClusterSocket.ts`, `useChatSocket.ts`, `useVoice.ts`, `useTerminal.ts`

**jarvis-ui/src/stores/**
- Purpose: Zustand global state stores
- Contains: 9 stores for different domains (auth, cluster, chat, voice, terminal, UI, metrics, camera, alerts)
- Key files: `cluster.ts` (with PERF-17 diffing), `chat.ts`, `auth.ts`, `ui.ts`

**jarvis-ui/src/services/**
- Purpose: API clients and Socket.IO connection factories
- Contains: REST API wrapper, Socket.IO namespace factories
- Key files: `api.ts` (fetch wrapper with auth), `socket.ts` (namespace factories)

## Key File Locations

**Entry Points:**
- `jarvis-backend/src/index.ts`: Backend server startup
- `jarvis-ui/src/main.tsx`: Frontend root render
- `jarvis-ui/src/App.tsx`: Auth routing and socket initialization

**Configuration:**
- `jarvis-backend/src/config.ts`: Environment-based config singleton
- `jarvis-backend/.env`: Backend secrets (Proxmox tokens, API keys)
- `jarvis-ui/vite.config.ts`: Frontend build configuration
- `jarvis-backend/drizzle.config.ts`: Database migrations config

**Core Logic:**
- `jarvis-backend/src/mcp/server.ts`: Tool execution pipeline
- `jarvis-backend/src/ai/router.ts`: Intent-based AI routing
- `jarvis-backend/src/ai/loop.ts`: Streaming chat loop with tools
- `jarvis-backend/src/realtime/emitter.ts`: Cluster state polling
- `jarvis-backend/src/monitor/poller.ts`: Autonomous monitoring loops

**Testing:**
- `jarvis-backend/src/__tests__/*.test.ts`: Vitest unit tests
- `jarvis-backend/vitest.config.ts`: Test runner configuration

## Naming Conventions

**Files:**
- Backend TypeScript: kebab-case (`state-tracker.ts`, `mqtt-alert-service.ts`)
- Frontend React components: PascalCase (`ChatPanel.tsx`, `NodeCard.tsx`)
- Frontend utilities: kebab-case (`format.ts`, `useChatSocket.ts`)
- Test files: `*.test.ts` suffix

**Directories:**
- All lowercase, no hyphens (`realtime`, `smarthome`)
- Pluralized when containing multiple items (`clients`, `stores`, `tools`)
- Singular for single-purpose modules (`monitor`, `presence`)

**Variables:**
- camelCase for all local variables and functions
- PascalCase for React components and TypeScript interfaces/types
- UPPER_SNAKE_CASE for constants (`POLL_INTERVALS`, `TOOL_TIERS`, `ACTION_KEYWORDS`)

**Types:**
- Interface names without "I" prefix: `NodeData`, `ToolResult`, `SafetyResult`
- Type aliases for unions: `ActionTier`, `ToolSource`, `TTSEngine`
- Props interfaces suffixed: `ChatMessageProps`, `NodeCardProps`

## Where to Add New Code

**New MCP Tool:**
- Implementation: Choose category in `jarvis-backend/src/mcp/tools/` or create new file
- Registration: Add registerXTools() call in `jarvis-backend/src/mcp/server.ts`
- Safety: Add tier mapping in `jarvis-backend/src/safety/tiers.ts` TOOL_TIERS
- Tests: Add test in `jarvis-backend/src/__tests__/` if complex

**New AI Provider:**
- Implementation: `jarvis-backend/src/ai/providers/<provider>-provider.ts`
- Interface: Implement `LLMProvider` from `jarvis-backend/src/ai/providers.ts`
- Registration: Add to providers map in `jarvis-backend/src/realtime/chat.ts` and `voice.ts`

**New Socket.IO Namespace:**
- Setup: Add namespace creation in `jarvis-backend/src/realtime/socket.ts`
- Handler: Create handler file in `jarvis-backend/src/realtime/<name>.ts`
- Registration: Call setup handler in `jarvis-backend/src/index.ts`
- Frontend hook: Create `jarvis-ui/src/hooks/use<Name>Socket.ts`

**New React Component:**
- Implementation: Place in appropriate layout directory (`left`, `center`, `right`, `shared`)
- Component files: PascalCase filename matching component name
- Co-located types: Define props interface in same file
- Imports: Use absolute imports for services/stores, relative for sibling components

**New Background Service:**
- Implementation: `jarvis-backend/src/services/<name>.ts`
- Exports: start<Name>() and stop<Name>() functions
- Registration: Call start in `jarvis-backend/src/index.ts`, add stop to shutdown()

**New Zustand Store:**
- Implementation: `jarvis-ui/src/stores/<name>.ts`
- Pattern: Use create() with devtools middleware
- Types: Define state interface and actions inline
- Usage: Import in components with selector pattern

**New Database Table:**
- Schema: Add to `jarvis-backend/src/db/schema.ts`
- Migration: Run `npm run db:generate` to create migration
- Queries: Add helper methods in `jarvis-backend/src/db/<name>.ts`
- Types: Export from schema for type safety

**New External Client:**
- Implementation: `jarvis-backend/src/clients/<service>.ts`
- Pattern: Export typed functions, manage connection state internally
- Config: Add credentials to `jarvis-backend/src/config.ts`
- Usage: Import in MCP tools or realtime handlers

**Utilities:**
- Backend helpers: `jarvis-backend/src/<domain>/<util>.ts` (keep domain-specific)
- Frontend shared helpers: `jarvis-ui/src/utils/<name>.ts`
- React hooks: `jarvis-ui/src/hooks/use<Name>.ts`

## Special Directories

**jarvis-backend/data/**
- Purpose: SQLite database files
- Generated: Yes (by Drizzle migrations)
- Committed: No (gitignored, production uses Docker volume)

**jarvis-backend/dist/**
- Purpose: Compiled JavaScript output from TypeScript
- Generated: Yes (by `tsc` via `npm run build`)
- Committed: No (gitignored, rebuilt in Docker)

**jarvis-ui/dist/**
- Purpose: Production build output from Vite
- Generated: Yes (by `vite build`)
- Committed: No (gitignored, served by nginx in Docker)

**jarvis-backend/node_modules/**
- Purpose: Backend npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No (standard gitignore)

**jarvis-ui/node_modules/**
- Purpose: Frontend npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No (standard gitignore)

**jarvis-ui/public/**
- Purpose: Static assets copied to dist root
- Generated: No (manually managed)
- Committed: Yes (favicon, robots.txt, etc.)

**jarvis-ui/src/vendor/**
- Purpose: Third-party code modified for this project
- Generated: No (manually added)
- Committed: Yes (globe.js WebGL visualization)

---

*Structure analysis: 2026-01-31*

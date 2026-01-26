# Technology Stack

**Project:** Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard
**Researched:** 2026-01-26
**Overall Confidence:** HIGH (most recommendations verified via npm registry and official docs)

---

## Recommended Stack

### Frontend Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React | ^19.0.0 | UI framework | Already scaffolded in `jarvis-ui/`. React 19 is stable with concurrent features, streaming SSR, and improved Context API. No reason to change. | HIGH |
| Vite | ^6.0.5 | Build tool + dev server | Already in scaffold. Vite 6 is current stable. Fast HMR, native ESM, excellent DX. Tailwind CSS v4 has a first-party Vite plugin. | HIGH |
| TypeScript | ~5.6.2 | Type safety | Already in scaffold. Pin to 5.6.x for stability; TypeScript 5.7+ available but not required. | HIGH |

**Do NOT use:** Next.js. This is a self-hosted dashboard deployed as static files behind Nginx, not an SSR app. Vite SPA is the correct architecture. Adding Next.js would add server complexity for zero benefit.

### Styling & Design System

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Tailwind CSS | ^4.0.0 | Utility CSS framework | Upgrade from v3 (in scaffold) to v4. New CSS-first config (`@import "tailwindcss"`, no `tailwind.config.js`), 5x faster builds via Rust Oxide engine. First-party Vite plugin. Custom theme via `@theme` directive for JARVIS amber/gold palette. | HIGH |
| Custom CSS (CSS variables + `@theme`) | - | Sci-fi design tokens | JARVIS aesthetic (amber `#FF9500`, gold `#FFD700`, scan lines, glow effects) implemented via Tailwind v4 `@theme` directive + CSS custom properties. No third-party sci-fi framework needed. | HIGH |

**Do NOT use:**
- **Arwes** (sci-fi framework): Still in alpha (1.0.0-alpha), not production-ready, does not support React 19 strict mode or RSC. API unstable with breaking changes. Build custom sci-fi components instead -- the aesthetic is achievable with Tailwind + CSS animations + Motion.
- **Cosmic UI**: Too new (July 2025), thin community, unclear maintenance. Risk of abandonment.
- **MUI/Chakra/shadcn**: Wrong aesthetic. These are designed for conventional UIs. Fighting their design language to achieve eDEX-UI look is counterproductive.

### Animation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Motion (formerly Framer Motion) | ^12.27.0 | UI animations | Declarative React animation API. Handles the JARVIS aesthetic: scan line sweeps, panel transitions, glow pulses, text reveals. 8M+ weekly npm downloads, actively maintained (latest: Jan 2026). Layout animations work with React 19. Install as `motion` (new package name). | HIGH |

**Do NOT use:** GSAP. It works but its imperative API fights React's declarative model. Motion's `<motion.div>` components are more natural in JSX. GSAP is better for vanilla JS or canvas-heavy work.

### State Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zustand | ^5.0.0 | Global client state | Minimal boilerplate (~3KB), single-store pattern ideal for dashboard: connection status, active panels, UI preferences, chat state, selected node. Middleware for devtools and persistence. | HIGH |
| TanStack Query | ^5.90.0 | Server state & polling | Handles all Proxmox API data fetching with built-in caching, deduplication, background refetch, and `refetchInterval` for real-time polling. Pair with WebSocket for push-based invalidation. Already proven in the proxmox-ui codebase. | HIGH |

**Architecture:** Zustand for client/UI state, TanStack Query for server/API state. This is the standard 2025/2026 pattern. Do NOT put API data in Zustand -- that is TanStack Query's job.

**Do NOT use:**
- **Redux/Redux Toolkit**: Overkill for this project. Zustand does everything needed with 90% less boilerplate.
- **Jotai**: Better for complex interdependent atomic state. Dashboard state is more centralized (Zustand's strength).
- **React Context alone**: No caching, no deduplication, no background refetch. Insufficient for real-time dashboard.

### Data Visualization

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Recharts | ^2.15.0 | Charts (CPU, RAM, network, storage) | React-native composable API (JSX components). Good enough for dashboard-scale data (~100 data points per chart, not millions). Clean SVG rendering that can be styled to match JARVIS aesthetic. Active: 3M+ weekly downloads. | HIGH |

**Alternative (if needed later):** Apache ECharts (`echarts-for-react`) for high-density time-series data (thousands of points, WebGL canvas rendering). Start with Recharts; switch specific panels to ECharts only if performance requires it.

**Do NOT use:** Chart.js. Its canvas rendering makes it harder to style for the sci-fi aesthetic, and its React wrapper (`react-chartjs-2`) is less ergonomic than Recharts.

### Real-Time Communication

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Socket.IO (server) | ^4.8.0 | WebSocket server | Auto-reconnection with exponential backoff, rooms/namespaces (per-node rooms, per-panel rooms), broadcasting, heartbeats -- all built-in. Matters for a dashboard that must maintain connection to streaming infrastructure data. The ~2x overhead vs raw `ws` is negligible for this use case (<100 concurrent clients). | HIGH |
| Socket.IO (client) | ^4.8.0 | WebSocket client | Matches server. `socket.io-client` pairs with the server. Auto-reconnect is critical for a dashboard that runs 24/7 on a dedicated display. | HIGH |

**Why not raw `ws`?** Raw `ws` is faster but you would need to build reconnection logic, heartbeats, room management, and message serialization from scratch. For a dashboard with <100 clients, Socket.IO's DX wins over `ws`'s performance edge.

**Architecture pattern:**
- Backend emits events: `cluster:status`, `node:metrics`, `vm:status`, `jarvis:activity`
- Frontend joins rooms per-panel: `room:cluster`, `room:node:Home`, `room:jarvis`
- TanStack Query cache invalidated on Socket.IO events (push-based freshness)

### Terminal Emulator

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @xterm/xterm | ^5.5.0 | Terminal emulator | Powers the eDEX-style terminal panel. Same engine VS Code uses. WebGL renderer for performance, fit addon for responsive sizing. | HIGH |
| react-xtermjs | ^1.1.0 | React wrapper | By Qovery, modern hooks-based wrapper. Actively maintained. Provides `<XTerm>` component and `useXTerm` hook. | MEDIUM |
| @xterm/addon-fit | ^0.11.0 | Terminal auto-resize | Responsive terminal that fits its container. | HIGH |
| @xterm/addon-webgl | ^0.19.0 | GPU rendering | Canvas-based rendering for smooth terminal output. | HIGH |

### Routing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React Router | ^7.12.0 | Client-side routing | Standard React router. Used for navigation between dashboard views (main dashboard, node detail, settings, logs). Already in the proxmox-ui codebase. | HIGH |

---

## Backend Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Express | ^5.2.0 | HTTP API server | Express 5 is stable and production-ready. The MCP TypeScript SDK publishes `@modelcontextprotocol/express` middleware for direct integration. This is the deciding factor -- MCP + Express is a supported, tested combination. Fastify/Hono are faster but lack first-party MCP middleware. | HIGH |
| Socket.IO | ^4.8.0 | WebSocket server | Attaches to Express's HTTP server. See real-time section above. | HIGH |

**Why Express over Fastify/Hono?** Performance is not the bottleneck for a LAN-only dashboard with <10 concurrent users. The MCP SDK's official Express adapter (`@modelcontextprotocol/express`) eliminates glue code. Express 5 adds async error handling and proper promise support -- the main historical pain point is resolved.

**Do NOT use:**
- **Fastify**: Faster, but no official MCP middleware. Would require manual Streamable HTTP transport setup.
- **Hono**: Designed for edge/serverless. Overkill portability for a Docker container on a LAN.
- **NestJS**: Enterprise framework overhead for a single-purpose API. Decorator-heavy architecture adds complexity without benefit.

---

## MCP (Model Context Protocol) Server

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @modelcontextprotocol/sdk | ^1.25.0 | MCP server SDK | Official TypeScript SDK. Defines tools, resources, prompts. Zod for schema validation. v1.x is production-recommended; v2 expected Q1 2026 but v1.x will get 6 months of maintenance after. 21K+ dependent packages. | HIGH |
| @modelcontextprotocol/express | latest | Express adapter | Official thin adapter that wires MCP server into Express routes. Supports Streamable HTTP transport (recommended) with optional SSE fallback. | HIGH |
| Zod | ^3.25.0 | Schema validation | Required peer dependency of MCP SDK. Defines tool input/output schemas. Also useful for API request validation throughout the backend. | HIGH |

**Transport:** Use **Streamable HTTP** (recommended by MCP spec) over Express, not stdio. The MCP server runs in the same process as the Express API server, exposed at `/mcp` endpoint. Claude Desktop/API can connect via HTTP. Local Qwen connects via the backend's internal MCP client.

**Tool categories to expose:**
1. **Proxmox tools** -- `get_cluster_status`, `get_node_metrics`, `list_vms`, `start_vm`, `stop_vm`, `get_storage`
2. **System tools** -- `ssh_execute`, `check_service`, `restart_service`, `get_logs`
3. **Docker tools** -- `list_containers`, `restart_container`, `get_container_logs`
4. **Diagnostic tools** -- `run_health_check`, `check_network`, `test_connectivity`
5. **Memory tools** -- `query_events`, `store_observation`, `get_cluster_history`

---

## LLM Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @anthropic-ai/sdk | ^0.71.0 | Claude API client | Official TypeScript SDK. Streaming via SSE, tool use (function calling), message batches. Used for complex reasoning tasks: diagnosis, multi-step remediation, architecture decisions. | HIGH |
| @ai-sdk/openai-compatible | ^1.0.0 | Local LLM client | Vercel AI SDK's OpenAI-compatible provider. Connects to llama-server at `192.168.1.50:8080`. Handles streaming, retries, model selection. Unified interface so local and cloud LLMs share the same calling pattern. | MEDIUM |
| ai (Vercel AI SDK) | ^5.0.0 | Unified LLM interface | AI SDK 5 provides `streamText`, `generateText` with unified provider abstraction. Swap between Claude and local Qwen with a provider change, not a code rewrite. Full TypeScript type safety. WebSocket transport support for real-time streaming. | HIGH |

**Hybrid LLM routing strategy:**
- **Claude API** (complex): Multi-step diagnosis, remediation plans, natural language analysis, code generation
- **Local Qwen 2.5 7B** (routine): Status checks, simple commands, formatting responses, health summaries
- **Router logic**: Backend decides based on task complexity. Simple heuristic: if the task requires tools or multi-step reasoning, route to Claude. If it is a status query or formatting task, route to local.

**Do NOT use:**
- **Direct fetch to OpenAI-compatible API** (current scaffold approach): Works but loses type safety, streaming abstractions, retry logic, and provider switching. The Vercel AI SDK wraps this properly.
- **LangChain**: Massive abstraction layer, heavy dependency tree, frequent breaking changes. The Vercel AI SDK is lighter and sufficient for this use case.
- **Ollama provider**: The existing Qwen runs via llama-server (not Ollama), so use `@ai-sdk/openai-compatible` pointed at `http://192.168.1.50:8080/v1`.

---

## Persistent Memory System

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| better-sqlite3 | ^12.6.0 | SQLite driver | Synchronous, fastest Node.js SQLite driver. 2.7K+ dependents. Prebuilt binaries for Linux. No network overhead -- file-based DB in Docker volume. | HIGH |
| Drizzle ORM | ^0.45.0 | Type-safe ORM | SQL-first, 7.4KB, zero dependencies. Sits on top of better-sqlite3. TypeScript schema definitions generate types automatically. Migrations via `drizzle-kit`. Faster than raw better-sqlite3 with prepared statements. | HIGH |
| drizzle-kit | ^0.30.0 | Migration tool | CLI for generating and running SQL migrations from Drizzle schema changes. | HIGH |

**Database schema (conceptual):**
```
events        -- timestamped cluster events (node up/down, VM state changes, alerts)
actions       -- Jarvis actions taken (commands executed, remediation steps)
conversations -- chat history (user messages, assistant responses, tool calls)
observations  -- Jarvis observations (patterns noticed, anomalies detected)
preferences   -- user preferences (dashboard layout, notification settings)
cluster_state -- latest snapshot of cluster topology and resource usage
```

**Why SQLite over PostgreSQL?**
- Single-user dashboard, no concurrent write pressure
- Zero operational overhead (no database server to manage)
- File-based: trivial backup (copy file), trivial Docker volume mount
- 10-50ms query performance is more than sufficient
- Portable: can export/move the entire memory as a single file

**Do NOT use:**
- **PostgreSQL**: Overkill for single-user. Adds a Docker container, connection pooling, and operational burden for no benefit.
- **MongoDB**: Document model is wrong for structured event/action data. SQL is better for time-range queries on events.
- **Vector database (ChromaDB, Pinecone)**: Not needed for v1. Memory retrieval is by time range, event type, and keyword -- standard SQL queries. Vector similarity search can be added later via `sqlite-vec` extension if semantic search is needed.
- **Redis**: Good for caching, but SQLite handles the persistence and caching is handled by TanStack Query on the frontend.

---

## Infrastructure & Proxmox Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| node-ssh | ^13.2.0 | SSH client | Promise-based wrapper around ssh2. Clean API for executing commands on cluster nodes. Built-in TypeScript support via `@types/ssh2`. Simpler than raw ssh2 for command execution use case. | MEDIUM |
| proxmox-api | ^1.1.0 | Proxmox REST API client | TypeScript types with IntelliSense for Proxmox API. Proxy-based API that mirrors the Proxmox REST structure. Supports token auth. GPL-3.0 license (check compatibility). | MEDIUM |

**Alternative to proxmox-api:** Build a thin custom Proxmox client using `fetch` + TypeScript interfaces. The Proxmox REST API is well-documented and stable. A custom client avoids the GPL-3.0 license concern and gives full control over error handling. The existing `proxmox-api` npm package was last published ~1 year ago and has limited adoption (1.1K weekly downloads). **Recommendation: Start with custom client, evaluate `proxmox-api` if custom client becomes tedious.**

**SSH authentication:** Key-based auth only (per cluster security policy). Use the host's `~/.ssh/id_ed25519` key mounted into the Docker container as a read-only volume.

---

## DevOps & Deployment

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Docker | latest | Containerization | Management VM (192.168.1.65) already runs 16 Docker containers. Jarvis 3.1 deploys as 2 containers: backend API + frontend (Nginx). | HIGH |
| Docker Compose | ^2.x | Orchestration | Single `docker-compose.yml` for the Jarvis stack. Defines backend, frontend, volumes (SQLite DB, SSH keys), networks. | HIGH |
| Nginx (Alpine) | ^1.27 | Frontend serving + reverse proxy | Multi-stage build: Vite builds static assets, Nginx serves them. Also reverse-proxies API requests and WebSocket upgrades to the backend container. Tiny image (~5MB Alpine). | HIGH |
| Node.js 22 LTS (Alpine) | ^22.x | Backend runtime | LTS release, stable. Alpine variant for small image size. ES2022+ support for all TypeScript features. | HIGH |

**Multi-stage Dockerfile (frontend):**
1. Stage 1: `node:22-alpine` -- install deps, `npm run build`
2. Stage 2: `nginx:1.27-alpine` -- copy `dist/` to `/usr/share/nginx/html`, copy nginx config

**Backend Dockerfile:**
1. `node:22-alpine` -- install deps, compile TypeScript, run with `node dist/index.js`
2. Mount volumes: SQLite DB directory, SSH keys (read-only)

**Do NOT use:**
- **Kubernetes/K3s**: Single-machine deployment on a management VM. Docker Compose is sufficient.
- **PM2**: Running in Docker already handles process management. PM2 inside Docker is redundant.

---

## Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| date-fns | ^4.1.0 | Date formatting | Dashboard timestamps, event history, "2 minutes ago" formatting | HIGH |
| lucide-react | ^0.460.0 | Icons | Consistent icon set for UI. Already in proxmox-ui codebase. | HIGH |
| clsx | ^2.1.0 | Conditional classes | `clsx("base", condition && "active")` for Tailwind class merging | HIGH |
| tailwind-merge | ^3.0.0 | Tailwind class dedup | Merges conflicting Tailwind classes properly. Use with clsx: `cn()` utility | HIGH |
| react-hot-toast | ^2.5.0 | Toast notifications | Non-blocking notifications for Jarvis actions, alerts, errors | HIGH |
| react-markdown | ^9.0.0 | Markdown rendering | Jarvis responses contain markdown (code blocks, lists, headers) | HIGH |
| highlight.js | ^11.11.0 | Code syntax highlighting | Code blocks in Jarvis responses and terminal output | HIGH |

---

## Development Tools

| Tool | Version | Purpose | Confidence |
|------|---------|---------|------------|
| ESLint | ^9.17.0 | Linting | Already in scaffold. ESLint 9 flat config. | HIGH |
| eslint-plugin-react-hooks | ^5.0.0 | React hooks linting | Already in scaffold. | HIGH |
| @tanstack/react-query-devtools | ^5.90.0 | Query debugging | Visual devtools for TanStack Query cache inspection | HIGH |
| socket.io-admin-ui | ^0.5.0 | Socket.IO debugging | Admin panel for monitoring WebSocket connections in development | MEDIUM |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Frontend framework | React + Vite | Next.js | No SSR needed; SPA dashboard behind Nginx is simpler and correct |
| Sci-fi components | Custom + Tailwind + Motion | Arwes framework | Arwes is alpha, no React 19 support, unstable API |
| State management | Zustand + TanStack Query | Redux Toolkit | 10x more boilerplate for same outcome |
| WebSocket | Socket.IO | raw `ws` | Socket.IO's reconnection/rooms/heartbeats justify the overhead |
| HTTP framework | Express 5 | Fastify / Hono | MCP SDK has official Express middleware; no Fastify/Hono adapter |
| Database | SQLite (Drizzle + better-sqlite3) | PostgreSQL | Single-user, zero-ops requirement, file-based backup |
| LLM SDK | Vercel AI SDK | LangChain | AI SDK is lighter, sufficient, TypeScript-first |
| Charts | Recharts | ECharts | Simpler React API; can upgrade specific panels to ECharts later |
| CSS framework | Tailwind CSS v4 | Styled Components / CSS Modules | Tailwind is faster, more consistent, utility-first fits dashboard |
| Animation | Motion (Framer Motion) | GSAP / React Spring | Declarative React API, layout animations, most popular |
| Terminal | xterm.js + react-xtermjs | Custom terminal | xterm.js is the standard (powers VS Code terminal) |
| Proxmox client | Custom fetch + types | proxmox-api npm | GPL license concern, stale package, limited adoption |
| SSH | node-ssh | ssh2 / ssh2-promise | Promise-based, clean API for command execution |

---

## Full Installation Commands

### Frontend (`jarvis-ui/`)

```bash
# Upgrade Tailwind to v4 (remove v3)
npm uninstall tailwindcss autoprefixer postcss
npm install -D tailwindcss@^4.0.0 @tailwindcss/vite@^4.0.0

# Core dependencies
npm install zustand @tanstack/react-query react-router-dom
npm install motion recharts socket.io-client
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl react-xtermjs
npm install date-fns lucide-react clsx tailwind-merge
npm install react-hot-toast react-markdown
npm install highlight.js

# Dev dependencies
npm install -D @tanstack/react-query-devtools
```

### Backend (`jarvis-backend/`)

```bash
# Core framework
npm install express socket.io cors
npm install -D @types/express @types/cors

# MCP server
npm install @modelcontextprotocol/sdk @modelcontextprotocol/express zod

# LLM integration
npm install ai @ai-sdk/openai-compatible @ai-sdk/anthropic @anthropic-ai/sdk

# Database
npm install better-sqlite3 drizzle-orm
npm install -D drizzle-kit @types/better-sqlite3

# Infrastructure
npm install node-ssh
npm install -D @types/ssh2

# Utilities
npm install dotenv

# TypeScript & build
npm install -D typescript tsx @types/node
```

---

## Version Pinning Strategy

- **Pin major.minor** (`^x.y.0`) for core framework libraries (React, Express, Vite)
- **Pin exact** for database drivers (`better-sqlite3@12.6.2`) to avoid native module rebuild issues
- **Use latest stable** for MCP SDK (actively developed, v2 incoming Q1 2026)
- **Lock with `package-lock.json`** and commit lockfile to git

---

## Architecture Summary (One-Liner)

React 19 + Vite 6 frontend with Tailwind v4 sci-fi styling and Motion animations, talking via Socket.IO to an Express 5 backend that hosts an MCP tool server, routes between Claude API and local Qwen 2.5 via Vercel AI SDK, persists state in SQLite via Drizzle ORM, and manages the Proxmox cluster via REST API + SSH -- all containerized with Docker Compose on the management VM.

---

## Sources

**Verified (HIGH confidence):**
- [MCP TypeScript SDK - GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - v1.25.2, Express middleware, Streamable HTTP transport
- [@modelcontextprotocol/sdk - npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - 21K+ dependents, last published Jan 2026
- [@anthropic-ai/sdk - npm](https://www.npmjs.com/package/@anthropic-ai/sdk) - v0.71.2, 2.9K+ dependents
- [Vercel AI SDK 5 - Blog](https://vercel.com/blog/ai-sdk-5) - Multi-framework, flexible transports, provider abstraction
- [Tailwind CSS v4.0 - Release](https://tailwindcss.com/blog/tailwindcss-v4) - CSS-first config, Oxide engine, Vite plugin
- [Motion (Framer Motion) - npm](https://www.npmjs.com/package/framer-motion) - v12.27.0, 8M+ weekly downloads
- [TanStack Query](https://tanstack.com/query/latest) - v5, refetchInterval polling, RSC support
- [better-sqlite3 - npm](https://www.npmjs.com/package/better-sqlite3) - v12.6.2, 2.7K+ dependents
- [Drizzle ORM - npm](https://www.npmjs.com/package/drizzle-orm) - v0.45.1, 7.4KB, zero deps
- [Arwes - GitHub](https://github.com/arwes/arwes) - Still alpha, not production ready
- [Express 5 via MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) - Official Express adapter

**WebSearch verified (MEDIUM confidence):**
- [Zustand vs Jotai comparison](https://dev.to/hijazi313/state-management-in-2025-when-to-use-context-redux-zustand-or-jotai-2d2k) - Zustand for centralized store
- [Socket.IO vs ws](https://dev.to/alex_aslam/nodejs-websockets-when-to-use-ws-vs-socketio-and-why-we-switched-di9) - Socket.IO DX advantages
- [Express vs Fastify vs Hono](https://medium.com/@arifdewi/fastify-vs-express-vs-hono-choosing-the-right-node-js-framework-for-your-project-da629adebd4e) - Express still viable for non-edge
- [node-ssh - GitHub](https://github.com/steelbrain/node-ssh) - Promise-based SSH wrapper
- [AI agent memory with SQLite](https://www.marktechpost.com/2025/09/08/gibsonai-releases-memori-an-open-source-sql-native-memory-engine-for-ai-agents/) - SQLite as memory engine trend
- [Recharts vs ECharts](https://embeddable.com/blog/react-chart-libraries) - Recharts for moderate data, ECharts for high volume
- [react-xtermjs by Qovery](https://www.qovery.com/blog/react-xtermjs-a-react-library-to-build-terminals) - Modern xterm.js React wrapper

**Existing codebase (verified):**
- `jarvis-ui/package.json` - React 19, Vite 6, Tailwind v3 (to be upgraded), TypeScript 5.6
- `jarvis-ui/src/services/jarvisApi.ts` - Existing streaming chat to llama-server
- `jarvis-ui/src/hooks/useJarvisChat.ts` - Existing chat hook (to be replaced by AI SDK)
- `.planning/PROJECT.md` - Jarvis 3.1 project definition with constraints and decisions

# Technology Stack -- v1.1 Milestone Additions

**Project:** Jarvis 3.1 v1.1 -- Hybrid LLM, Persistent Memory, Docker Deployment, E2E Testing
**Researched:** 2026-01-26
**Overall Confidence:** HIGH (versions verified via npm registry; patterns verified against actual codebase)

**Scope:** This document covers ONLY the stack additions/changes for v1.1. The existing v1.0 stack (Express 5, React 19, Vite 6, Socket.IO 4, Anthropic SDK, MCP SDK, better-sqlite3, Drizzle ORM) is validated and unchanged. See the v1.0 STACK.md for those decisions.

---

## Critical Context: What v1.0 Actually Built (vs. What Was Planned)

The v1.0 planning STACK.md recommended Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`) for LLM abstraction. **This was NOT adopted.** The actual v1.0 codebase uses:

- **Claude:** Native `@anthropic-ai/sdk` v0.71.2 with direct streaming via `claudeClient.messages.stream()`
- **Local Qwen:** Raw `fetch()` against the OpenAI-compatible `/v1/chat/completions` endpoint with manual SSE parsing
- **Routing:** Keyword-based `needsTools()` function in `chat.ts` -- if message contains tool keywords, route to Claude; otherwise, route to local
- **Zod:** v4.3.6 (not v3.x as planned)
- **Schema:** 5 tables: `events`, `conversations`, `cluster_snapshots`, `preferences`, `autonomy_actions`

All v1.1 recommendations below are grounded in THIS actual codebase, not the original plan.

---

## 1. Hybrid LLM Backend

### Recommendation: Keep Native SDKs, Add `openai` Package for Local LLM

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `openai` | ^6.16.0 | OpenAI-compatible client for local Qwen | Replaces raw `fetch()` + manual SSE parsing in `local-llm.ts`. Provides typed streaming, automatic retries, proper error handling, and abort support. Use `new OpenAI({ baseURL: 'http://192.168.1.50:8080/v1', apiKey: 'not-needed' })`. The `openai` npm package is the de facto standard for OpenAI-compatible endpoints (7,900+ dependents). | HIGH |
| `@anthropic-ai/sdk` | ^0.71.2 | Claude API client (existing) | **No change.** Keep as-is. The native Anthropic SDK provides streaming, tool use, and type safety that no abstraction layer improves upon. The agentic loop in `loop.ts` is tightly coupled to Anthropic's `ContentBlock`, `ToolResultBlockParam`, and streaming event types. Switching to an abstraction would require rewriting the entire loop. | HIGH |

### What NOT to Add

- **Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`):** The v1.0 plan recommended this. **Do NOT adopt it now.** Reasons:
  1. The agentic loop (`loop.ts`) uses Anthropic-specific types throughout: `Anthropic.MessageParam`, `Anthropic.ContentBlock`, `Anthropic.ToolResultBlockParam`, streaming via `claudeClient.messages.stream()`. The AI SDK would require rewriting all of this.
  2. The local LLM has no tool use -- it is text-only chat. A unified provider abstraction solves a problem we do not have (provider-agnostic tool calling).
  3. Adding AI SDK means 3 LLM-related packages (`ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/anthropic`) vs. 1 new package (`openai`). More dependencies for less benefit.
  4. The `openai` package alone gives us typed streaming, error handling, and retries for the local LLM -- which is all we need.

- **LangChain:** Heavy, unnecessary abstraction. Same reasons as v1.0 analysis.

- **LiteLLM (Python proxy):** Adds a Python service just to proxy LLM calls. The `openai` npm package with custom `baseURL` achieves the same thing in-process.

### Routing Architecture Enhancement

The existing keyword-based router in `chat.ts` works but is brittle. For v1.1:

**Enhance, do not replace.** The `needsTools()` function should be refactored into a proper router module (`src/ai/router.ts`) with:
- Current keyword matching (keep, it works)
- Message length heuristic (long analytical questions -> Claude)
- Explicit model selection via chat UI (user picks Claude or Local)
- Fallback logic: if Claude API is unavailable/rate-limited, fall back to local for non-tool messages
- Cost tracking: log which provider handled each request and token counts

**No new dependencies needed** for routing -- this is pure application logic.

### Integration Points

```
Existing:                          v1.1 Change:
src/ai/claude.ts    (keep as-is)   No change
src/ai/loop.ts      (keep as-is)   No change
src/ai/local-llm.ts (rewrite)      Use `openai` package instead of raw fetch
src/realtime/chat.ts (refactor)     Extract router to src/ai/router.ts
```

---

## 2. Persistent Memory with TTLs

### Recommendation: Extend Existing Drizzle Schema + setInterval Cleanup

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `better-sqlite3` | ^12.6.2 | SQLite driver (existing) | **No change.** Already handles all DB operations synchronously. | HIGH |
| `drizzle-orm` | ^0.45.1 | ORM (existing) | **No change.** Extend schema with new `memory` table + `expires_at` column. Drizzle's migration system handles schema evolution. | HIGH |
| `drizzle-kit` | ^0.31.8 | Migration CLI (existing) | **No change.** Use `drizzle-kit generate` + `drizzle-kit push` for new table. | HIGH |
| `node-cron` | ^4.2.1 | Scheduled cleanup jobs | Runs TTL expiry sweeps on a schedule. Lightweight (pure JS, no native deps). Also useful for periodic cluster snapshot saves and memory compaction. Supports cron syntax for fine-grained scheduling. | HIGH |
| `@types/node-cron` | ^3.0.11 | TypeScript types for node-cron | DefinitelyTyped definitions. Required since node-cron does not ship its own types. | HIGH |

### TTL Implementation Pattern

SQLite has no native TTL support. The established pattern (used by Dapr, cache-sqlite-lru-ttl, and others) is:

1. **`expires_at` INTEGER column** on rows that need expiry (Unix timestamp in seconds)
2. **Filter on reads:** All queries include `WHERE expires_at IS NULL OR expires_at > unixepoch()`
3. **Periodic cleanup:** `node-cron` runs `DELETE FROM memory WHERE expires_at <= unixepoch()` at configurable intervals
4. **Index:** `CREATE INDEX idx_memory_expires ON memory(expires_at)` for cleanup performance

### New Schema Tables

```
memory (NEW)
  - id: INTEGER PRIMARY KEY
  - category: TEXT ('cluster_state' | 'action_log' | 'preference' | 'conversation_summary' | 'observation')
  - key: TEXT (unique within category)
  - value: TEXT (JSON string)
  - created_at: TEXT (ISO timestamp)
  - updated_at: TEXT (ISO timestamp)
  - expires_at: INTEGER (Unix seconds, NULL = never expires)
  - ttl_seconds: INTEGER (original TTL for re-application on update)
```

### TTL Tiers

| Category | TTL | Rationale |
|----------|-----|-----------|
| `cluster_state` | 5 minutes | Stale cluster snapshots are misleading; always refresh |
| `action_log` | 30 days | Audit trail, useful for pattern detection over weeks |
| `preference` | NULL (never) | User preferences persist forever |
| `conversation_summary` | 7 days | Compressed conversation context for continuity |
| `observation` | 14 days | Jarvis-detected patterns, anomalies, trends |

### Cleanup Schedule

```typescript
import cron from 'node-cron';

// Every 15 minutes: delete expired memory rows
cron.schedule('*/15 * * * *', () => {
  db.run(sql`DELETE FROM memory WHERE expires_at IS NOT NULL AND expires_at <= unixepoch()`);
});

// Daily at 3 AM: VACUUM to reclaim space after bulk deletes
cron.schedule('0 3 * * *', () => {
  sqlite.exec('VACUUM');
});
```

### What NOT to Add

- **Redis:** Overkill for single-user, single-process application. SQLite with TTL emulation is simpler and avoids another Docker container.
- **`cache-sqlite-lru-ttl` npm package:** Too opinionated, wraps raw SQL. We already have Drizzle ORM -- adding another abstraction layer over the same DB is unnecessary.
- **`cache-manager`:** Designed for multi-store caching (Redis + memory + disk). Wrong abstraction for persistent tiered memory.
- **Separate memory database:** Use the existing `jarvis.db` file. One SQLite file = one Docker volume mount = simple backup. Adding a second DB file adds operational complexity for no benefit.

### Integration Points

```
Existing:                          v1.1 Change:
src/db/schema.ts    (extend)       Add `memory` table definition
src/db/memory.ts    (extend)       Add memory CRUD with TTL-aware queries
src/db/migrate.ts   (extend)       Add CREATE TABLE + indexes for memory
NEW: src/db/cleanup.ts             node-cron scheduled TTL cleanup + VACUUM
NEW: src/ai/context.ts             Build memory context for LLM system prompt
```

### Existing Tables -- TTL Retrofit

The existing `conversations`, `events`, `cluster_snapshots`, and `autonomy_actions` tables should also get periodic cleanup, but via simple age-based deletion (not the TTL column pattern):

- `conversations`: Delete messages older than 30 days (configurable)
- `events`: Delete resolved events older than 60 days
- `cluster_snapshots`: Keep latest 1000 snapshots, delete older
- `autonomy_actions`: Already has `cleanupOldActions(30)` -- wire into node-cron

---

## 3. Docker Deployment

### Recommendation: Enhance Existing Dockerfile, Add Compose + Nginx

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Docker | (host) | Container runtime | Already on management VM (192.168.1.65). 16 containers already running. | HIGH |
| Docker Compose | v2.x | Multi-container orchestration | Standard for multi-container apps. Single `docker-compose.yml` defines backend + frontend + network + volumes. Already used on management VM. | HIGH |
| `node:22-slim` | 22.x | Backend base image | **Use `slim` not `alpine`.** The existing Dockerfile already uses `node:22-slim`. Reason: `better-sqlite3` requires native compilation. Alpine uses musl libc which causes `fcntl64` relocation errors with better-sqlite3's prebuilt binaries. Slim (Debian) uses glibc and `prebuild-install` works reliably. | HIGH |
| `nginx:1.27-alpine` | 1.27.x | Frontend static serving + reverse proxy | Serves Vite build output. Reverse proxies `/api/*` and `/socket.io/*` to backend container. Alpine is fine here -- no native Node.js modules to worry about. ~5MB image. | HIGH |

### Backend Dockerfile (Enhanced from Existing)

The existing `jarvis-backend/Dockerfile` is already a proper multi-stage build. Enhancements needed:

1. **Add `NODE_ENV=production`** in the runtime stage (missing from current Dockerfile)
2. **Add `HEALTHCHECK`** using wget (already installed)
3. **Run as non-root user** (security best practice, not currently done)
4. **Add `.dockerignore`** (reduce build context)

### Frontend Dockerfile (NEW)

```
Stage 1: node:22-slim
  - npm ci
  - npm run build (Vite)

Stage 2: nginx:1.27-alpine
  - Copy dist/ from build stage
  - Copy nginx.conf
  - Expose 80
```

### Docker Compose Structure

```yaml
# docker-compose.yml
services:
  backend:
    build: ./jarvis-backend
    ports: ["4000:4000"]
    volumes:
      - jarvis-data:/data              # SQLite DB persistence
      - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro  # SSH key
    environment:
      - NODE_ENV=production
      - DB_PATH=/data/jarvis.db
    healthcheck:
      test: wget -qO- http://localhost:4000/health || exit 1
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped

  frontend:
    build: ./jarvis-ui
    ports: ["3004:80"]
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped

volumes:
  jarvis-data:
```

### Key Decisions

**Use `node:22-slim` (NOT alpine) for backend:**
- better-sqlite3 has prebuilt binaries for glibc (Debian). The existing Dockerfile already handles this with `prebuild-install`.
- Alpine's musl libc causes `fcntl64` symbol errors documented in multiple GitHub issues.
- The existing Dockerfile already uses `node:22-slim`. Do not change this.

**Nginx reverse proxy for WebSocket:**
- Nginx config needs `proxy_set_header Upgrade $http_upgrade` and `proxy_set_header Connection "upgrade"` for Socket.IO.
- Backend accessible via `http://backend:4000` from the Compose network (Docker DNS).

**SSH key mounting:**
- Mount host's `~/.ssh/id_ed25519` as read-only into the container.
- The container's `SSH_KEY_PATH` config already defaults to `/app/.ssh/id_ed25519`.
- Do NOT copy SSH keys into the Docker image -- they must be volume-mounted at runtime.

### What NOT to Add

- **Kubernetes / K3s:** Single-machine deployment. Docker Compose is the right tool.
- **PM2:** Docker handles process restart via `restart: unless-stopped`. PM2 inside Docker is redundant.
- **Traefik:** Overkill for a LAN-only service. Nginx in a container is simpler and sufficient.
- **Docker Swarm:** Single-host, no need for orchestration across machines.
- **Watchtower:** Nice for auto-updates but premature for initial deployment. Add later if needed.

### New Files

```
NEW: jarvis-ui/Dockerfile              # Multi-stage: Vite build -> Nginx
NEW: jarvis-ui/nginx.conf              # Reverse proxy config for API/WS
NEW: docker-compose.yml                # Root-level compose file
NEW: jarvis-backend/.dockerignore      # Exclude node_modules, dist, .git
NEW: jarvis-ui/.dockerignore           # Exclude node_modules, dist, .git
UPDATE: jarvis-backend/Dockerfile      # Add healthcheck, non-root user, NODE_ENV
```

---

## 4. End-to-End Testing

### Recommendation: Vitest with Live Cluster Validation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `vitest` | ^4.0.18 | Test runner + assertions | Native ESM + TypeScript support (no config needed -- matches Vite's resolve/transform). 30-70% faster than Jest in CI. Built-in mocking, snapshots, coverage. Already uses Vite config, so zero additional configuration in this project. v4.0.18 is current stable (verified Jan 2026). | HIGH |
| `@vitest/coverage-v8` | ^4.0.18 | Code coverage | V8-based coverage (no Istanbul overhead). Reports lcov, text, and JSON. Pair with vitest for `--coverage` flag. | HIGH |

### Why Vitest Over Jest

1. **Zero config with Vite:** Vitest reuses `vite.config.ts` transforms and resolve. Jest needs `ts-jest` or `@swc/jest` for TypeScript, plus `moduleNameMapper` for path aliases.
2. **Native ESM:** The backend uses `"type": "module"`. Jest's ESM support is still experimental and requires `--experimental-vm-modules`. Vitest handles ESM natively.
3. **Performance:** Vitest's HMR-based watch mode is 10-20x faster for iterative development.
4. **TypeScript-first:** No `@types/jest` needed. Vitest types are built-in.

### Test Categories

**Unit Tests (offline, no cluster needed):**
- LLM router logic (`needsTools()` function, routing decisions)
- Safety tier classification (`getToolTier()`, tier escalation)
- Memory TTL calculations (expiry logic, cleanup queries)
- System prompt building (context injection, override detection)
- Input sanitization and validation

**Integration Tests (offline, SQLite in-memory):**
- Memory store CRUD with TTL expiry
- Drizzle schema validation (all tables create/read/update correctly)
- Event and conversation persistence
- Cleanup job logic (expired row deletion)

**E2E Tests (live cluster -- gated by env var):**
- Proxmox API connectivity (`get_cluster_status` returns data)
- SSH connectivity to all 4 nodes
- Local LLM endpoint health (`/v1/models` returns 200)
- Claude API authentication (if key configured)
- MCP tool execution for GREEN-tier tools
- Full chat flow: send message -> get streaming response
- Docker health endpoint responds

### Test Structure

```
jarvis-backend/
  tests/
    unit/
      router.test.ts          # LLM routing logic
      safety.test.ts           # Tier classification
      memory-ttl.test.ts       # TTL calculation + expiry
      sanitize.test.ts         # Input sanitization
    integration/
      memory-store.test.ts     # SQLite memory CRUD (in-memory DB)
      schema.test.ts           # Drizzle schema validation
      cleanup.test.ts          # TTL cleanup job
    e2e/
      cluster-api.test.ts      # Live Proxmox API calls
      ssh-connectivity.test.ts # SSH to all nodes
      llm-endpoints.test.ts    # Claude + local LLM health
      chat-flow.test.ts        # Full chat round-trip
    setup.ts                   # Global test setup (in-memory SQLite for unit/integration)
    vitest.config.ts           # Test-specific Vitest config
```

### E2E Test Gating

E2E tests must only run when explicitly enabled, since they hit live infrastructure:

```typescript
// tests/e2e/cluster-api.test.ts
import { describe, it, expect } from 'vitest';

const RUN_E2E = process.env.JARVIS_E2E === 'true';

describe.skipIf(!RUN_E2E)('Proxmox Cluster E2E', () => {
  it('should return cluster status', async () => {
    // Hit live Proxmox API
  });
});
```

Run with: `JARVIS_E2E=true npm test` or `npm run test:e2e`

### In-Memory SQLite for Unit/Integration Tests

```typescript
// tests/setup.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  // Run migrations against in-memory DB
  return { db, sqlite };
}
```

### What NOT to Add

- **Jest:** ESM support is experimental; requires `ts-jest` or `@swc/jest`; needs `moduleNameMapper` configuration. Vitest is the natural choice for a Vite project.
- **Playwright / Cypress:** These are browser E2E testing tools. Our E2E tests validate backend API calls against live infrastructure, not UI interactions. If frontend E2E is needed later, Playwright can be added separately.
- **Supertest:** Useful for Express HTTP testing, but our backend communicates via Socket.IO for chat and REST for monitoring. Vitest can call APIs directly with `fetch`. Supertest adds complexity without benefit.
- **testcontainers:** Designed for spinning up Docker containers in tests. We test against a live Proxmox cluster, not containerized infrastructure. Wrong abstraction.
- **msw (Mock Service Worker):** Good for mocking HTTP APIs in tests. We want the opposite -- our E2E tests verify real API connectivity. Unit tests can use Vitest's built-in `vi.mock()` for mocking.

### Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "JARVIS_E2E=true vitest run tests/e2e/",
    "test:unit": "vitest run tests/unit/",
    "test:integration": "vitest run tests/integration/"
  }
}
```

---

## Complete v1.1 Installation Commands

### Backend (`jarvis-backend/`)

```bash
# Hybrid LLM: OpenAI-compatible client for local Qwen
npm install openai@^6.16.0

# Persistent Memory: scheduled cleanup jobs
npm install node-cron@^4.2.1
npm install -D @types/node-cron@^3.0.11

# E2E Testing
npm install -D vitest@^4.0.18 @vitest/coverage-v8@^4.0.18
```

**Total: 2 new production dependencies, 3 new dev dependencies.**

### Frontend (`jarvis-ui/`)

No new dependencies needed for v1.1. The frontend changes (model selector UI, memory display) use existing React + Zustand + Socket.IO stack.

---

## New Config Values (`.env`)

```bash
# Hybrid LLM routing
LOCAL_LLM_ENDPOINT=http://192.168.1.50:8080   # Already exists
LOCAL_LLM_MODEL=qwen2.5-7b-instruct-q4_k_m.gguf  # Already exists
LLM_ROUTE_MODE=auto                            # NEW: 'auto' | 'claude' | 'local'

# Memory TTL configuration
MEMORY_CLEANUP_CRON=*/15 * * * *               # NEW: cleanup schedule
MEMORY_VACUUM_CRON=0 3 * * *                   # NEW: daily vacuum schedule
CONVERSATION_RETENTION_DAYS=30                  # NEW: max conversation age
EVENT_RETENTION_DAYS=60                         # NEW: max resolved event age

# E2E testing (only in test environment)
JARVIS_E2E=false                               # NEW: enable live cluster tests
```

---

## Alternatives Considered (v1.1 Specific)

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Local LLM client | `openai` npm package | Raw `fetch` (current) | Loses type safety, retries, proper SSE parsing, error handling |
| Local LLM client | `openai` npm package | Vercel AI SDK | 3 packages vs 1; requires rewriting agentic loop; overkill for text-only local chat |
| Local LLM client | `openai` npm package | `node-llama-cpp` | In-process llama.cpp binding. Jarvis already has a separate `llama-server` process; no need to embed the model in Node.js |
| TTL cleanup | `node-cron` | `setInterval` | node-cron provides cron syntax, named schedules, and proper timezone handling. setInterval drifts and is harder to configure |
| TTL cleanup | `node-cron` | OS-level crontab | Application-level scheduling is portable (works in Docker) and testable. OS cron requires container-level cron daemon setup |
| TTL cleanup | `node-cron` | `bree` (worker thread scheduler) | Bree uses worker threads -- overkill for simple `DELETE` queries. node-cron runs in the main thread which is fine for <1ms DB operations |
| Test runner | Vitest | Jest | No native ESM; needs ts-jest; extra config for Vite project |
| Test runner | Vitest | Node.js built-in test runner | Limited snapshot support; no coverage integration; no watch mode with HMR |
| Docker base | `node:22-slim` | `node:22-alpine` | better-sqlite3 prebuilt binaries fail on Alpine (musl libc); Slim uses glibc and works reliably |
| Docker compose | Single compose file | Separate Dockerfiles only | Compose provides networking, volume management, health checks, and dependency ordering in one file |
| Frontend serving | Nginx container | Express static serving | Nginx is faster for static files, handles WebSocket upgrade natively, separates concerns |

---

## Version Pinning Strategy (v1.1 Additions)

| Package | Pin Strategy | Reason |
|---------|-------------|--------|
| `openai` | `^6.16.0` | Semver-compliant, auto-generated from OpenAPI spec. Minor/patch updates are safe. |
| `node-cron` | `^4.2.1` | Stable, infrequently updated. Caret is safe. |
| `vitest` | `^4.0.18` | Actively developed. Stay current with test framework. |
| `@vitest/coverage-v8` | `^4.0.18` | Must match vitest major.minor. |
| `@types/node-cron` | `^3.0.11` | DefinitelyTyped. Caret is fine. |

---

## Architecture Summary (v1.1 One-Liner)

v1.1 adds the `openai` package for typed local LLM communication, `node-cron` for TTL-based memory cleanup scheduling, Docker Compose with Nginx reverse proxy for production deployment on the management VM, and Vitest for unit/integration/E2E testing against the live Proxmox cluster.

---

## Sources

**Verified via npm registry (HIGH confidence):**
- `openai` v6.16.0 -- [npm](https://www.npmjs.com/package/openai) -- 7,900+ dependents, published Jan 2026
- `vitest` v4.0.18 -- [npm](https://www.npmjs.com/package/vitest) -- 1,400+ dependents, published Jan 2026
- `node-cron` v4.2.1 -- [npm](https://www.npmjs.com/package/node-cron) -- 1,900+ dependents, published ~Jul 2025
- `@types/node-cron` v3.0.11 -- [npm](https://www.npmjs.com/package/@types/node-cron) -- DefinitelyTyped
- `@vitest/coverage-v8` v4.0.18 -- [npm](https://www.npmjs.com/package/@vitest/coverage-v8)
- `better-sqlite3` v12.6.2 -- already in project, verified latest
- `@anthropic-ai/sdk` v0.71.2 -- already in project, verified latest
- `drizzle-orm` v0.45.1 -- already in project, verified latest

**Verified via web search (MEDIUM confidence):**
- OpenAI SDK with custom `baseURL` for llama-server -- [Ollama blog](https://ollama.com/blog/openai-compatibility), [llama.cpp docs](https://llama-cpp-python.readthedocs.io/en/latest/server/)
- better-sqlite3 Docker issues with Alpine -- [Answer Overflow](https://www.answeroverflow.com/m/1221244020685148211), [Backstage GitHub issue](https://github.com/backstage/backstage/issues/11651)
- SQLite TTL pattern (Dapr implementation) -- [Dapr docs](https://docs.dapr.io/reference/components-reference/supported-state-stores/setup-sqlite/)
- Docker multi-stage best practices -- [Docker docs](https://docs.docker.com/build/building/multi-stage/), [OneUptime blog (Jan 2026)](https://oneuptime.com/blog/post/2026-01-06-nodejs-multi-stage-dockerfile/view)
- Vitest vs Jest in 2026 -- [Vitest docs](https://vitest.dev/guide/), [DEV Community](https://dev.to/dataformathub/vitest-vs-jest-30-why-2026-is-the-year-of-browser-native-testing-2fgb)
- Nginx reverse proxy + WebSocket -- [Docker blog](https://www.docker.com/blog/how-to-use-the-official-nginx-docker-image/)
- Anthropic OpenAI SDK compatibility limitations -- [Claude docs](https://docs.anthropic.com/en/api/openai-sdk)

**Verified via codebase inspection (HIGH confidence):**
- `jarvis-backend/package.json` -- actual dependency versions
- `jarvis-backend/src/ai/local-llm.ts` -- raw fetch to OpenAI-compatible endpoint
- `jarvis-backend/src/ai/loop.ts` -- Anthropic SDK streaming + tool use types
- `jarvis-backend/src/ai/claude.ts` -- native Anthropic client singleton
- `jarvis-backend/src/realtime/chat.ts` -- keyword-based routing, memoryStore usage
- `jarvis-backend/src/db/schema.ts` -- 5 existing Drizzle tables
- `jarvis-backend/src/db/memory.ts` -- existing CRUD operations
- `jarvis-backend/src/config.ts` -- existing env vars including local LLM config
- `jarvis-backend/Dockerfile` -- existing multi-stage node:22-slim build
- `jarvis-backend/tsconfig.json` -- ES2022 target, NodeNext module

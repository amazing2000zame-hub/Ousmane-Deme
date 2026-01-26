# Project Research Summary

**Project:** Jarvis 3.1 v1.1 Milestone — Hybrid LLM, Persistent Memory, Docker Deployment, E2E Testing
**Domain:** Infrastructure management enhancements for AI-powered homelab assistant
**Researched:** 2026-01-26
**Confidence:** HIGH

## Executive Summary

Jarvis 3.1 is an established infrastructure management dashboard for a Proxmox homelab cluster with an agentic AI assistant. The v1.0 foundation is working: Claude API with tool calling, local Qwen 2.5 7B fallback, safety tiers, Socket.IO real-time updates, and SQLite persistence. The v1.1 milestone adds four capabilities that transform Jarvis from a prototype into a production-ready system: intelligent hybrid LLM routing (to reduce API costs 60-85%), persistent memory with TTL tiers (for cross-session context), full-stack Docker deployment (for the management VM), and comprehensive testing infrastructure.

The recommended approach is **refinement, not rewrite**. The existing architecture already has the seams where these features plug in. The hybrid router wraps the existing Claude and Qwen implementations behind a common interface without changing their internal behavior. Persistent memory extends the existing SQLite schema with a new `memory_tiers` table and scheduled cleanup. Docker deployment is 80% complete — the Dockerfiles work, just need hardening and nginx reverse proxy configuration. Testing infrastructure targets the existing code's critical paths: safety tiers, routing logic, tool execution, and memory operations.

The key risk is **feature interaction complexity**. Each new capability is straightforward in isolation, but their integration points create 12 critical pitfalls (documented in PITFALLS.md) ranging from SQLite WAL corruption in Docker to context window overflow on the local LLM to accidental SSH key exposure in Docker images. The mitigation strategy is **phase ordering by dependency**: routing first (no new dependencies), memory second (needs routing's provider abstraction), Docker third (packages complete code), testing last (validates deployed system). Build tests alongside feature code, not after.

## Key Findings

### Recommended Stack

The v1.1 stack is **minimal and targeted** — only 5 new packages across 4 features, all verified as current stable versions (npm registry checked Jan 2026). The existing v1.0 stack (Express 5, React 19, Vite 6, Socket.IO 4, Anthropic SDK, better-sqlite3, Drizzle ORM) remains unchanged.

**New production dependencies:**
- `openai` (^6.16.0) — OpenAI-compatible client for local Qwen, replaces raw fetch() with typed streaming, error handling, retries, and abort support. The de facto standard for OpenAI-compatible endpoints (7,900+ dependents). Uses custom baseURL to point at llama-server.
- `node-cron` (^4.2.1) — Scheduled cleanup jobs for TTL-based memory expiry. Lightweight, cron syntax, no native deps. Also useful for periodic VACUUM and snapshot cleanup.

**New dev dependencies:**
- `vitest` (^4.0.18) — Test runner with native ESM + TypeScript support, 30-70% faster than Jest, zero config with Vite, built-in mocking/coverage
- `@vitest/coverage-v8` (^4.0.18) — V8-based code coverage (pairs with vitest)
- `@types/node-cron` (^3.0.11) — TypeScript types for node-cron (DefinitelyTyped)

**Critical decision: NO LLM gateway.** Research shows LiteLLM, OpenRouter, and other gateways are overkill for a two-provider system. The abstraction layer stays in application code (TypeScript interface over direct SDK calls). Claude's tool_use protocol is fundamentally different from OpenAI function calling — a gateway cannot unify them without losing fidelity.

**Critical decision: SQLite, not Redis.** For a single-user homelab generating ~50 messages/day, SQLite handles memory storage, TTL cleanup, and retrieval in <1ms. No external service to monitor or restart. If semantic search becomes necessary, sqlite-vss extension adds vector similarity without a new container.

**Version pinning strategy:** Use caret ranges for all new packages (^) since they are stable, semver-compliant, and actively maintained. Lock Node.js to a specific minor (22.12-slim not 22-slim) for reproducible Docker builds.

### Expected Features

Research identified 4 feature domains with clear table-stakes/differentiator/anti-feature boundaries. The key insight: **hybrid routing and persistent memory create multiplicative value** — routing reduces API costs, memory enables the local LLM to be smarter (it can access historical context), and together they make self-hosting a 7B model genuinely useful instead of just a fallback.

**Table stakes (must work reliably or the feature has no value):**
- Intent-based LLM routing (keyword + heuristic, not ML-trained classifier)
- Automatic fallback when Claude unavailable (API key missing, rate limited, or offline)
- Provider indicator in UI (user must know which LLM is responding)
- Token usage tracking per request (foundation for cost management)
- Cross-session conversation recall (queries like "what did we discuss yesterday?")
- Cluster state memory (Jarvis remembers "we expanded pve disk to 112GB last week")
- User preference persistence ("I prefer email alerts for critical issues")
- Full-stack Docker Compose (backend + frontend + nginx reverse proxy)
- Persistent SQLite volume (data survives container restarts)
- SSH key mounting (read-only, not baked into image)
- Backend unit tests with Vitest (safety tiers, routing, memory operations)
- API integration tests (Socket.IO chat flow, tool execution pipeline)

**Differentiators (create value beyond basic functionality):**
- Cost tracking dashboard panel (running counter: "You've spent $2.14 this week")
- Session-level cost attribution ("This diagnostic cost $0.38")
- Configurable routing rules ("Always use Claude for SSH commands")
- Tiered memory with TTL (short-term: 7 days, long-term: permanent)
- Context consolidation/summarization (10K tokens of history -> 500-token summary)
- Progressive context injection (budget: 500-800 tokens for memory, not dump everything)
- One-command deployment script (`ssh management 'cd /opt/jarvis && docker compose up -d'`)
- Container log aggregation with structured JSON logging
- E2E tests against live Proxmox API (validates real cluster integration)

**Anti-features (explicitly avoid — would add complexity without value):**
- ML-trained router model (RouteLLM-style RL approach is overkill for 50 queries/day)
- Multiple cloud LLM providers (OpenAI, Gemini, etc. — Claude + local Qwen cover all needs)
- LLM-as-judge for routing (doubles API calls in worst case)
- Vector database (Pinecone, Chroma — external service overhead for <10K memories)
- Unlimited context window usage (degrades quality, wastes tokens)
- Kubernetes/Docker Swarm (single-machine deployment, Compose is sufficient)
- Browser compatibility matrix (single operator, test Chromium only)
- Performance/load testing (one user, no scaling needs)

### Architecture Approach

The v1.1 integration architecture is **layered and additive** — each feature targets a specific layer of the existing codebase. The foundation (Express + Socket.IO + MCP tools + safety framework + SQLite) remains untouched. New features wrap or extend, they don't replace.

**Four integration layers:**

1. **LLM Provider Layer** (ai/providers.ts, ai/router.ts, ai/cost-tracker.ts)
   - Wraps existing ai/claude.ts and ai/local-llm.ts behind a common interface
   - Router replaces keyword logic in realtime/chat.ts with pluggable routing rules
   - Cost tracker logs token usage to conversations table (column already exists)
   - No changes to ai/loop.ts agentic loop or ai/system-prompt.ts

2. **Memory Layer** (db/context-builder.ts, db/consolidator.ts, new memory_tiers table)
   - Extends existing db/schema.ts with tiered memory storage
   - buildClusterSummary() becomes buildContext() with tiered retrieval
   - Scheduled cleanup hooks into existing monitor/poller.ts background tasks
   - Existing conversations/events/preferences tables gain TTL cleanup

3. **Deployment Layer** (docker-compose.yml, nginx.conf, .dockerignore)
   - Enables frontend in existing docker-compose.yml (currently commented out)
   - Nginx reverse proxy in jarvis-ui for /api and /socket.io WebSocket upgrade
   - Backend Dockerfile gains healthcheck, non-root user, NODE_ENV=production
   - Named volumes for SQLite data, bind mounts for SSH keys (read-only)

4. **Testing Layer** (tests/, vitest.config.ts, playwright.config.ts)
   - Unit tests (Vitest): routing, safety tiers, memory TTL, cost tracking
   - Integration tests (Vitest): memory CRUD, tool pipeline, Socket.IO chat flow
   - E2E tests (Playwright): dashboard loads, chat works, tools execute
   - Mock layers for SSH, Proxmox API, Claude responses

**Data flow (before/after):**

```
BEFORE v1.1:
  chat:send -> needsTools() keyword check -> Claude loop.ts OR Qwen local-llm.ts
  System prompt: buildClusterSummary() (live state only, no history)

AFTER v1.1:
  chat:send -> router.routeMessage() -> provider.chat() -> callbacks
                   |                          |
                   v                          v
             cost-tracker.record()      Same StreamCallbacks
  System prompt: buildContext() (live + tiered memory + TTL-filtered history)
```

**Component boundaries (existing -> v1.1 changes):**
- realtime/chat.ts: Delegates routing, becomes thinner
- ai/system-prompt.ts: Gains memory context injection, parameterized by provider
- db/memory.ts: Adds memory_tiers CRUD, TTL-aware queries
- monitor/poller.ts: Runs consolidateMemory() on background interval
- docker-compose.yml: Adds frontend service, nginx reverse proxy
- New: ai/router.ts (routing engine), db/context-builder.ts (memory assembly)

### Critical Pitfalls

Research identified 15 pitfalls across 3 severity tiers. The 6 critical pitfalls (rewrites, data loss, or production incidents) must be addressed in the corresponding phase or deployment will fail.

**Top 6 Critical Pitfalls:**

1. **Keyword-based routing misclassifies messages (Phase 1)** — Current 42-keyword list has false positives (routes "tell me about cluster computing" to Claude) and false negatives (misses "are any machines down?"). Wastes API budget, degrades responses. **Fix:** Replace with intent classifier (fast regex + local LLM fallback classification), add force_provider UI option, log routing decisions for refinement.

2. **Context window overflow on local LLM silently degrades responses (Phase 1)** — Qwen has 4096 tokens but system prompt alone is 1500-2000 tokens + 20-message history. After 3-5 turns, silently truncates and hallucinates. **Fix:** Separate shorter system prompt for local LLM (~300 tokens, omit tool instructions), cap history at 4-6 messages, reserve 1024 tokens for output, emit context_overflow warning.

3. **SQLite WAL files lost in Docker volume mounts (Phase 3)** — WAL mode creates .db-wal and .db-shm peers. No SIGTERM handler means SIGKILL on docker stop loses uncommitted transactions. **Fix:** Mount entire /data directory (not individual files), add graceful shutdown handler calling sqlite.close(), periodic wal_checkpoint(TRUNCATE), absolute path for DB_PATH.

4. **SSH keys baked into Docker image or leaked via layer history (Phase 3)** — No .dockerignore, COPY . . would embed /root/.ssh/id_ed25519 into image layers. Grants root access to all 4 cluster nodes. **Fix:** Create .dockerignore immediately (exclude .ssh, .env, *.key, data/), mount keys as read-only bind volumes, document prohibition, add CI check for secrets in layers.

5. **TLS certificate verification globally disabled (Phase 3)** — NODE_TLS_REJECT_UNAUTHORIZED=0 disables verification for ALL HTTPS, including Anthropic API. Container-to-container MITM on shared Docker network could intercept API key. **Fix:** Remove global disable, use custom https.Agent for Proxmox only (rejectUnauthorized: false), or add Proxmox CA to NODE_EXTRA_CA_CERTS.

6. **E2E tests against live cluster cause unintended side effects (Phase 4)** — Tests execute real commands on production nodes, consume real Claude tokens, create real events. A test verifying "can stop a VM" actually stops the VM. **Fix:** MockToolExecutor when NODE_ENV=test, restrict automated tests to GREEN-tier read-only tools, test confirmation flows without executing, use test- session prefix for cleanup.

**3 Moderate Pitfalls (delays, costs, technical debt):**

7. **Claude API cost explosion from unbounded agentic loops (Phase 1)** — 10-iteration loop re-sends full history + all tool results each time. Tool definitions alone = 2-3K tokens. Easy to hit 50K-100K tokens per query ($0.45 each). **Fix:** Per-query cost estimation, progressive context pruning after iteration 3, reduce max iterations from 10 to 5, track daily spend with cutoff.

8. **Memory bloat from unbounded tables (Phase 2)** — No cleanup for conversations, events, cluster_snapshots. Events grow 1,440-2,880 rows/day. SQLite bloats, queries slow. **Fix:** TTL cleanup every hour (conversations: 7d, events: 30d, snapshots: 7d), monthly VACUUM, monitor DB size as health metric.

12. **Claude and local LLM have incompatible message formats (Phase 1)** — Anthropic uses content block arrays with tool_use/tool_result types, OpenAI uses flat {role, content} strings. Switching providers mid-conversation loses tool context. **Fix:** Canonical internal format in DB (conversations table already has toolCalls JSON), MessageAdapter layer, summarize prior tool interactions as text when switching.

**6 Minor Pitfalls (annoyance, fixable):** Container cannot reach cluster due to network isolation (use host networking), better-sqlite3 build fails silently (add build tools fallback), no graceful shutdown (add SIGTERM handler), E2E test flakiness from timing (event-based assertions), timezone mismatch (TZ=UTC in environment), missing .dockerignore (create before first build).

## Implications for Roadmap

Based on combined research, the v1.1 milestone naturally decomposes into **4 sequential phases** with clear dependency relationships. The ordering is dictated by technical dependencies (routing abstraction needed before memory's provider-aware context budgets) and operational risk (deploy only when code is stable, test only when deployed).

### Phase 1: Hybrid LLM Router + Cost Tracking

**Rationale:** Foundational refactor with no new external dependencies. Creates the provider abstraction that all other features depend on. Addresses the immediate pain point (unpredictable Claude API costs). Low risk because it wraps existing working code without changing behavior. Can be validated independently before building on top of it.

**Delivers:**
- LLMProvider interface wrapping Claude + Qwen implementations
- Smart routing engine (intent-based, replaces keyword matching)
- Token cost tracker with dashboard integration
- Provider indicator in chat UI
- Separate system prompts for Claude (full) vs Qwen (minimal)
- Context window management for local LLM (4096-token budget enforcement)

**Addresses features:**
- Intent-based routing (table stakes)
- Automatic Claude fallback (table stakes)
- Cost tracking dashboard (differentiator)
- Session-level cost attribution (differentiator)
- Configurable routing rules (differentiator)

**Avoids pitfalls:**
- #1: Routing misclassification (critical)
- #2: Context window overflow (critical)
- #7: Unbounded agentic loop costs (moderate)
- #12: Incompatible message formats (moderate)

**Research needs:** None — routing patterns well-documented, existing code provides all integration points. Unit tests can validate routing logic immediately.

---

### Phase 2: Persistent Memory with TTL Tiers

**Rationale:** Extends the database layer (additive, low risk). Requires Phase 1's provider abstraction because context budgets differ by provider (Claude: 5K tokens, Qwen: 1.5K tokens). Memory injection hooks into the system prompt builder which is stabilized in Phase 1. Independent of deployment — can be developed and tested locally before containerizing.

**Delivers:**
- New memory_tiers table (short-term 7d TTL, long-term permanent)
- Context builder assembling live state + recent events + long-term knowledge
- Scheduled consolidation (TTL cleanup, event summarization, relevance decay)
- Memory management API + UI panel
- TTL-based cleanup for conversations, events, cluster_snapshots

**Addresses features:**
- Cross-session conversation recall (table stakes)
- Cluster state memory (table stakes)
- User preference persistence (table stakes, already partial)
- Tiered memory with TTL (differentiator)
- Context consolidation/summarization (differentiator)
- Progressive context injection (differentiator)

**Avoids pitfalls:**
- #8: Memory bloat from unbounded tables (moderate)
- Lays groundwork for preventing #2 (context overflow) by providing tiered retrieval

**Uses stack:**
- `node-cron` for scheduled cleanup
- Existing better-sqlite3 + Drizzle ORM + schema migration

**Implements architecture:**
- db/context-builder.ts (memory assembly)
- db/consolidator.ts (periodic cleanup + event summarization)
- Extension of ai/system-prompt.ts

**Research needs:** None — SQLite TTL patterns well-documented (Dapr implementation), existing schema provides foundation. May need phase-specific research on summarization heuristics (event consolidation patterns), but this can be deferred to implementation.

---

### Phase 3: Docker Deployment (Full Stack)

**Rationale:** Should package the complete, working application. Deploying before features are complete means redeploying after every change. Deploy once when code is stable. Addresses 5 of the 6 critical pitfalls (SQLite persistence, SSH keys, TLS config, networking, native modules). Cannot be validated without real deployment to management VM.

**Delivers:**
- Updated backend Dockerfile (healthcheck, non-root user, NODE_ENV, graceful shutdown)
- Updated frontend Dockerfile (nginx reverse proxy for /api + /socket.io WebSocket)
- Complete docker-compose.yml (both services, named volumes, resource limits)
- .dockerignore (prevents secret leakage)
- .env.production template
- Deployment script/docs for management VM
- SIGTERM graceful shutdown handler

**Addresses features:**
- Full-stack Docker Compose (table stakes)
- Persistent SQLite volume (table stakes)
- SSH key mounting (table stakes)
- One-command deployment (differentiator)
- Container log aggregation (differentiator)

**Avoids pitfalls:**
- #3: SQLite WAL corruption (critical)
- #4: SSH keys in image (critical)
- #5: TLS globally disabled (critical)
- #9: Container network isolation (moderate)
- #10: better-sqlite3 build failure (moderate)
- #11: No graceful shutdown (moderate)
- #14: Timezone mismatch (minor)
- #15: Missing .dockerignore (minor)

**Uses stack:**
- Docker Compose v2.x
- node:22-slim base image (glibc for better-sqlite3)
- nginx:1.27-alpine for frontend
- Existing Dockerfiles (80% done, need hardening)

**Implements architecture:**
- Deployment layer (docker-compose.yml, nginx.conf)
- Environment configuration (.env.production)
- Resource limits, health checks

**Research needs:** None — Docker patterns well-established, existing Dockerfiles provide foundation. Deploy to management VM for validation, iterate on networking/SSH connectivity if needed.

---

### Phase 4: E2E Testing Infrastructure

**Rationale:** Tests the deployed system end-to-end. Cannot write meaningful E2E tests until features exist and deployment works. Unit tests for individual features (router, cost tracker, context builder) should be written alongside the feature code in Phases 1-2. This phase creates the E2E test harness + integration test infrastructure + mocking layers.

**Delivers:**
- Vitest configuration for unit + integration tests
- Playwright configuration for E2E browser tests
- Unit tests: routing logic, safety tiers, cost tracking, memory TTL, context assembly
- Integration tests: memory CRUD with in-memory SQLite, tool execution pipeline with mocked Proxmox, Socket.IO chat flow
- E2E tests: dashboard loads, chat works, tools execute against live cluster (GREEN-tier only)
- Mock layers: SSH client, Proxmox API, Claude responses
- Test fixtures: recorded Proxmox responses, standard cluster state

**Addresses features:**
- Backend unit tests (table stakes)
- API integration tests (table stakes)
- E2E tests against live cluster (differentiator)

**Avoids pitfalls:**
- #6: E2E tests cause cluster side effects (critical)
- #13: Test flakiness from timing (minor)

**Uses stack:**
- `vitest` + `@vitest/coverage-v8` for unit/integration
- In-memory SQLite for integration tests
- Playwright for E2E (future enhancement, start with Vitest for API/WebSocket tests)

**Implements architecture:**
- Testing layer (tests/, vitest.config.ts)
- MockToolExecutor for non-read-only tests
- Test database helpers

**Research needs:** Phase-specific research likely needed for **Socket.IO testing patterns** — WebSocket test client setup with Vitest is less documented than HTTP testing. Also **mock Proxmox API responses** — may need to record real responses once and replay in tests. Both are implementation details, not architectural decisions.

---

### Phase Ordering Rationale

**Why this sequence:**

1. **Router first** because it refactors the AI module (the highest-risk, highest-value code) while the system is still simple. It creates abstractions that all future features depend on. Testing the router in isolation (before memory, deployment, and E2E infra) reduces debugging surface area. Cost tracking provides immediate operational value.

2. **Memory second** because it depends on router's provider abstraction (context budgets per provider) but is independent of deployment. Developing memory locally with `npm run dev` is faster than iterating in Docker. Memory provides cross-session continuity that makes the local LLM genuinely useful.

3. **Docker third** because it should package the complete, stable application. All code changes (routing, memory) are done. Deployment is a one-time packaging step, not an iterative development environment. Fixes all critical deployment pitfalls (#3-5) before going to production.

4. **Testing last** because you cannot write E2E tests for features that don't exist or against a deployment that doesn't work. Unit tests for routing and memory are written during Phases 1-2 (alongside feature code). Phase 4 creates the test harness, integration test infrastructure, and E2E validation.

**Dependencies:**
- Phase 2 (Memory) DEPENDS ON Phase 1 (Router) — context builder needs provider budgets
- Phase 3 (Docker) DEPENDS ON Phases 1+2 — should package complete code
- Phase 4 (Testing) DEPENDS ON Phase 3 — E2E tests run against deployed containers

**No circular dependencies.** Each phase completes before the next begins. Each phase delivers value independently (router reduces costs, memory enables recall, Docker enables management VM deployment, tests enable confidence).

### Research Flags

**Phases with standard patterns (skip research-phase):**

- **Phase 1 (Hybrid Router):** LLM routing patterns well-documented (RouteLLM, LiteLLM, xRouter papers). Existing code provides integration points. Provider abstraction is a standard OOP pattern. No research needed during planning — implement based on research findings.

- **Phase 3 (Docker Deployment):** Docker best practices well-established. Existing Dockerfiles work (80% done). Nginx reverse proxy for WebSocket is documented. SSH key mounting is standard. Deploy and iterate if connectivity issues arise, but architecture is proven.

**Phases likely needing deeper research during implementation:**

- **Phase 2 (Persistent Memory):** Event consolidation patterns need validation. "How to deterministically summarize 50 repeated thermal warnings into a single memory entry without LLM calls?" The TTL tiers and cleanup are straightforward (SQL-based), but consolidation heuristics may need experimentation. Not architectural research — implementation-level pattern mining.

- **Phase 4 (E2E Testing):** Socket.IO testing with Vitest is less documented than HTTP testing. "How to mock WebSocket events in integration tests?" and "How to record/replay Proxmox API responses for stable tests?" Both are solvable (socket.io-client + custom mock server), but may need phase-specific research during implementation. Not architectural — tooling research.

**When to use /gsd:research-phase:**

- If Phase 2 consolidation patterns prove complex (e.g., "which events should be consolidated vs. retained individually?"), run targeted research: `/gsd:research-phase --phase 2 --focus "event consolidation heuristics for infrastructure monitoring"`

- If Phase 4 WebSocket testing becomes blocked, run targeted research: `/gsd:research-phase --phase 4 --focus "Socket.IO testing patterns with Vitest"`

**Do NOT research:**
- Generic "how to test WebSockets" — too broad
- "How to use Docker" — already know, just executing
- "LLM routing theory" — already researched, just implementing

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm registry (Jan 2026). Existing v1.0 stack unchanged. Only 5 new packages, all standard and stable. Codebase inspection confirms integration points exist. |
| Features | HIGH | Four feature domains clearly scoped. Table stakes identified from expert system patterns (RouteLLM, Mem0, established Docker patterns). Differentiators validated against similar systems. Anti-features explicitly documented with rationale. |
| Architecture | HIGH | Full codebase analysis provides exact integration points. Existing seams identified for each new component. Data flow changes mapped precisely. No speculative abstractions — wrapping proven working code. |
| Pitfalls | HIGH | 15 pitfalls documented across 3 severity tiers. 12 verified from official docs or multi-source community agreement (SQLite WAL behavior, Docker security, Node.js graceful shutdown). 3 inferred from codebase analysis (routing keyword brittleness, context overflow math). Prevention strategies include detection methods. |

**Overall confidence: HIGH**

All four research files show HIGH confidence in their respective domains. Stack recommendations are verified (npm registry + official docs). Features are grounded in existing patterns (research papers, production systems). Architecture is mapped to actual code (every file referenced). Pitfalls are documented with official sources and detection methods.

### Gaps to Address

**Minor gaps (won't block progress):**

1. **Event consolidation heuristics:** The memory consolidation engine (Phase 2) needs deterministic rules for summarizing repeated events. Example: "15 thermal warnings on agent1 over 3 hours" -> "agent1 experienced thermal instability". Research identified the pattern (SQL aggregation + pattern matching) but specific heuristics need experimentation during implementation. Not a blocker — start with simple count-based consolidation, refine based on actual event corpus.

2. **Socket.IO testing patterns with Vitest:** Integration tests for chat flow (Phase 4) need to mock WebSocket events. Vitest docs cover HTTP mocking well, WebSocket less so. Socket.io-client provides a test client, but integration with Vitest's mock system needs experimentation. Fallback: Use socket.io-client directly without mocking framework. Not a blocker — worst case, test via E2E only.

3. **Qwen 2.5 7B function calling reliability at Q4_K_M quantization:** Future enhancement (not v1.1) is adding tool support to local LLM. The ARCHITECTURE.md flags this as MEDIUM confidence — Qwen 2.5 supports function calling via ChatML format, but structured output quality at 4-bit quantization needs empirical testing. Does not affect v1.1 (local LLM remains text-only). Defer to later phase.

**How to handle during planning/execution:**

- Phase 2 implementation: Start with count-based event consolidation ("5 occurrences of event X"), refine with pattern matching as patterns emerge. Budget 20% extra time for heuristic tuning.

- Phase 4 implementation: If WebSocket mocking proves complex, test Socket.IO flows via E2E only (Playwright). Unit test the chat handler logic separately. Integration tests focus on tool execution pipeline (HTTP-based MCP calls).

- Post-v1.1: Run focused research on Qwen function calling reliability before implementing local tool support. This is a v1.2+ feature.

## Sources

All sources aggregated from the four research files with confidence levels preserved.

### PRIMARY (HIGH confidence — official docs, verified npm registry, codebase inspection)

**Technology Stack:**
- npm registry verification (Jan 2026): openai ^6.16.0, vitest ^4.0.18, node-cron ^4.2.1, @vitest/coverage-v8 ^4.0.18, @types/node-cron ^3.0.11
- Anthropic TypeScript SDK v0.71.2 — github.com/anthropics/anthropic-sdk-typescript
- better-sqlite3 v12.6.2 — github.com/WiseLibs/better-sqlite3
- Drizzle ORM v0.45.1 — verified in jarvis-backend/package.json
- OpenAI SDK custom baseURL — ollama.com/blog/openai-compatibility, llama-cpp-python.readthedocs.io
- Docker multi-stage best practices — docs.docker.com/build/building/multi-stage/
- Nginx WebSocket proxying — nginx.org/en/docs/http/websocket.html
- Socket.IO v4 documentation — socket.io/docs/v4/

**Pitfalls:**
- SQLite File Locking and Concurrency — sqlite.org/lockingv3.html
- SQLite Write-Ahead Logging — sqlite.org/wal.html
- Docker: Persist the DB — docs.docker.com/get-started/workshop/05_persisting_data/
- better-sqlite3 database locked in Docker (Issue #1155) — github.com/WiseLibs/better-sqlite3/issues/1155
- better-sqlite3 Alpine Docker (Discussion #1270) — github.com/WiseLibs/better-sqlite3/discussions/1270
- Node.js Best Practices: Graceful Shutdown — github.com/goldbergyoni/nodebestpractices
- Express: Health Checks and Graceful Shutdown — expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
- Claude API tool use implementation — platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use
- OpenAI API vs Anthropic API — docs.anthropic.com/en/api/openai-sdk (compatibility layer limitations)

**Codebase verification:**
- Full jarvis-backend/src/ inspection — all component references verified against actual files
- Existing Dockerfiles analyzed — jarvis-backend/Dockerfile, jarvis-ui/Dockerfile
- docker-compose.yml structure confirmed — backend defined, frontend commented out
- Current routing logic verified — realtime/chat.ts lines 25-48 (keyword matching)
- Memory schema verified — db/schema.ts (5 tables), db/memory.ts (existing CRUD)

### SECONDARY (MEDIUM confidence — multiple sources agree, community consensus, research papers)

**Hybrid LLM Routing:**
- Hybrid Cloud Architecture for LLM Deployment — journal-isi.org (confidence-based routing, 60% cost reduction)
- RouteLLM — github.com/lm-sys/RouteLLM (85% cost reduction, 95% quality)
- vLLM Semantic Router v0.1 Iris — blog.vllm.ai (production semantic routing, Jan 2026)
- LiteLLM Cost Tracking — docs.litellm.ai/docs/proxy/cost_tracking
- NVIDIA LLM Router Blueprint — github.com/NVIDIA-AI-Blueprints/llm-router
- Learning to Route LLMs with Confidence Tokens — arxiv.org/html/2410.13284v2
- Helicone LLM Cost Monitoring — helicone.ai/blog/monitor-and-optimize-llm-costs
- Langfuse Token and Cost Tracking — langfuse.com/docs/observability/features/token-and-cost-tracking

**Persistent Memory:**
- Memory in the Age of AI Agents Survey — github.com/Shichun-Liu/Agent-Memory-Paper-List (HF Daily Paper #1, Dec 2025)
- Mem0: Production-Ready AI Agents — arxiv.org/abs/2504.19413 (90% token cost reduction)
- Building Persistent Memory via MCP — medium.com/@linvald
- Context Window Management Strategies — getmaxim.ai/articles/context-window-management-strategies
- LLM Chat History Summarization Guide — mem0.ai/blog/llm-chat-history-summarization-guide-2025
- MemGPT Adaptive Retention — informationmatters.org (89-95% compression)
- Microsoft Foundry Agent Memory — infoq.com/news/2025/12/foundry-agent-memory-preview/
- OpenAI Agents SDK Session Memory — cookbook.openai.com/examples/agents_sdk/session_memory
- Multi-tier persistent memory for LLMs — healthark.ai/persistent-memory-for-llms-designing-a-multi-tier-context-system/

**Docker Deployment:**
- Docker Official: Containerize Node.js — docs.docker.com/guides/nodejs/containerize/
- Docker Official: Containerize React.js — docs.docker.com/guides/reactjs/containerize/
- 9 Tips for Containerizing Node.js — docker.com/blog/9-tips-for-containerizing-your-node-js-application/
- 10 Best Practices for Node.js Docker — snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/
- SSH Keys in Docker Volume Mount — nickjanetakis.com/blog/docker-tip-56
- Docker Compose SSH Key Security — betterstack.com/community/questions/how-to-use-ssh-key-inside-docker-container/
- Docker Security Best Practices — blog.gitguardian.com/how-to-improve-your-docker-containers-security-cheat-sheet/
- OneUptime Node.js multi-stage Dockerfile — oneuptime.com/blog/post/2026-01-06-nodejs-multi-stage-dockerfile/

**E2E Testing:**
- Playwright WebSocket Testing — dzone.com/articles/playwright-for-real-time-applications-testing-webs
- Playwright WebSocket Class — playwright.dev/docs/api/class-websocket
- WebSocket Testing with MSW — egghead.io/lessons/test-web-sockets-in-playwright-with-msw~rdsus
- Vitest Mocking Guide — vitest.dev/guide/mocking
- Node.js Testing Best Practices — github.com/goldbergyoni/nodejs-testing-best-practices (April 2025)
- API Testing with Vitest — adequatica.medium.com/api-testing-with-vitest-391697942527
- Vitest vs Jest in 2026 — dev.to/dataformathub/vitest-vs-jest-30-why-2026-is-the-year-of-browser-native-testing-2fgb
- Playwright E2E testing guide 2025 — deviqa.com/blog/guide-to-playwright-end-to-end-testing-in-2025/
- Vitest + Playwright complementary testing — browserstack.com/guide/vitest-vs-playwright

**Pitfalls:**
- Context Rot: How Input Tokens Impact LLM Performance — research.trychroma.com/context-rot (peer-reviewed)
- Context Window Management Strategies — getmaxim.ai/articles/context-window-management-strategies
- Top Techniques to Manage Context Length — agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms
- Multi-provider LLM orchestration: 2026 Guide — dev.to/ash_dubai/multi-provider-llm-orchestration-in-production-a-2026-guide-1g10
- LLM cost optimization patterns — byteiota.com/llm-cost-optimization-stop-overpaying-5-10x-in-2026/
- xRouter cost-aware routing — arxiv.org/html/2510.08439v1
- Running E2E Tests in Multiple Environments — qawolf.com/blog/running-the-same-end-to-end-test-on-multiple-environments
- Avoid Testing With Production Data — blazemeter.com/blog/production-data

### TERTIARY (LOW confidence — single source or needs validation)

**Needs validation during implementation:**
- Qwen 2.5 7B function calling reliability at Q4_K_M quantization — no specific research found, needs empirical testing
- Exact memory overhead of jarvis-backend container — estimated ~150-300MB based on similar Node.js apps, measure in practice
- Playwright WebSocket test stability against live Proxmox — needs testing in practice, may have flakiness from node availability
- Semantic memory search with sqlite-vss — extension maturity unclear for production use, keyword search may suffice
- Event consolidation heuristics — specific patterns need experimentation with real event corpus

---

*Research completed: 2026-01-26*
*Ready for roadmap: yes*

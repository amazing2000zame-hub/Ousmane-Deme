# Requirements: v1.1 Hybrid Intelligence & Deployment

**Milestone:** v1.1
**Generated:** 2026-01-26
**Source:** Research (FEATURES.md, SUMMARY.md) + user scoping
**Scope:** Full scope across all 4 domains

---

## Hybrid LLM Routing

- [ ] **ROUTE-01**: Intent-based message routing that classifies user messages as tool-requiring (Claude) or conversational (Qwen) using heuristic analysis, replacing the brittle keyword-matching `needsTools()` function
- [ ] **ROUTE-02**: Automatic fallback to local Qwen when Claude API is unavailable (missing key, rate limited, API down, budget exceeded) with graceful degradation and user notification
- [ ] **ROUTE-03**: Provider indicator in chat UI showing which LLM (Claude or Qwen) generated each response, displayed as a badge or label on message bubbles
- [ ] **ROUTE-04**: Token usage tracking per request with input/output token counts persisted to the conversations table for every Claude API call
- [ ] **ROUTE-05**: Cost tracking dashboard panel showing running daily/weekly/monthly Claude API spend with token-to-dollar conversion
- [ ] **ROUTE-06**: Session-level cost attribution tracking cost per chat session so operator sees which conversations were expensive
- [ ] **ROUTE-07**: Configurable routing rules stored in preferences table allowing operator to set per-tool or per-pattern routing preferences (e.g., "Always use Claude for SSH commands", "Budget cap: $X/day")
- [ ] **ROUTE-08**: Streaming parity between providers ensuring consistent streaming UX regardless of whether Claude or Qwen is responding (both already stream, verify consistency)
- [ ] **ROUTE-09**: Separate system prompts for Claude (full with tool instructions) and Qwen (minimal ~300 tokens, no tool instructions) to prevent context overflow on the 4096-token local LLM
- [ ] **ROUTE-10**: LLMProvider interface abstraction wrapping both Claude and Qwen implementations behind a common TypeScript interface with provider-specific adapters

## Persistent Memory

- [ ] **MEM-01**: Cross-session conversation recall allowing Jarvis to retrieve and reference relevant past conversations when user asks questions like "What did we discuss yesterday about pve's disk?"
- [ ] **MEM-02**: Cluster state memory where Jarvis remembers significant cluster events and changes (e.g., "node agent was offline for 2 hours last Tuesday", "root disk expanded to 112GB on Jan 25")
- [ ] **MEM-03**: User preference persistence across sessions where explicit user preferences ("I prefer email alerts for critical issues", "Don't restart VM 100 without asking") are stored and respected
- [ ] **MEM-04**: Memory-aware system prompt that injects relevant historical context (memories, recent events, preferences) into the LLM system prompt before each call, with token budget management
- [ ] **MEM-05**: Three-tier memory model with TTL -- working memory (session, full verbatim, session lifetime), episodic memory (summarized conversations, 30-day TTL), semantic memory (extracted facts/preferences, indefinite TTL)
- [ ] **MEM-06**: Context consolidation pipeline that extracts key facts and decisions from completed conversations into compact memory entries, reducing 10K tokens of history to ~500-token summaries using the local Qwen LLM
- [ ] **MEM-07**: Progressive context injection that retrieves only memories relevant to the current query with token budgets (500 tokens for facts, 300 for recent events, 200 for preferences) rather than dumping all history
- [ ] **MEM-08**: Autonomy action recall allowing Jarvis to narrate past actions when asked "What actions have you taken today?" by querying the autonomy_actions table
- [ ] **MEM-09**: Memory management UI panel in the dashboard showing what Jarvis remembers (facts, preferences, conversation summaries) with ability for operator to view, edit, and delete memories
- [ ] **MEM-10**: Scheduled TTL cleanup running via node-cron that expires episodic memories after 30 days, cleans old conversations (7 days), events (30 days), and runs periodic SQLite VACUUM

## Docker Deployment

- [ ] **DOCK-01**: Full-stack Docker Compose configuration bringing up both backend (Node.js) and frontend (nginx reverse proxy) with `docker compose up -d`, including WebSocket proxy pass for Socket.IO
- [ ] **DOCK-02**: Persistent SQLite data volume (named volume `jarvis-data` mounted at /data) ensuring database, conversation history, event logs, and preferences survive container restarts
- [ ] **DOCK-03**: SSH key mounting as read-only bind volume (not baked into image) with correct permissions (chmod 600) for cluster node access from backend container
- [ ] **DOCK-04**: Environment variable configuration via .env file with .env.example template documenting all required variables (JWT_SECRET, PVE_TOKEN_SECRET, ANTHROPIC_API_KEY, etc.)
- [ ] **DOCK-05**: Health checks on both services -- backend wget-based health check on /api/health, frontend nginx health endpoint -- enabling Docker to detect and restart failed containers
- [ ] **DOCK-06**: Automatic restart policy (`restart: unless-stopped`) on both services for crash recovery without manual intervention
- [ ] **DOCK-07**: One-command deployment script for management VM (192.168.1.65) that builds and deploys the full stack via `ssh management 'cd /opt/jarvis && docker compose up -d --build'`
- [ ] **DOCK-08**: Container resource limits (CPU and memory) to prevent runaway processes from starving the management VM which runs other Docker services
- [ ] **DOCK-09**: Docker build cache optimization with multi-stage builds that cache `npm ci` layer separately from source code, ensuring rebuilds after code changes complete quickly
- [ ] **DOCK-10**: .dockerignore file preventing SSH keys, .env files, node_modules, and other sensitive/unnecessary files from being included in Docker image layers
- [ ] **DOCK-11**: SIGTERM graceful shutdown handler in backend that properly closes SQLite connections (WAL checkpoint), stops monitoring loops, and drains active Socket.IO connections before exit

## E2E Testing

- [ ] **TEST-01**: Vitest test runner configuration with native ESM + TypeScript support, coverage via @vitest/coverage-v8, and `npm test` command in package.json
- [ ] **TEST-02**: Safety framework unit tests validating all 4 tier boundaries -- GREEN tools auto-execute, YELLOW tools need confirmation, RED tools require confirmation, BLACK tools always blocked, override passkey elevates permissions
- [ ] **TEST-03**: Command sanitization unit tests verifying dangerous SSH commands are blocked and safe commands pass through the allowlist/blocklist enforcement
- [ ] **TEST-04**: API integration tests using Supertest against a real Express instance with test database (in-memory SQLite) validating request/response contracts for REST endpoints
- [ ] **TEST-05**: CI-compatible test runner where all tests run without a real cluster, Proxmox API, or SSH access -- all external dependencies mocked with vi.mock
- [ ] **TEST-06**: WebSocket/Socket.IO chat flow integration tests validating the full chat lifecycle -- connect, send message, receive streaming tokens, receive done event
- [ ] **TEST-07**: LLM routing decision unit tests verifying the router sends tool-requiring messages to Claude and conversational messages to Qwen, including edge cases (ambiguous messages, override passkey, Claude unavailable fallback)
- [ ] **TEST-08**: Docker deployment smoke tests verifying after `docker compose up`: backend health check passes, frontend serves HTML, WebSocket connects, auth flow works
- [ ] **TEST-09**: Memory persistence integration tests verifying messages are saved to SQLite, retrieved across sessions, TTL cleanup works, and memories are injected into system prompts correctly
- [ ] **TEST-10**: MCP tool execution tests for each of the 18 MCP tools tested with mock SSH/Proxmox API responses, verifying correct output format, error handling, and safety tier enforcement
- [ ] **TEST-11**: System prompt snapshot tests catching unintended changes to the complex system prompt (personality + cluster context + safety rules + override state)
- [ ] **TEST-12**: Mock layers for SSH client, Proxmox API, and Claude API responses with test fixtures containing recorded Proxmox responses and standard cluster state

---

## Future Requirements (Deferred)

- **Confidence-based cascade routing** (Qwen first, evaluate, escalate to Claude) -- deferred until cost tracking data shows whether the 60-85% savings justifies the latency doubling on escalated requests
- **Semantic memory search** (vector embeddings, sqlite-vss) -- deferred, keyword search via SQLite FTS5 sufficient for single-user corpus <10K entries
- **Model quality A/B visibility** (thumbs up/down ratings) -- deferred to future version when routing data exists
- **Multi-architecture Docker builds** (buildx for ARM/x86) -- deferred, management VM is x86
- **Container log aggregation with structured JSON logging** -- deferred, `docker compose logs -f` sufficient for now
- **Playwright browser E2E tests** -- start with Vitest for API/WebSocket, add Playwright later if needed

## Out of Scope

- **ML-trained router model** -- overkill for ~50 queries/day single-user system
- **Multiple cloud LLM providers** (OpenAI, Gemini) -- Claude + Qwen cover all needs
- **LLM-as-judge routing** -- doubles API calls, no benefit
- **Vector database** (Pinecone, Chroma, Weaviate) -- external service overhead for small corpus
- **Kubernetes / Docker Swarm** -- single-machine deployment, Compose sufficient
- **Visual regression testing** -- fragile with animations/dynamic data
- **100% code coverage target** -- focus on critical paths (safety, routing, memory)
- **Browser compatibility matrix** -- single operator, Chromium only
- **Performance/load testing** -- single user, no scaling needs
- **CI/CD pipeline** -- manual deploy via SSH sufficient for homelab

---

## Traceability

*Populated by roadmapper — maps each requirement to a phase.*

| REQ | Phase | Status |
|-----|-------|--------|
| ROUTE-01 | — | pending |
| ROUTE-02 | — | pending |
| ROUTE-03 | — | pending |
| ROUTE-04 | — | pending |
| ROUTE-05 | — | pending |
| ROUTE-06 | — | pending |
| ROUTE-07 | — | pending |
| ROUTE-08 | — | pending |
| ROUTE-09 | — | pending |
| ROUTE-10 | — | pending |
| MEM-01 | — | pending |
| MEM-02 | — | pending |
| MEM-03 | — | pending |
| MEM-04 | — | pending |
| MEM-05 | — | pending |
| MEM-06 | — | pending |
| MEM-07 | — | pending |
| MEM-08 | — | pending |
| MEM-09 | — | pending |
| MEM-10 | — | pending |
| DOCK-01 | — | pending |
| DOCK-02 | — | pending |
| DOCK-03 | — | pending |
| DOCK-04 | — | pending |
| DOCK-05 | — | pending |
| DOCK-06 | — | pending |
| DOCK-07 | — | pending |
| DOCK-08 | — | pending |
| DOCK-09 | — | pending |
| DOCK-10 | — | pending |
| DOCK-11 | — | pending |
| TEST-01 | — | pending |
| TEST-02 | — | pending |
| TEST-03 | — | pending |
| TEST-04 | — | pending |
| TEST-05 | — | pending |
| TEST-06 | — | pending |
| TEST-07 | — | pending |
| TEST-08 | — | pending |
| TEST-09 | — | pending |
| TEST-10 | — | pending |
| TEST-11 | — | pending |
| TEST-12 | — | pending |

---

*Generated: 2026-01-26*

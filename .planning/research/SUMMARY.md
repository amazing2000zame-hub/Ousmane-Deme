# Project Research Summary

**Project:** Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard
**Domain:** AI-powered infrastructure management dashboard (self-hosted homelab)
**Researched:** 2026-01-26
**Confidence:** HIGH

---

## Executive Summary

Jarvis 3.1 is a single-user, LAN-deployed AI command center for a 4-node Proxmox homelab cluster, combining real-time infrastructure monitoring, an eDEX-UI/Iron Man visual aesthetic, a hybrid LLM system (Claude API + local Qwen 2.5 7B), and autonomous remediation capabilities exposed through the Model Context Protocol (MCP). Research across stack, features, architecture, and pitfalls converges on a clear conclusion: this is best built as a **modular monolith** -- a single Node.js backend process with clean module boundaries, served alongside a React SPA, deployed as two Docker containers on the existing management VM (192.168.1.65). The technology choices are well-validated: React 19 + Vite 6 + Tailwind CSS v4 for the frontend, Express 5 with the official MCP SDK middleware for the backend, SQLite via Drizzle ORM for persistence, and Socket.IO for real-time push. Every major library recommendation has HIGH confidence backed by official documentation, npm registry data, and existing codebase validation.

The recommended approach is a **dependency-driven 5-phase build**: backend foundation and safety layer first (because every component depends on tools and memory), then the visual dashboard (to validate the data pipeline and eDEX-UI aesthetic before adding AI complexity), then AI chat integration with Claude as the single LLM (to prove tool-calling end-to-end), then autonomous monitoring and remediation (requiring all prior components), and finally hybrid LLM routing and persistent intelligence (which refine an already-working system). This ordering is dictated by hard technical dependencies -- the MCP tool server must exist before the LLM can call tools, and the dashboard must exist before the monitor can push alerts to it.

The dominant risks are **self-management circular dependency** (Jarvis runs on the infrastructure it manages -- an action on agent1 kills Jarvis itself) and **LLM-initiated destructive commands** (stochastic models will eventually propose dangerous operations). Both are CRITICAL severity and must be addressed in Phase 1 with hard-coded dependency DAGs, command allowlists, tiered action classification, and an external watchdog. Secondary risks include WebSocket memory leaks degrading the 24/7 dashboard, sci-fi CSS animations killing usability, and Claude API cost spirals from autonomous monitoring loops. All have well-documented prevention strategies detailed below.

---

## Key Findings

### Recommended Stack

The stack is anchored by two ecosystem-level decisions: **React 19 + Vite 6** for the frontend (already scaffolded in `jarvis-ui/`, no reason to change) and **Express 5 for the backend** (specifically because the MCP TypeScript SDK publishes an official Express middleware -- `@modelcontextprotocol/express` -- eliminating integration glue code). Every other choice flows from these anchors.

**Core technologies:**

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Frontend framework | React + Vite + TypeScript | 19 / 6 / 5.6 | Already scaffolded; React 19 concurrent features; Vite fast HMR |
| Styling | Tailwind CSS v4 | ^4.0.0 | CSS-first config, 5x faster Oxide engine, `@theme` for JARVIS palette |
| Animation | Motion (Framer Motion) | ^12.27.0 | Declarative React animation API; 8M+ weekly downloads |
| State (client) | Zustand | ^5.0.0 | Minimal boilerplate (~3KB); ideal for dashboard UI state |
| State (server) | TanStack Query | ^5.90.0 | Built-in caching, polling, deduplication; proven in proxmox-ui |
| Charts | Recharts | ^2.15.0 | React-native SVG charts; sufficient for dashboard scale |
| Real-time | Socket.IO | ^4.8.0 | Auto-reconnection, rooms, heartbeats; required for terminal + chat |
| Terminal | @xterm/xterm + react-xtermjs | 5.5 / 1.1 | VS Code terminal engine; WebGL renderer |
| Backend framework | Express 5 | ^5.2.0 | Official MCP SDK middleware; async error handling |
| MCP SDK | @modelcontextprotocol/sdk | ^1.25.0 | Official TypeScript SDK; Zod validation; Streamable HTTP transport |
| LLM (cloud) | @anthropic-ai/sdk | ^0.71.0 | Claude API; native tool use; streaming |
| LLM (local) | Vercel AI SDK + @ai-sdk/openai-compatible | ^5.0.0 | Unified provider abstraction; connects to llama-server at :8080 |
| Database | better-sqlite3 + Drizzle ORM | 12.6 / 0.45 | Synchronous, fastest Node.js SQLite; zero-ops; file-based backup |
| SSH | node-ssh | ^13.2.0 | Promise-based SSH wrapper; TypeScript support |
| Deployment | Docker Compose + Nginx Alpine | 2.x / 1.27 | 2-container deployment on management VM |
| Runtime | Node.js 22 LTS Alpine | ^22.x | LTS; ES2022+ support |

**Critical "do NOT use" decisions:**
- **Arwes** (sci-fi framework): Alpha, no React 19 support, unstable API. Build custom sci-fi components instead.
- **Next.js**: This is a SPA dashboard, not SSR. Vite is correct.
- **LangChain**: Heavy, frequent breaking changes. Vercel AI SDK is lighter and sufficient.
- **PostgreSQL**: Overkill for single-user. SQLite is zero-ops.
- **Custom Proxmox client** preferred over `proxmox-api` npm (GPL-3.0 concern, stale package).

See [STACK.md](./STACK.md) for full version matrix, installation commands, and alternative analysis.

### Expected Features

Research identified a clear 3-tier feature hierarchy driven by dependency analysis.

**Must have (table stakes) -- delivers value without AI:**
- Node health overview (CPU, RAM, disk, temperature, uptime) for all 4 nodes
- VM/Container list with status indicators and start/stop/restart controls
- Storage overview with usage bars and threshold coloring
- Real-time WebSocket updates (no page refresh; 10-15s polling cadence)
- System terminal (eDEX-UI styled xterm.js with SSH PTY to any node)
- Cluster quorum status (prominently visible)
- eDEX-UI visual identity from day one (Iron Man HUD aesthetic)

**Should have (differentiators) -- the reason to build this:**
- Natural language chat with JARVIS personality (formal, British, witty)
- AI-powered cluster queries via MCP tool calling ("How's the cluster?", "Start VM 100")
- Hybrid LLM routing (Claude for complex, Qwen for routine)
- Autonomous monitoring with Act+Report remediation model (5 autonomy levels: Observe, Alert, Recommend, Act+Report, Act Silently)
- Persistent memory (events, actions, conversations, cluster snapshots in SQLite)
- Jarvis activity feed (live AI action log)
- Action confirmation UX (tiered safety: read=auto, lifecycle=confirm, dangerous=double-confirm)
- AI-narrated email reports (leveraging existing email agent on agent1)

**Defer (v2+):**
- Voice input/output (TTS/STT) -- explicitly deferred in project definition
- Widget-based configurable layouts -- fixed 3-column layout IS the identity
- Multi-user RBAC -- single operator system
- Smart home integration -- Proxmox cluster only
- Predictive maintenance / anomaly detection -- needs data collection first
- Log aggregation (Loki/ELK) -- show recent errors, link to external tools
- Full Proxmox UI replacement -- complement, don't replace

**MCP Tool Inventory:** 9 read-only tools (safe), 6 lifecycle tools (require confirmation), 3 system tools (require double-confirmation). Task-oriented design, not API-surface-oriented. Total: ~18 tools, well under the recommended 40-tool ceiling.

See [FEATURES.md](./FEATURES.md) for full feature landscape, dependency graph, autonomy model, and MCP tool inventory.

### Architecture Approach

A **6-component modular monolith** in a single Node.js process, deployed as 2 Docker containers (frontend Nginx + backend Node.js) on the management VM. Components communicate via direct function calls and EventEmitter within the process -- no IPC, no service mesh, no microservices overhead. This is correct for a single-developer, single-user, 4-node homelab with limited VM resources (4 CPUs, ~5.5 GB available RAM on management VM).

**Major components:**

1. **React Frontend** -- eDEX-UI SPA; 3-column layout (cluster, Jarvis, terminal); communicates only with API Gateway via REST + WebSocket
2. **API Gateway (Express 5)** -- HTTP + WebSocket server; JWT auth; multiplexed WebSocket protocol across channels (cluster, chat, events, terminal)
3. **MCP Server (in-process)** -- Tool registry with 3-tier safety model (READ/WRITE/DANGEROUS); Proxmox REST API + SSH; NOT a separate process
4. **LLM Router** -- Confidence-based cascading between Claude (cloud) and Qwen (local); unified abstraction layer; tool call execution pipeline
5. **Memory Store (SQLite)** -- Events, conversations, cluster snapshots, preferences; context injection engine with budget-aware token management
6. **Monitor Service** -- Autonomous event loop; tiered polling (10s critical, 30s important, 5min routine, 30min background); remediation playbooks

**Critical architectural decisions:**
- Proxmox REST API over HTTPS (port 8006), NOT `pvesh` CLI -- management VM is Ubuntu, not PVE node
- Single multiplexed WebSocket connection, NOT separate connections per feature
- In-process MCP server via direct function calls, NOT stdio/HTTP transport (but can add external transport later)
- API token auth for Proxmox, NOT PAM password auth
- Socket.IO for WebSocket (reconnection, rooms, heartbeats justify overhead for <100 clients)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full component specifications, data flow diagrams, Docker deployment config, and inter-component communication matrix.

### Critical Pitfalls

Research identified 13 pitfalls across 3 severity tiers. The top 5 that directly shape roadmap decisions:

1. **Self-Management Circular Dependency (CRITICAL)** -- Jarvis runs in Docker on management VM on agent1 on the cluster it manages. Actions on agent1 kill Jarvis with no self-recovery. **Prevention:** Hard-coded dependency DAG (agent1, VMID 103, Docker daemon are protected), external watchdog on Home node, quorum protection (never act on >1 node simultaneously).

2. **LLM-Initiated Destructive Commands (CRITICAL)** -- LLMs are stochastic; they will eventually propose `rm -rf /` or stop VMID 103. **Prevention:** Command allowlist (not blocklist), structured tool calls only (never raw shell from LLM), 4-tier action classification (Green/Yellow/Red/Black), VMID/node identity verification before every action.

3. **Prompt Injection via Infrastructure Data (HIGH)** -- Cluster logs, VM names, and error messages can contain text the LLM treats as instructions. **Prevention:** Strict `<cluster_data>` framing in prompts, sanitize all infrastructure inputs, output validation via deterministic code (not another LLM call), memory input sanitization.

4. **WebSocket Memory Leaks (HIGH)** -- 24/7 dashboard accumulates stale connections, unbounded arrays, orphaned state. **Prevention:** Bounded ring buffers (max 300 data points per metric), mandatory cleanup on unmount, exponential backoff with jitter for reconnection, ping/pong heartbeat, batch UI updates at 100ms intervals.

5. **Sci-Fi UI Destroying Usability (HIGH)** -- eDEX-UI looks amazing in mockups, kills productivity after 10 minutes. Original eDEX-UI was archived for performance issues. **Prevention:** Function-first design (build readable dashboard, then add sci-fi layers), GPU-composited animation techniques only, respect `prefers-reduced-motion`, three visual modes (JARVIS/Ops/Minimal), WCAG AA contrast ratios.

See [PITFALLS.md](./PITFALLS.md) for all 13 pitfalls with detailed prevention strategies, phase-specific warnings, and domain risk matrix.

---

## Implications for Roadmap

Based on combined research, the build order is dictated by hard technical dependencies (documented in ARCHITECTURE.md) and pitfall timing requirements (documented in PITFALLS.md). Five phases recommended.

### Phase 1: Backend Foundation & Safety Layer
**Rationale:** Every other component depends on the tool layer and memory store. Safety constraints must be architectural (Phase 1), not retrofitted. The MCP server is the "hands" of the system -- nothing works without it.
**Delivers:** Express 5 backend, MCP tool server with ~18 tools, SQLite memory store schema, Proxmox REST API client, SSH client with connection pooling, JWT auth, safety framework (dependency DAG, action tiers, command allowlist), Docker Compose skeleton.
**Features addressed:** Backend API, Proxmox API integration, authentication, MCP tool registry, memory store schema.
**Pitfalls addressed:** #1 (self-management paradox -- protected resource list), #2 (destructive commands -- tiered actions, allowlist), #3 (prompt injection -- data sanitization), #7 (tool proliferation -- task-oriented design), #9 (Docker socket -- use SSH instead), #12 (MCP crash -- try/catch wrapping, timeouts).
**Research flag:** RECOMMENDED -- Proxmox API token setup, SSH key Docker mounting, Docker socket proxy vs SSH.

### Phase 2: Real-Time Dashboard & eDEX-UI Visual Identity
**Rationale:** A working dashboard delivers immediate value and validates the data pipeline + visual identity before AI complexity. All table-stakes monitoring features require only the backend from Phase 1, not LLM integration. The sci-fi aesthetic must be proven early -- it is the product identity.
**Delivers:** React 19 SPA with 3-column layout, node health grid, VM/container list with controls, storage overview, xterm.js terminal, Socket.IO real-time push, eDEX-UI styling (Tailwind v4 + Motion), connection status indicators, staleness warnings.
**Features addressed:** All 8 table-stakes dashboard features, system terminal, real-time updates, eDEX-UI aesthetic, visual alert indicators.
**Pitfalls addressed:** #4 (WebSocket memory leaks -- bounded buffers, cleanup hooks), #8 (sci-fi performance -- function-first, GPU-composited only, 3 visual modes), #10 (stale data -- staleness indicators, heartbeat, reconnect with full refresh).
**Research flag:** RECOMMENDED -- Tailwind CSS v4 `@theme` directive, xterm.js WebGL + react-xtermjs integration.

### Phase 3: AI Chat & Claude Integration
**Rationale:** Start with Claude API only (simpler, smarter, native MCP tool use) to prove the full AI loop end-to-end before adding hybrid routing complexity. MCP is Claude's native protocol -- this is the path of least resistance.
**Delivers:** Chat interface panel with streaming responses, Claude API integration via Anthropic SDK, MCP tool calling from LLM, JARVIS personality via system prompt, action confirmation UX (tiered safety cards in chat), cluster context injection into system prompt.
**Features addressed:** Natural language chat, cluster status queries via AI, VM/CT management via chat, error explanation, JARVIS personality, streaming responses, action confirmation UX, context-aware responses.
**Pitfalls addressed:** #2 (destructive commands -- confirmation UX enforced before execution), #3 (prompt injection -- data/instruction separation in prompts), #7 (tool selection -- LLM-optimized tool descriptions, empirical testing).
**Research flag:** SKIP -- Claude tool use is extensively documented.

### Phase 4: Autonomous Monitoring & Remediation
**Rationale:** Autonomy requires working AI + tools + dashboard. This phase transforms Jarvis from a reactive assistant into a proactive operator. The 5-level autonomy model (Observe/Alert/Recommend/Act+Report/Act Silently) and runbook-based remediation are the core differentiators.
**Delivers:** Monitor service event loop (tiered polling), threshold-based alerting, Jarvis activity feed panel, auto-remediation runbooks (node unreachable -> WOL, VM crashed -> restart, service down -> restart), action audit log (SQLite-backed), email reports via existing agent1 infrastructure, kill switch toggle on dashboard.
**Features addressed:** Background monitoring, threshold alerts, activity feed, auto-remediation, audit log, email reports, severity-tiered notifications.
**Pitfalls addressed:** #1 (self-management -- quorum protection, protected resources enforced in monitor), #12 (MCP crash -- resilient tool execution in monitoring loop), #13 (Qwen quality under load -- monitoring uses structured tool calls, not LLM reasoning).
**Research flag:** RECOMMENDED -- Autonomous remediation safety testing against real cluster.

### Phase 5: Hybrid LLM Intelligence & Persistent Memory
**Rationale:** Hybrid routing and persistent memory refine an already-working system. Adding Qwen as a second LLM path requires the unified abstraction layer, cost tracking, and context management. Memory consolidation requires operational data from Phase 4's audit log.
**Delivers:** Hybrid LLM router (Claude for complex, Qwen for routine), unified provider abstraction via Vercel AI SDK, Qwen-first routing with Claude escalation, cost tracking dashboard, persistent memory system with TTLs and tiered storage (core facts / operational state / event log / conversation history), context window management (budget-aware injection), memory consolidation pass, preference learning (basic).
**Features addressed:** Hybrid LLM routing, persistent memory, cluster state snapshots, cost management, preference learning (basic).
**Pitfalls addressed:** #5 (context inconsistency -- unified abstraction, per-task routing not per-conversation), #6 (memory bloat -- tiered TTLs, selective injection, consolidation), #11 (cost spiral -- Qwen-first, budget caps, request caching), #13 (Qwen quality -- quality canary, priority queuing, slot reservation).
**Research flag:** RECOMMENDED -- Qwen 2.5 7B tool-calling reliability, Vercel AI SDK 5 openai-compatible provider configuration.

### Phase Ordering Rationale

1. **Dependency-driven:** Memory Store and MCP Server have zero dependencies on other components but everything depends on them. They must come first.
2. **Risk front-loading:** The two CRITICAL pitfalls (self-management paradox, destructive commands) must be addressed in Phase 1. Retrofitting safety is architecturally impossible.
3. **Value delivery:** Phase 2 delivers a usable dashboard independently of AI. If the project stalls after Phase 2, there is still a functional monitoring tool.
4. **Complexity escalation:** Single LLM (Phase 3) before hybrid LLM (Phase 5). Prove the loop works with Claude before adding routing complexity.
5. **Data dependency:** Persistent memory (Phase 5) requires operational history from the audit log (Phase 4). You cannot build memory consolidation without data to consolidate.
6. **Aesthetic validation:** Phase 2 proves the eDEX-UI identity early. If the sci-fi look doesn't work, pivoting at Phase 2 is cheap; pivoting at Phase 5 is expensive.

### Research Flags Summary

| Phase | Research Needed? | Reason |
|-------|-----------------|--------|
| Phase 1 | RECOMMENDED | Proxmox API token creation, SSH key Docker mounting, Docker socket proxy vs SSH |
| Phase 2 | RECOMMENDED | Tailwind v4 `@theme` API, xterm.js WebGL + react-xtermjs integration |
| Phase 3 | SKIP | Claude tool use is extensively documented |
| Phase 4 | RECOMMENDED | Autonomous remediation safety testing against real cluster |
| Phase 5 | RECOMMENDED | Qwen tool-calling reliability, Vercel AI SDK 5 provider config |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | All major libraries verified via npm registry, official docs, and existing codebase. Version numbers confirmed current. MCP SDK Express middleware verified. |
| Features | **HIGH** (table stakes), **MEDIUM** (autonomy) | Dashboard metrics and MCP tool inventory backed by 4+ existing Proxmox MCP implementations. AI autonomy levels based on industry frameworks but untested at homelab scale. |
| Architecture | **HIGH** | Modular monolith pattern well-documented. Proxmox REST API, Socket.IO, SQLite all proven. MCP in-process pattern verified against SDK source. |
| Pitfalls | **HIGH** | 11 of 13 pitfalls rated HIGH confidence with multiple authoritative sources. 2 rated MEDIUM (cost projections, Qwen quality) due to usage-dependent variability. |

**Overall confidence: HIGH**

The research foundation is strong. The stack is well-validated, the architecture is proven at this scale, the features have clear precedent in existing tools (Pulse, Grafana, existing Proxmox MCP servers), and the pitfalls are well-documented with concrete prevention strategies. The primary unknowns are empirical: Qwen 2.5 7B tool-calling reliability and autonomous remediation behavior against a live cluster.

### Gaps to Address

1. **Proxmox API token creation:** No token currently exists. Must create `root@pam!jarvis` on each PVE node before Phase 1 backend can connect. This is a manual prerequisite, not a code task.

2. **Qwen 2.5 7B tool-calling quality:** Theoretical capability confirmed (Qwen 2.5 supports function calling) but reliability with specific MCP tool schemas is untested. Phase 5 must include empirical benchmarking before committing to Qwen for production tool calls.

3. **Management VM resource headroom:** Current usage is 2.3 GB / 8 GB RAM with 16 containers. Jarvis adds ~250-450 MB. This is comfortable but should be monitored, especially during LLM streaming + multiple WebSocket connections + terminal sessions.

4. **Tailwind CSS v4 migration:** Existing scaffold uses v3. Migration to v4 changes config format entirely (CSS-first, no `tailwind.config.js`). Well-documented but must be done carefully early in Phase 2.

5. **react-xtermjs maturity:** Rated MEDIUM confidence. Package is by Qovery, actively maintained, but less battle-tested than raw xterm.js. Fallback: use xterm.js directly with a custom React wrapper.

6. **Self-signed TLS for Proxmox API:** PVE nodes use self-signed certificates. The Proxmox client must disable SSL verification (`verifySsl: false`). This is acceptable on a trusted LAN but should be explicitly configured.

7. **Qwen model size consideration:** 7B Q4_K_M may be insufficient for reliable tool calling. agent1 has 31 GB RAM -- a 14B or 32B model could run there. Evaluate during Phase 5 before finalizing the production model.

---

## Sources

### Primary (HIGH confidence)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- v1.25.2, Express middleware, transport options
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) -- Protocol architecture, security model
- [Proxmox VE API Documentation](https://pve.proxmox.com/pve-docs/api-viewer/) -- REST API, authentication
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) -- v0.71.2, tool use, streaming
- [Tailwind CSS v4.0 Release](https://tailwindcss.com/blog/tailwindcss-v4) -- CSS-first config, Oxide engine
- [Motion npm](https://www.npmjs.com/package/framer-motion) -- v12.27.0, React animation
- [TanStack Query](https://tanstack.com/query/latest) -- v5, polling, caching
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.6.2, synchronous driver
- [Drizzle ORM npm](https://www.npmjs.com/package/drizzle-orm) -- v0.45.1, SQL-first, zero deps

### Secondary (MEDIUM confidence)
- [Vercel AI SDK 5 Blog](https://vercel.com/blog/ai-sdk-5) -- Multi-provider, streaming, TypeScript-first
- [4 existing Proxmox MCP servers on GitHub](https://github.com/gilby125/mcp-proxmox) -- Tool inventory consensus
- [eDEX-UI GitHub (Archived)](https://github.com/GitSquared/edex-ui) -- Performance lessons, UI patterns
- [OWASP Top 10 for LLM Applications 2025](https://owasp.org/) -- Prompt injection prevalence (73%)
- [Unit 42: Persistent Memory Poisoning](https://unit42.paloaltonetworks.com/indirect-prompt-injection-poisons-ai-longterm-memory/) -- Indirect prompt injection research
- [MCP "Too Many Tools" Problem](https://demiliani.com/2025/09/04/model-context-protocol-and-the-too-many-tools-problem/) -- Tool count limits
- [OpenAI Cookbook: Context Engineering](https://cookbook.openai.com/examples/agents_sdk/context_personalization) -- Memory patterns
- [ACM Queue: Tracking Dependencies](https://queue.acm.org/detail.cfm?id=3277541) -- Circular dependency patterns
- [MDN: CSS Animation Performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate) -- GPU-composited techniques

### Tertiary (LOW confidence, needs validation)
- Qwen 2.5 7B function-calling reliability -- needs empirical testing with project-specific tools
- LiteLLM routing specifics -- needs validation with actual Qwen model
- better-sqlite3 performance at scale -- likely sufficient but not benchmarked for this workload
- react-xtermjs long-term stability -- actively maintained but newer package

---

*Research completed: 2026-01-26*
*Ready for roadmap: yes*

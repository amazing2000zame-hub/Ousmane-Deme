# Roadmap: Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard

## Overview

Jarvis 3.1 transforms a 4-node Proxmox homelab cluster into an AI-operated command center with a futuristic dashboard, natural language control, and autonomous remediation. The build follows a strict dependency chain: backend tools and safety first (because everything depends on them), then the visual dashboard (to deliver value and validate the eDEX-UI aesthetic before AI complexity), then AI chat with Claude (to prove tool-calling end-to-end), then autonomous operations (requiring all prior components working), and finally hybrid intelligence with persistent memory (refining an already-working system). Each phase delivers a standalone, verifiable capability.

## Milestone 1: MVP

- [ ] **Phase 1: Backend Foundation & Safety Layer** - Express 5 API, MCP tool server, SQLite memory schema, Proxmox REST client, SSH client, safety framework
- [ ] **Phase 2: Real-Time Dashboard & eDEX-UI Visual Identity** - React 19 SPA, 3-column layout, live cluster monitoring, xterm.js terminal, sci-fi aesthetic
- [ ] **Phase 3: AI Chat & Claude Integration** - Chat interface, Claude API tool calling, JARVIS personality, action confirmation UX
- [ ] **Phase 4: Autonomous Monitoring & Remediation** - Background monitoring loop, threshold alerts, auto-remediation runbooks, activity feed, email reports
- [ ] **Phase 5: Hybrid LLM Intelligence & Persistent Memory** - Qwen routing, unified LLM abstraction, persistent memory with TTLs, cost tracking, context management

---

## Phase Details

### Phase 1: Backend Foundation & Safety Layer

**Goal**: A running backend that can talk to every cluster node, execute safe operations via MCP tools, persist events to SQLite, and block any action that could kill Jarvis or the cluster -- all deployed as a Docker container on the management VM.

**Depends on**: Nothing (first phase)

**Features addressed**:
- MCP tool server exposing Proxmox API, system commands, Docker management
- Real-time data updates via WebSocket (backend portion)
- Persistent memory system (schema and write path)

**Research-derived requirements**:
- REQ-BACKEND: Express 5 API server with JWT auth, Socket.IO WebSocket, health endpoint
- REQ-MCP: MCP tool server with ~18 tools (9 read-only, 6 lifecycle, 3 system) using 3-tier safety model
- REQ-PVE: Custom Proxmox REST API client with API token auth (not pvesh CLI)
- REQ-SSH: SSH client with connection pooling via node-ssh to all 4 cluster nodes
- REQ-MEMORY-SCHEMA: SQLite database via better-sqlite3 + Drizzle ORM (events, conversations, snapshots, preferences tables)
- REQ-SAFETY: Self-management protection (dependency DAG, protected resource list: agent1, VMID 103, Docker daemon)
- REQ-TIERS: 4-tier action classification (Green/Yellow/Red/Black) with command allowlist
- REQ-SANITIZE: Data sanitization for all infrastructure inputs (prompt injection prevention)
- REQ-DOCKER: Docker Compose skeleton with backend container, SQLite volume, SSH key mount
- REQ-WATCHDOG: External watchdog specification (Home node pings Jarvis, restarts management VM if unresponsive)

**Success Criteria** (what must be TRUE):
1. Backend container starts on management VM (192.168.1.65) and responds to health check at /api/health
2. All 18 MCP tools execute successfully -- read-only tools return correct cluster data from all 4 nodes via Proxmox REST API
3. Lifecycle tools (start/stop VM) execute with correct tier enforcement -- Green auto-executes, Red requires confirmation flag, Black is blocked
4. Actions targeting agent1, VMID 103, or the Docker daemon are blocked with a clear error identifying the protected resource
5. Events are persisted to SQLite and retrievable via the memory store API

**Estimated Complexity**: HIGH -- This phase has the most moving parts (PVE API, SSH, MCP SDK, SQLite, safety framework). The safety layer is architecturally critical and cannot be retrofitted.

**Research Flags**:
- RECOMMENDED: Proxmox API token creation (`root@pam!jarvis`) -- manual prerequisite on each PVE node
- RECOMMENDED: SSH key Docker mounting strategy (read-only volume)
- RECOMMENDED: Docker socket proxy vs SSH for Docker management (research recommends SSH to avoid socket exposure)

**Pitfalls to address**:
- CRITICAL #1: Self-management paradox -- hard-coded dependency DAG, protected resource list
- CRITICAL #2: Destructive commands -- tiered actions, command allowlist, structured tool calls only
- HIGH #3: Prompt injection -- data sanitization on all infrastructure inputs
- HIGH #7: Tool proliferation -- task-oriented design (18 tools, not 50 API wrappers)
- MINOR #9: Docker socket -- use SSH instead of socket mount
- MINOR #12: MCP crash -- try/catch wrapping on every tool handler, timeouts on all external calls

**Risk callouts**:
- Self-signed TLS on Proxmox nodes requires `verifySsl: false` -- acceptable on trusted LAN
- Management VM is Ubuntu, not PVE -- pvesh is unavailable, REST API is the only path
- SSH key must be mounted read-only into Docker container -- security boundary

**Plans**: 4 plans

Plans:
- [ ] 01-01-PLAN.md -- Express 5 backend scaffold with Docker Compose, health endpoint, JWT auth, Socket.IO
- [ ] 01-02-PLAN.md -- Proxmox REST API client and SSH client with connection pooling
- [ ] 01-03-PLAN.md -- MCP tool server with all 18 tools, safety framework, and tier enforcement
- [ ] 01-04-PLAN.md -- SQLite memory store schema and event persistence layer

---

### Phase 2: Real-Time Dashboard & eDEX-UI Visual Identity

**Goal**: A user opens the dashboard in a browser and sees live cluster health for all 4 nodes, can start/stop VMs, open a terminal to any node, and the entire experience looks like an Iron Man command center -- all updating in real-time without page refresh.

**Depends on**: Phase 1 (backend API, WebSocket server, MCP tools for cluster data)

**Features addressed**:
- eDEX-UI / Iron Man style dashboard with 3-column layout
- Live Proxmox cluster status (nodes, VMs, containers, resources)
- System terminal panel (eDEX-style command input)
- Real-time data updates via WebSocket (frontend portion)
- Multi-device responsive (dedicated display, desktop, mobile)

**Research-derived requirements**:
- REQ-LAYOUT: 3-column layout -- Left: infrastructure (nodes, VMs, storage), Center: Jarvis activity, Right: system terminal
- REQ-NODES: Node health grid showing CPU, RAM, disk, temperature, uptime for all 4 nodes
- REQ-VMS: VM/Container list with status indicators and start/stop/restart controls
- REQ-STORAGE: Storage overview with usage bars and threshold coloring
- REQ-TERMINAL: xterm.js terminal with SSH PTY to any cluster node (WebSocket-backed)
- REQ-REALTIME: Socket.IO WebSocket push from backend (10s nodes, 15s VMs, 30s temps)
- REQ-QUORUM: Cluster quorum status prominently visible (votes/expected votes)
- REQ-EDEX: eDEX-UI visual identity (amber/gold palette, scan lines, glow effects, grid patterns)
- REQ-VISUAL-MODES: Three visual modes (JARVIS/Ops/Minimal) for different use cases
- REQ-STALENESS: Connection status indicator and data staleness warnings
- REQ-RESPONSIVE: Responsive layout for dedicated display, desktop, and mobile

**Success Criteria** (what must be TRUE):
1. Dashboard loads in browser showing all 4 nodes with live CPU, RAM, disk, temperature, and uptime -- data updates every 10-15 seconds without page refresh
2. User can start, stop, and restart any VM or container from the dashboard with one click and see the status change reflected within 15 seconds
3. User can open an eDEX-style terminal, select any cluster node, and get a working SSH shell with full keyboard input and terminal output
4. The dashboard has an unmistakable Iron Man / eDEX-UI sci-fi aesthetic (amber/gold on dark, scan lines, glow effects) and all text meets WCAG AA contrast
5. When the WebSocket connection drops, a visible disconnection indicator appears within 30 seconds, and data staleness warnings show on affected panels

**Estimated Complexity**: HIGH -- The eDEX-UI aesthetic is the most effort-intensive part. Function-first approach (build readable dashboard, then layer sci-fi) is essential to avoid the usability pitfall.

**Research Flags**:
- RECOMMENDED: Tailwind CSS v4 `@theme` directive for JARVIS amber/gold palette
- RECOMMENDED: xterm.js WebGL renderer + react-xtermjs integration pattern
- NOTE: Existing `jarvis-ui/` scaffold has React 19 + Vite 6 + Tailwind v3 -- must upgrade to v4

**Pitfalls to address**:
- HIGH #4: WebSocket memory leaks -- bounded ring buffers (max 300 points), cleanup on unmount, custom `useWebSocket` hook, 100ms batch updates
- HIGH #8: Sci-fi UI performance -- function-first design, GPU-composited animations only, `prefers-reduced-motion` support, 3 visual modes
- HIGH #10: Stale data -- staleness indicators on every panel, connection status dot, full state refresh on reconnect

**Risk callouts**:
- Tailwind v3 to v4 migration changes config format entirely (CSS-first, no tailwind.config.js)
- react-xtermjs rated MEDIUM confidence -- fallback to raw xterm.js wrapper if issues arise
- Management VM has limited GPU -- CSS animations must use GPU-composited properties only (transform, opacity)
- eDEX-UI aesthetic is the product identity but the original eDEX-UI was archived for performance issues

**Plans**: TBD

Plans:
- [ ] 02-01: React SPA scaffold upgrade (Tailwind v4, Zustand, TanStack Query, Socket.IO client, routing)
- [ ] 02-02: 3-column layout with node health grid, VM/CT list, storage overview, quorum status
- [ ] 02-03: xterm.js terminal panel with SSH PTY backend and node selector
- [ ] 02-04: eDEX-UI visual layer (sci-fi styling, animations, visual modes, responsive breakpoints)

---

### Phase 3: AI Chat & Claude Integration

**Goal**: A user types a natural language message to Jarvis, gets a streaming response in the JARVIS personality, and Jarvis can query cluster status and execute operations via MCP tools -- with tiered confirmation for dangerous actions shown as visual cards in the chat.

**Depends on**: Phase 2 (dashboard exists for chat panel, MCP tools proven in Phase 1)

**Features addressed**:
- Jarvis activity panel (status, feed, chat interface)
- JARVIS personality (Iron Man -- witty, formal, British butler humor)

**Research-derived requirements**:
- REQ-CHAT: Chat interface panel with message history, text input, and streaming response display
- REQ-CLAUDE: Claude API integration via @anthropic-ai/sdk with native tool use (function calling)
- REQ-TOOL-CALLING: MCP tool calling from Claude -- Claude sends tool_use blocks, backend executes via MCP server, returns results
- REQ-PERSONALITY: JARVIS personality via system prompt (formal, British, witty) -- consistent across all responses
- REQ-CONFIRM-UX: Action confirmation UX in chat -- Read tools auto-execute, Lifecycle tools show confirmation card, Dangerous tools show double-confirm card
- REQ-CONTEXT-INJECT: Cluster context injection into system prompt (current node status, unresolved issues, recent actions)
- REQ-STREAMING: Streaming responses via WebSocket (tokens appear as generated)
- REQ-CHAT-TOOLS: Chat-initiated cluster queries ("How's the cluster?") and VM management ("Start VM 100")

**Success Criteria** (what must be TRUE):
1. User types "How's the cluster?" and receives a streaming response in JARVIS personality that accurately describes the current state of all 4 nodes, pulled from live MCP tool data
2. User types "Start VM 101" and sees a confirmation card in the chat showing what will happen -- clicking confirm starts the VM and Jarvis reports the result
3. User types "Reboot agent1" and sees a double-confirmation card warning that this is a dangerous operation targeting a protected resource dependency -- the action is blocked with explanation
4. All responses stream token-by-token (not waiting for full response) and maintain consistent JARVIS personality (formal, British, witty)
5. Jarvis explains errors and issues using cluster context -- asking "Why is node X slow?" produces a diagnosis based on current metrics, not a generic answer

**Estimated Complexity**: MEDIUM -- Claude's native MCP tool use is well-documented and the backend infrastructure exists from Phase 1. The main effort is the chat UI, streaming display, and confirmation UX.

**Research Flags**:
- SKIP: Claude tool use is extensively documented -- no additional research needed

**Pitfalls to address**:
- CRITICAL #2: Destructive commands -- confirmation UX enforced in chat before tool execution
- HIGH #3: Prompt injection -- data/instruction separation in system prompts, `<cluster_data>` framing
- HIGH #7: Tool selection -- LLM-optimized tool descriptions, empirical testing of Claude's tool choice accuracy

**Risk callouts**:
- Claude API requires internet -- if internet is down, chat is unavailable (no fallback until Phase 5)
- Claude API has usage-based cost -- complex conversations consume tokens rapidly
- System prompt must be tuned for personality consistency while remaining functional

**Plans**: TBD

Plans:
- [ ] 03-01: Chat interface panel with message history, streaming display, and WebSocket integration
- [ ] 03-02: Claude API integration with tool calling pipeline and context injection
- [ ] 03-03: Action confirmation UX (tiered safety cards) and JARVIS personality tuning

---

### Phase 4: Autonomous Monitoring & Remediation

**Goal**: Jarvis monitors the cluster continuously in the background, detects problems automatically, fixes well-understood issues using predefined runbooks (Act+Report model), and shows all activity in a live feed on the dashboard -- with a kill switch to disable all autonomous actions.

**Depends on**: Phase 3 (AI chat works, MCP tools proven, dashboard exists for activity feed)

**Features addressed**:
- Autonomous monitoring and remediation (act + report)

**Research-derived requirements**:
- REQ-MONITOR: Background monitoring event loop with tiered polling (10s critical, 30s important, 5min routine, 30min background)
- REQ-ALERTS: Threshold-based alerting (disk >90%, RAM >95%, node unreachable, VM crashed)
- REQ-AUTONOMY: 5-level autonomy model (L0 Observe, L1 Alert, L2 Recommend, L3 Act+Report, L4 Act Silently)
- REQ-RUNBOOKS: Predefined remediation runbooks (node unreachable -> WOL, VM crashed -> restart, service down -> restart)
- REQ-ACTIVITY-FEED: Live Jarvis activity feed panel on dashboard showing timestamped observations, actions, and results
- REQ-AUDIT: Action audit log in SQLite -- every autonomous action logged with timestamp, condition, action, result, rollback info
- REQ-EMAIL: AI-narrated email reports via existing agent1 email infrastructure
- REQ-KILLSWITCH: Global toggle on dashboard to disable all autonomous actions
- REQ-GUARDRAILS: Rate limiting (max 3 remediation attempts per issue per hour), blast radius control (never act on >1 node simultaneously), escalation (after 3 failures, stop and email user)

**Success Criteria** (what must be TRUE):
1. When a VM that was running becomes stopped, Jarvis detects it within 30 seconds, automatically restarts it, verifies recovery, and the activity feed shows the full sequence (detected -> restarting -> verified -> resolved)
2. When a node becomes unreachable, Jarvis sends a Wake-on-LAN packet, waits for recovery, and reports the result via both the activity feed and email notification
3. The dashboard shows a live activity feed with timestamped Jarvis observations and actions updating in real-time
4. A visible kill switch on the dashboard disables all autonomous actions when toggled -- Jarvis still monitors and alerts but does not act
5. After 3 failed remediation attempts for the same issue, Jarvis stops trying and sends a diagnostic email to the operator

**Estimated Complexity**: HIGH -- The monitoring loop, runbook execution, and guardrail enforcement require careful design. Safety is paramount -- a bug in autonomous remediation can cause cascading failures.

**Research Flags**:
- RECOMMENDED: Autonomous remediation safety testing against the real cluster (test each runbook with induced failures)

**Pitfalls to address**:
- CRITICAL #1: Self-management -- quorum protection enforced in monitor (never act on >1 node simultaneously), protected resources enforced
- MINOR #12: MCP crash -- resilient tool execution in monitoring loop (individual tool failures must not crash the monitor)

**Risk callouts**:
- Autonomous actions on a live production cluster are inherently risky -- runbooks must be tested individually
- Rate limiting must prevent restart loops (VM crashes on start -> Jarvis retries indefinitely)
- The monitoring loop competes with user requests for Proxmox API and SSH resources

**Plans**: TBD

Plans:
- [ ] 04-01: Monitor service event loop with tiered polling and threshold detection
- [ ] 04-02: Remediation runbooks, guardrails (rate limiting, blast radius, escalation), kill switch
- [ ] 04-03: Activity feed panel, audit log persistence, email report integration

---

### Phase 5: Hybrid LLM Intelligence & Persistent Memory

**Goal**: Jarvis routes between Claude (complex reasoning) and local Qwen (fast routine ops) transparently, remembers operational history across sessions with tiered memory TTLs, tracks API costs, and manages context windows intelligently -- making the system both smarter and cheaper to operate.

**Depends on**: Phase 4 (operational data from audit log for memory, proven AI pipeline from Phase 3, monitoring patterns to route)

**Features addressed**:
- Hybrid LLM backend (Claude API for complex tasks, local Qwen for routine ops)
- Persistent memory system (cluster state, actions, preferences, history)

**Research-derived requirements**:
- REQ-ROUTER: Hybrid LLM router with confidence-based cascading (Qwen first for routine, Claude for complex)
- REQ-UNIFIED: Unified LLM provider abstraction via Vercel AI SDK (same interface for both models)
- REQ-QWEN: Qwen 2.5 7B integration via @ai-sdk/openai-compatible connected to llama-server at 192.168.1.50:8080
- REQ-FALLBACK: Graceful degradation chain (Claude -> retry -> Qwen -> error message with personality)
- REQ-COST: Cost tracking dashboard showing daily/weekly/monthly Claude API spend with budget caps
- REQ-MEMORY-TIERS: Tiered memory with TTLs (core facts: no expiry, operational state: overwritten on update, event log: 7-day TTL then summarize, conversations: session-scoped with summary persistence)
- REQ-CONTEXT-MGMT: Budget-aware context injection (calculate available tokens, inject memories by priority within budget)
- REQ-CONSOLIDATION: Daily memory consolidation pass (merge redundant entries, expire old observations, generate pattern summaries)
- REQ-PREFERENCE: Basic preference learning from operator interactions

**Success Criteria** (what must be TRUE):
1. User asks "How's the cluster?" and gets a fast response from local Qwen (~1 second); user asks "Why has pve been running hot this week?" and gets a detailed analysis from Claude -- the routing is transparent to the user
2. When internet is unavailable, Jarvis continues functioning via local Qwen for all operations with degraded but functional capability
3. Jarvis remembers actions taken in previous sessions -- asking "What did you fix yesterday?" returns accurate results from the persistent audit log
4. The dashboard shows Claude API cost tracking with daily spend visible, and budget caps prevent runaway costs
5. After a week of operation, Jarvis's memory does not bloat -- old events are summarized, stale observations are expired, and context injection stays within token budgets for both models

**Estimated Complexity**: HIGH -- Hybrid LLM routing and memory management are the most nuanced components. Qwen tool-calling reliability is uncertain and requires empirical testing.

**Research Flags**:
- RECOMMENDED: Qwen 2.5 7B tool-calling reliability -- empirical benchmarking before committing to production tool calls
- RECOMMENDED: Vercel AI SDK 5 `@ai-sdk/openai-compatible` provider configuration with llama-server
- NOTE: agent1 has 31GB RAM -- a 14B or 32B model could run there; evaluate during this phase

**Pitfalls to address**:
- MODERATE #5: Context inconsistency -- unified abstraction layer, route by task type not mid-conversation
- HIGH #6: Memory bloat -- tiered TTLs, selective injection, daily consolidation, budget-aware injection
- HIGH #11: Cost spiral -- Qwen-first routing, daily budget caps, request caching, token budget per request
- MEDIUM #13: Qwen quality collapse -- priority queuing, slot reservation, quality canary, model upgrade evaluation

**Risk callouts**:
- Qwen 2.5 7B Q4_K_M may be insufficient for reliable tool calling -- 14B model on agent1 is the fallback
- Personality consistency between Claude and Qwen requires per-model prompt tuning
- Memory consolidation is a background process that must not interfere with real-time operations
- Cost projections are usage-dependent -- monitor aggressively in the first week

**Plans**: TBD

Plans:
- [ ] 05-01: Unified LLM abstraction layer and Qwen integration via Vercel AI SDK
- [ ] 05-02: Hybrid router with confidence-based cascading, fallback chain, cost tracking
- [ ] 05-03: Persistent memory system with tiered TTLs, context management, and consolidation

---

## Feature-to-Phase Mapping

Every active requirement from PROJECT.md is mapped to exactly one phase.

| PROJECT.md Requirement | Phase | Requirement IDs |
|------------------------|-------|-----------------|
| MCP tool server exposing Proxmox API, system commands, Docker management | Phase 1 | REQ-MCP, REQ-PVE, REQ-SSH |
| Real-time data updates via WebSocket | Phase 1 (backend) + Phase 2 (frontend) | REQ-BACKEND, REQ-REALTIME |
| Persistent memory system (cluster state, actions, preferences, history) | Phase 1 (schema) + Phase 5 (intelligence) | REQ-MEMORY-SCHEMA, REQ-MEMORY-TIERS, REQ-CONSOLIDATION |
| eDEX-UI / Iron Man style dashboard with 3-column layout | Phase 2 | REQ-LAYOUT, REQ-EDEX, REQ-VISUAL-MODES |
| Live Proxmox cluster status (nodes, VMs, containers, resources) | Phase 2 | REQ-NODES, REQ-VMS, REQ-STORAGE, REQ-QUORUM |
| System terminal panel (eDEX-style command input) | Phase 2 | REQ-TERMINAL |
| Multi-device responsive (dedicated display, desktop, mobile) | Phase 2 | REQ-RESPONSIVE |
| Jarvis activity panel (status, feed, chat interface) | Phase 3 (chat) + Phase 4 (activity feed) | REQ-CHAT, REQ-ACTIVITY-FEED |
| JARVIS personality (Iron Man -- witty, formal, British butler humor) | Phase 3 | REQ-PERSONALITY |
| Hybrid LLM backend (Claude API for complex tasks, local Qwen for routine ops) | Phase 3 (Claude only) + Phase 5 (hybrid) | REQ-CLAUDE, REQ-ROUTER, REQ-QWEN |
| Autonomous monitoring and remediation (act + report) | Phase 4 | REQ-MONITOR, REQ-AUTONOMY, REQ-RUNBOOKS, REQ-GUARDRAILS |

**Coverage**: 11/11 active requirements mapped. No orphans.

---

## Phase Dependencies

```
Phase 1: Backend Foundation & Safety Layer
    |
    v
Phase 2: Real-Time Dashboard & eDEX-UI Visual Identity
    |
    v
Phase 3: AI Chat & Claude Integration
    |
    v
Phase 4: Autonomous Monitoring & Remediation
    |
    v
Phase 5: Hybrid LLM Intelligence & Persistent Memory
```

All phases are strictly sequential. Each phase depends on all prior phases.

**Dependency rationale**:
1. Phase 1 has zero dependencies but everything depends on it (MCP tools, memory store, safety framework)
2. Phase 2 needs Phase 1's backend API and WebSocket server to display live data
3. Phase 3 needs Phase 1's MCP tools for Claude to call and Phase 2's dashboard for the chat panel
4. Phase 4 needs Phase 3's proven AI pipeline and Phase 2's dashboard for the activity feed
5. Phase 5 needs Phase 4's operational audit log data and Phase 3's Claude pipeline to add Qwen alongside

---

## Research Flags Summary

| Phase | Research Needed? | Topics |
|-------|-----------------|--------|
| Phase 1 | RECOMMENDED | Proxmox API token creation, SSH key Docker mounting, Docker socket proxy vs SSH |
| Phase 2 | RECOMMENDED | Tailwind v4 `@theme` API, xterm.js WebGL + react-xtermjs integration |
| Phase 3 | SKIP | Claude tool use is extensively documented |
| Phase 4 | RECOMMENDED | Autonomous remediation safety testing against real cluster |
| Phase 5 | RECOMMENDED | Qwen 2.5 7B tool-calling reliability, Vercel AI SDK 5 provider config |

---

## Risk Summary

| Risk | Severity | Phase | Mitigation |
|------|----------|-------|------------|
| Jarvis kills its own infrastructure | CRITICAL | Phase 1 | Dependency DAG, protected resources, external watchdog |
| LLM executes destructive command | CRITICAL | Phase 1 | Tiered actions, allowlist, structured tool calls only |
| Prompt injection via cluster data | HIGH | Phase 1 | Data sanitization, `<cluster_data>` framing, output validation |
| WebSocket memory leaks (24/7 dashboard) | HIGH | Phase 2 | Bounded buffers, cleanup hooks, batch updates |
| Sci-fi UI destroying usability | HIGH | Phase 2 | Function-first design, GPU-composited only, 3 visual modes |
| Claude API cost spiral | HIGH | Phase 5 | Qwen-first routing, budget caps, request caching |
| Qwen tool-calling quality collapse | MEDIUM | Phase 5 | Quality canary, priority queuing, model upgrade path |
| Personality inconsistency between models | LOW | Phase 5 | Shared system prompt, per-model tuning |

---

## Progress

**Execution Order:** Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Backend Foundation & Safety Layer | 0/4 | Planned | - |
| 2. Real-Time Dashboard & eDEX-UI | 0/4 | Not started | - |
| 3. AI Chat & Claude Integration | 0/3 | Not started | - |
| 4. Autonomous Monitoring & Remediation | 0/3 | Not started | - |
| 5. Hybrid LLM Intelligence & Persistent Memory | 0/3 | Not started | - |

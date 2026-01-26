# Roadmap: Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard

## Overview

Jarvis 3.1 v1.1 transforms the working v1.0 prototype into a production-ready AI command center through four strategic enhancements: intelligent hybrid LLM routing (reducing API costs 60-85% while maintaining quality), persistent memory with tiered TTLs (enabling cross-session context and cluster state recall), full-stack Docker deployment (packaging the complete application for the management VM), and comprehensive E2E testing infrastructure (validating the deployed system against the live Proxmox cluster).

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped 2026-01-26)
- 🚧 **v1.1 Hybrid Intelligence & Deployment** - Phases 7-10 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-6) - SHIPPED 2026-01-26</summary>

### Phase 1: Foundation & Safety Framework
**Goal**: Establish secure Express 5 backend with 4-tier safety system and MCP tool protocol
**Status**: Complete

### Phase 2: Database & Persistence
**Goal**: SQLite + Drizzle ORM with conversations, events, and cluster state tables
**Status**: Complete

### Phase 3: Core AI Integration
**Goal**: Claude API with tool calling and agentic loop, autonomous action framework
**Status**: Complete

### Phase 4: Real-time Communication
**Goal**: Socket.IO namespaces for chat, monitoring, and system updates
**Status**: Complete

### Phase 5: Dashboard UI (deferred content merged into Phase 6)
**Status**: Deferred to v1.1

### Phase 6: eDEX-UI Dashboard & Autonomous Monitoring
**Goal**: Iron Man JARVIS-inspired 3-column dashboard with autonomous monitoring, runbooks, and kill switch
**Status**: Complete

</details>

### 🚧 v1.1 Hybrid Intelligence & Deployment (In Progress)

**Milestone Goal:** Add hybrid LLM intelligence (Claude + Qwen routing), persistent memory with tiered TTLs, Docker deployment to management VM, and end-to-end testing against live cluster.

#### Phase 7: Hybrid LLM Router + Cost Tracking
**Goal**: Intelligent routing between Claude API and local Qwen with cost tracking and provider abstraction
**Depends on**: Phase 6 (v1.0 complete)
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07, ROUTE-08, ROUTE-09, ROUTE-10
**Success Criteria** (what must be TRUE):
  1. User messages requiring tools automatically route to Claude, conversational messages route to Qwen
  2. When Claude API is unavailable, system automatically falls back to Qwen with visible notification
  3. Each chat message displays a provider badge showing whether Claude or Qwen generated the response
  4. Dashboard panel shows running cost totals (daily/weekly/monthly) updated in real-time after each Claude API call
  5. System prompt for Qwen is under 500 tokens (no tool instructions), Claude gets full 1500-token prompt with tool definitions
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md — LLMProvider interface + intent-based routing engine
- [ ] 07-02-PLAN.md — Cost tracking with token persistence and budget enforcement
- [ ] 07-03-PLAN.md — Provider badge UI + cost dashboard panel

#### Phase 8: Persistent Memory with TTL Tiers
**Goal**: Cross-session memory with three-tier TTL model enabling context recall and cluster state persistence
**Depends on**: Phase 7 (provider abstraction needed for context budgets)
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, MEM-07, MEM-08, MEM-09, MEM-10
**Success Criteria** (what must be TRUE):
  1. User can ask "What did we discuss yesterday about pve's disk?" and Jarvis retrieves relevant conversation history
  2. Jarvis remembers cluster events (e.g., "node agent was offline for 2 hours last Tuesday") without being told again
  3. User preferences ("I prefer email alerts for critical issues") persist across sessions and are respected in future interactions
  4. System prompt includes relevant historical context (recent events, facts, preferences) within token budget limits
  5. Database cleanup runs automatically every hour, expiring conversations after 7 days and episodic memories after 30 days
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

#### Phase 9: Docker Deployment Full Stack
**Goal**: Production-ready Docker Compose deployment to management VM with persistent volumes and security hardening
**Depends on**: Phase 8 (package complete, stable application)
**Requirements**: DOCK-01, DOCK-02, DOCK-03, DOCK-04, DOCK-05, DOCK-06, DOCK-07, DOCK-08, DOCK-09, DOCK-10, DOCK-11
**Success Criteria** (what must be TRUE):
  1. Running `docker compose up -d` brings up both frontend and backend services with WebSocket support working
  2. SQLite database, conversation history, and preferences survive container restarts (data persists in named volume)
  3. Backend container can SSH to all 4 cluster nodes using mounted keys without SSH keys embedded in Docker image layers
  4. Running `ssh root@192.168.1.65 'cd /opt/jarvis && docker compose up -d --build'` deploys the full stack from Home node
  5. Stopping containers via `docker compose down` triggers graceful shutdown (SQLite WAL checkpoint completes, no data loss)
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

#### Phase 10: E2E Testing Infrastructure
**Goal**: Comprehensive test coverage validating routing, safety, memory, and tool execution with mocked dependencies
**Depends on**: Phase 9 (tests run against deployed containers)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09, TEST-10, TEST-11, TEST-12
**Success Criteria** (what must be TRUE):
  1. Running `npm test` executes all unit and integration tests without requiring a live cluster, using mocked SSH/Proxmox/Claude APIs
  2. Safety framework tests verify all 4 tiers (GREEN auto-executes, YELLOW needs confirmation, RED needs confirmation, BLACK always blocked)
  3. Router tests verify intent-based routing (conversational→Qwen, cluster action→Claude, budget exceeded→Qwen)
  4. Memory tests verify TTL expiration (conversations 7d, episodic 30d, semantic permanent)
  5. E2E tests run against deployed containers on management VM, validating WebSocket chat, dashboard updates, and autonomous monitoring
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD

---

## Requirements Mapping

**Phase 7 (Hybrid LLM Router + Cost Tracking):** ROUTE-01 through ROUTE-10
**Phase 8 (Persistent Memory):** MEM-01 through MEM-10
**Phase 9 (Docker Deployment):** DOCK-01 through DOCK-11
**Phase 10 (E2E Testing):** TEST-01 through TEST-12

Total requirements: 43 (10 + 10 + 11 + 12)

---

## Definition of Done

**Phase-level DoD:**
- All plans executed and committed
- All requirements addressed with working implementation
- Success criteria verified (manual testing or automated checks)
- No regressions in existing functionality
- Phase SUMMARY.md created documenting what was built

**Milestone-level DoD (v1.1):**
- All 4 phases complete (7-10)
- Full-stack deployment to management VM successful
- E2E test suite passing
- Cost tracking validates 60-85% savings hypothesis
- Memory system enables cross-session context recall
- Production-ready Docker images pushed to registry (if applicable)

---

## Technical Debt

1. **Manual Proxmox token creation** - API tokens must be created on each PVE node before deployment (can't be automated via Proxmox API)
2. **SQLite WAL cleanup** - Requires proper SIGTERM handler in Docker for graceful shutdown
3. **Context window overflow** - Qwen 4096 token limit requires aggressive history pruning
4. **SSH key management** - Keys must be volume-mounted, not baked into images

---

## Future Enhancements (Post-v1.1)

- **Phase 11**: Claude Multimodal Support (analyze cluster metrics visually, screenshot-based diagnostics)
- **Phase 12**: Natural Language Runbook Creation (user describes remediation → Jarvis generates YAML runbook)
- **Phase 13**: Predictive Monitoring (ML-based anomaly detection using historical cluster data)
- **Phase 14**: Mobile Dashboard (React Native app with push notifications for critical alerts)

---

Last updated: 2026-01-26

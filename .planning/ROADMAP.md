# Roadmap: Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard

## Overview

Jarvis 3.1 v1.1 transforms the working v1.0 prototype into a production-ready AI command center through four strategic enhancements: intelligent hybrid LLM routing (reducing API costs 60-85% while maintaining quality), persistent memory with tiered TTLs (enabling cross-session context and cluster state recall), full-stack Docker deployment (packaging the complete application for the management VM), and comprehensive E2E testing infrastructure (validating the deployed system against the live Proxmox cluster).

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped 2026-01-26)
- ✅ **v1.1 Hybrid Intelligence & Deployment** - Phases 7-10 (shipped 2026-01-26)
- ✅ **v1.2 JARVIS Voice & Personality** - Phase 11 (shipped 2026-01-26)

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

### ✅ v1.1 Hybrid Intelligence & Deployment (Shipped 2026-01-26)

**Milestone Goal:** Add hybrid LLM intelligence (Claude + Qwen routing), persistent memory with tiered TTLs, Docker deployment to management VM, and end-to-end testing against live cluster.

#### ✅ Phase 7: Hybrid LLM Router + Cost Tracking
**Goal**: Intelligent routing between Claude API and local Qwen with cost tracking and provider abstraction
**Depends on**: Phase 6 (v1.0 complete)
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07, ROUTE-08, ROUTE-09, ROUTE-10
**Status**: Complete (3 commits: 464b01c, 767771a, ab30877)

Plans:
- [x] 07-01-PLAN.md — LLMProvider interface + intent-based routing engine
- [x] 07-02-PLAN.md — Cost tracking with token persistence and budget enforcement
- [x] 07-03-PLAN.md — Provider badge UI + cost dashboard panel

#### ✅ Phase 8: Persistent Memory with TTL Tiers
**Goal**: Cross-session memory with three-tier TTL model enabling context recall and cluster state persistence
**Depends on**: Phase 7 (provider abstraction needed for context budgets)
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, MEM-07, MEM-08, MEM-09, MEM-10
**Status**: Complete (3 commits: 0ad63bd, 8fa6566, c1d6536)

Plans:
- [x] 08-01-PLAN.md — Memory schema, TTL tiers & cleanup service
- [x] 08-02-PLAN.md — Memory extraction & context injection
- [x] 08-03-PLAN.md — Memory recall API & chat integration

#### ✅ Phase 9: Docker Deployment Full Stack
**Goal**: Production-ready Docker Compose deployment to management VM with persistent volumes and security hardening
**Depends on**: Phase 8 (package complete, stable application)
**Requirements**: DOCK-01, DOCK-02, DOCK-03, DOCK-04, DOCK-05, DOCK-06, DOCK-07, DOCK-08, DOCK-09, DOCK-10, DOCK-11
**Status**: Complete (commit: f8cd5ff)

Plans:
- [x] 09-01-PLAN.md — Docker Compose full stack with nginx reverse proxy & WebSocket support
- [x] 09-02-PLAN.md — Deploy script, .env.example & .dockerignore

#### ✅ Phase 10: E2E Testing Infrastructure
**Goal**: Comprehensive test coverage validating routing, safety, memory, and tool execution with mocked dependencies
**Depends on**: Phase 9 (tests run against deployed containers)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09, TEST-10, TEST-11, TEST-12
**Status**: Complete (commit: affbaeb — 64 unit tests, 5 test files)

Plans:
- [x] 10-01-PLAN.md — Vitest config, router tests (18), safety tests (21), cost tracker tests (6)
- [x] 10-02-PLAN.md — Memory extractor tests (9), memory recall tests (10)

### ✅ v1.2 JARVIS Voice & Personality (Shipped 2026-01-26)

**Milestone Goal:** Give Jarvis a voice. Text-to-speech output with a JARVIS (Iron Man) personality — British, formal, witty, confident. Optional voice input via speech-to-text. Audio visualization in the HUD. The AI assistant should *sound* like a real JARVIS, not a generic TTS robot.

#### ✅ Phase 11: JARVIS Voice Engine
**Goal**: Text-to-speech and speech-to-text integration giving Jarvis an Iron Man JARVIS voice with full personality
**Depends on**: Phase 10 (v1.1 complete, stable deployed system)
**Requirements**: VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06, VOICE-07, VOICE-08, VOICE-09, VOICE-10, VOICE-11, VOICE-12
**Status**: Complete (4 commits: 0271364, f4669ea, a83e8b5, 9ac79b2)

Plans:
- [x] 11-01-PLAN.md — TTS backend endpoint (OpenAI TTS API) + voice store
- [x] 11-02-PLAN.md — Frontend audio playback, auto-play & audio visualizer
- [x] 11-03-PLAN.md — Speech-to-text input with mic button & wake word
- [x] 11-04-PLAN.md — Voice settings panel + voice-aware personality tuning

---

## Requirements Mapping

**Phase 7 (Hybrid LLM Router + Cost Tracking):** ROUTE-01 through ROUTE-10
**Phase 8 (Persistent Memory):** MEM-01 through MEM-10
**Phase 9 (Docker Deployment):** DOCK-01 through DOCK-11
**Phase 10 (E2E Testing):** TEST-01 through TEST-12
**Phase 11 (JARVIS Voice):** VOICE-01 through VOICE-12

Total requirements: 55 (10 + 10 + 11 + 12 + 12)

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
2. ~~**SQLite WAL cleanup**~~ (RESOLVED: Phase 9 — STOPSIGNAL SIGTERM + stop_grace_period 15s in Docker Compose)
3. **Context window overflow** - Qwen 4096 token limit requires aggressive history pruning
4. ~~**SSH key management**~~ (RESOLVED: Phase 9 — keys volume-mounted via docker-compose.yml, not baked into images)

---

## Future Enhancements (Post-v1.2)

- **Phase 12**: Claude Multimodal Support (analyze cluster metrics visually, screenshot-based diagnostics)
- **Phase 13**: Natural Language Runbook Creation (user describes remediation → Jarvis generates YAML runbook)
- **Phase 14**: Predictive Monitoring (ML-based anomaly detection using historical cluster data)
- **Phase 15**: Mobile Dashboard (React Native app with push notifications for critical alerts)

---

Last updated: 2026-01-26

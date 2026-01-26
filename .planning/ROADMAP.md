# Roadmap: Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard

## Overview

Jarvis 3.1 v1.1 transforms the working v1.0 prototype into a production-ready AI command center through four strategic enhancements: intelligent hybrid LLM routing (reducing API costs 60-85% while maintaining quality), persistent memory with tiered TTLs (enabling cross-session context and cluster state recall), full-stack Docker deployment (packaging the complete application for the management VM), and comprehensive E2E testing infrastructure (validating the deployed system against the live Proxmox cluster).

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped 2026-01-26)
- 🚧 **v1.1 Hybrid Intelligence & Deployment** - Phases 7-10 (in progress)
- 📋 **v1.2 JARVIS Voice & Personality** - Phase 11 (planned)

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

#### ✅ Phase 7: Hybrid LLM Router + Cost Tracking
**Goal**: Intelligent routing between Claude API and local Qwen with cost tracking and provider abstraction
**Depends on**: Phase 6 (v1.0 complete)
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07, ROUTE-08, ROUTE-09, ROUTE-10
**Status**: Complete (3 commits: 464b01c, 767771a, ab30877)

Plans:
- [x] 07-01-PLAN.md — LLMProvider interface + intent-based routing engine
- [x] 07-02-PLAN.md — Cost tracking with token persistence and budget enforcement
- [x] 07-03-PLAN.md — Provider badge UI + cost dashboard panel

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
**Plans**: 3 plans

Plans:
- [ ] 08-01-PLAN.md — Memory schema, TTL tiers & cleanup service
- [ ] 08-02-PLAN.md — Memory extraction & context injection
- [ ] 08-03-PLAN.md — Memory recall API & chat integration

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

### 📋 v1.2 JARVIS Voice & Personality (Planned)

**Milestone Goal:** Give Jarvis a voice. Text-to-speech output with a JARVIS (Iron Man) personality — British, formal, witty, confident. Optional voice input via speech-to-text. Audio visualization in the HUD. The AI assistant should *sound* like a real JARVIS, not a generic TTS robot.

#### Phase 11: JARVIS Voice Engine
**Goal**: Text-to-speech and speech-to-text integration giving Jarvis an Iron Man JARVIS voice with full personality
**Depends on**: Phase 10 (v1.1 complete, stable deployed system)
**Requirements**: VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06, VOICE-07, VOICE-08, VOICE-09, VOICE-10, VOICE-11, VOICE-12
**Success Criteria** (what must be TRUE):
  1. Every Jarvis response can be played as audio with a British male voice that sounds like a refined AI butler (not robotic)
  2. User can toggle voice on/off — when enabled, responses auto-play; when disabled, text-only (existing behavior preserved)
  3. Audio visualizer in the HUD shows waveform/spectrum while Jarvis speaks, matching the Iron Man aesthetic
  4. User can speak to Jarvis via microphone — speech-to-text converts voice to chat input
  5. Jarvis personality is distinctly JARVIS: formal address ("sir"), dry wit, understated confidence, concise situational commentary
  6. Voice latency is under 2 seconds from response completion to audio playback start (streaming TTS if possible)
  7. TTS works with both Claude and Qwen responses (provider-agnostic)
  8. Voice settings (speed, pitch, volume, auto-play) persist in localStorage
  9. Wake-word detection ("JARVIS") optionally activates voice input without clicking
  10. Cost tracking extends to TTS API usage (if using cloud TTS like ElevenLabs)
**Plans**: TBD

Plans:
- [ ] 11-01: TBD — TTS provider integration (ElevenLabs / local Piper TTS / browser SpeechSynthesis)
- [ ] 11-02: TBD — Speech-to-text input (Web Speech API / Whisper local)
- [ ] 11-03: TBD — Audio visualizer HUD component + voice settings panel
- [ ] 11-04: TBD — JARVIS personality tuning (system prompt, voice characteristics, wake word)

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
2. **SQLite WAL cleanup** - Requires proper SIGTERM handler in Docker for graceful shutdown
3. **Context window overflow** - Qwen 4096 token limit requires aggressive history pruning
4. **SSH key management** - Keys must be volume-mounted, not baked into images

---

## Future Enhancements (Post-v1.2)

- **Phase 12**: Claude Multimodal Support (analyze cluster metrics visually, screenshot-based diagnostics)
- **Phase 13**: Natural Language Runbook Creation (user describes remediation → Jarvis generates YAML runbook)
- **Phase 14**: Predictive Monitoring (ML-based anomaly detection using historical cluster data)
- **Phase 15**: Mobile Dashboard (React Native app with push notifications for critical alerts)

---

Last updated: 2026-01-26

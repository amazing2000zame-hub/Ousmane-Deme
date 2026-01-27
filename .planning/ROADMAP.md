# Roadmap: Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard

## Overview

Jarvis 3.1 v1.1 transforms the working v1.0 prototype into a production-ready AI command center through four strategic enhancements: intelligent hybrid LLM routing (reducing API costs 60-85% while maintaining quality), persistent memory with tiered TTLs (enabling cross-session context and cluster state recall), full-stack Docker deployment (packaging the complete application for the management VM), and comprehensive E2E testing infrastructure (validating the deployed system against the live Proxmox cluster).

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped 2026-01-26)
- ✅ **v1.1 Hybrid Intelligence & Deployment** - Phases 7-10 (shipped 2026-01-26)
- ✅ **v1.2 JARVIS Voice & Personality** - Phase 11 (shipped 2026-01-26)
- ✅ **v1.3 File Operations & Project Intelligence** - Phases 12-15 (shipped 2026-01-27)
- ✅ **v1.4 Performance & Reliability** - Phases 16-20 (shipped 2026-01-27)

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

<details>
<summary>✅ v1.1 Hybrid Intelligence & Deployment (Phases 7-10) - SHIPPED 2026-01-26</summary>

**Milestone Goal:** Add hybrid LLM intelligence (Claude + Qwen routing), persistent memory with tiered TTLs, Docker deployment to management VM, and end-to-end testing against live cluster.

#### Phase 7: Hybrid LLM Router + Cost Tracking
**Goal**: Intelligent routing between Claude API and local Qwen with cost tracking and provider abstraction
**Depends on**: Phase 6 (v1.0 complete)
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07, ROUTE-08, ROUTE-09, ROUTE-10
**Status**: Complete (3 commits: 464b01c, 767771a, ab30877)

Plans:
- [x] 07-01-PLAN.md -- LLMProvider interface + intent-based routing engine
- [x] 07-02-PLAN.md -- Cost tracking with token persistence and budget enforcement
- [x] 07-03-PLAN.md -- Provider badge UI + cost dashboard panel

#### Phase 8: Persistent Memory with TTL Tiers
**Goal**: Cross-session memory with three-tier TTL model enabling context recall and cluster state persistence
**Depends on**: Phase 7 (provider abstraction needed for context budgets)
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, MEM-07, MEM-08, MEM-09, MEM-10
**Status**: Complete (3 commits: 0ad63bd, 8fa6566, c1d6536)

Plans:
- [x] 08-01-PLAN.md -- Memory schema, TTL tiers & cleanup service
- [x] 08-02-PLAN.md -- Memory extraction & context injection
- [x] 08-03-PLAN.md -- Memory recall API & chat integration

#### Phase 9: Docker Deployment Full Stack
**Goal**: Production-ready Docker Compose deployment to management VM with persistent volumes and security hardening
**Depends on**: Phase 8 (package complete, stable application)
**Requirements**: DOCK-01, DOCK-02, DOCK-03, DOCK-04, DOCK-05, DOCK-06, DOCK-07, DOCK-08, DOCK-09, DOCK-10, DOCK-11
**Status**: Complete (commit: f8cd5ff)

Plans:
- [x] 09-01-PLAN.md -- Docker Compose full stack with nginx reverse proxy & WebSocket support
- [x] 09-02-PLAN.md -- Deploy script, .env.example & .dockerignore

#### Phase 10: E2E Testing Infrastructure
**Goal**: Comprehensive test coverage validating routing, safety, memory, and tool execution with mocked dependencies
**Depends on**: Phase 9 (tests run against deployed containers)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09, TEST-10, TEST-11, TEST-12
**Status**: Complete (commit: affbaeb -- 64 unit tests, 5 test files)

Plans:
- [x] 10-01-PLAN.md -- Vitest config, router tests (18), safety tests (21), cost tracker tests (6)
- [x] 10-02-PLAN.md -- Memory extractor tests (9), memory recall tests (10)

</details>

<details>
<summary>✅ v1.2 JARVIS Voice & Personality (Phase 11) - SHIPPED 2026-01-26</summary>

**Milestone Goal:** Give Jarvis a voice. Text-to-speech output with a JARVIS (Iron Man) personality -- British, formal, witty, confident. Optional voice input via speech-to-text. Audio visualization in the HUD. The AI assistant should *sound* like a real JARVIS, not a generic TTS robot.

#### Phase 11: JARVIS Voice Engine
**Goal**: Text-to-speech and speech-to-text integration giving Jarvis an Iron Man JARVIS voice with full personality
**Depends on**: Phase 10 (v1.1 complete, stable deployed system)
**Requirements**: VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06, VOICE-07, VOICE-08, VOICE-09, VOICE-10, VOICE-11, VOICE-12
**Status**: Complete (4 commits: 0271364, f4669ea, a83e8b5, 9ac79b2)

Plans:
- [x] 11-01-PLAN.md -- TTS backend endpoint (OpenAI TTS API) + voice store
- [x] 11-02-PLAN.md -- Frontend audio playback, auto-play & audio visualizer
- [x] 11-03-PLAN.md -- Speech-to-text input with mic button & wake word
- [x] 11-04-PLAN.md -- Voice settings panel + voice-aware personality tuning

</details>

### ✅ v1.3 File Operations & Project Intelligence (Shipped 2026-01-27)

**Milestone Goal:** Give JARVIS the ability to interact with files and projects on the server -- importing/downloading files, reading and browsing project codebases, and analyzing projects to discuss improvements. Retrain the JARVIS voice with proper video sources for better quality.

#### Phase 12: File Operations Foundation
**Goal**: Users can ask JARVIS to download, transfer, and manage files across cluster nodes with safety guarantees against path traversal, SSRF, and disk exhaustion
**Depends on**: Phase 11 (v1.2 complete)
**Requirements**: FILE-01, FILE-02, FILE-03, FILE-04, FILE-05, FILE-06, FILE-07
**Status**: Complete (9 commits: 07139ca, dfa0497, efaa675, 239c12e, 016c3ec, 3d242ea, 4f2bca0, be9ab45, 90afb74)

Plans:
- [x] 12-01-PLAN.md -- Path sanitization infrastructure + URL/SSRF validation + disk space checks + context race fix
- [x] 12-02-PLAN.md -- File listing + file info MCP tools (GREEN tier, 2 tools)
- [x] 12-03-PLAN.md -- File download with SSRF protection + file copy + cross-node transfer (YELLOW tier, 3 tools)

#### Phase 13: Project Intelligence
**Goal**: Users can browse, read, and search across all 24 indexed projects on the cluster through natural language requests to JARVIS, with automatic blocking of sensitive files
**Depends on**: Phase 12 (path sanitization, file read infrastructure)
**Requirements**: PROJ-01, PROJ-02, PROJ-03, PROJ-05, PROJ-06
**Success Criteria** (what must be TRUE):
  1. User can ask JARVIS to list all projects on the cluster and see project names, locations, nodes, and tech stacks from the registry
  2. User can ask JARVIS to show the structure of any project and see a directory tree of its source files
  3. User can ask JARVIS to read any source file from a project and see its contents in chat
  4. User can ask JARVIS to search for a pattern (e.g., "find all TODO comments") across project files and see matching lines with file paths
  5. JARVIS blocks reads of .env files, private keys, credentials, and other sensitive files, returning a denial message instead of contents
**Status**: Complete

Plans:
- [x] 13-01-PLAN.md -- Registry client (SSH to agent1, 5-min cache, typed project access)
- [x] 13-02-PLAN.md -- Project browsing MCP tools (list, structure, read, search -- 4 GREEN tier tools)
- [x] 13-03-PLAN.md -- Secret blocking infrastructure (28 filenames, 13 patterns, 8 path segments)

#### Phase 14: Code Analysis & Discussion
**Goal**: Users can have JARVIS analyze project code and receive architecture overviews, quality assessments, and actionable improvement suggestions through natural chat conversation
**Depends on**: Phase 13 (project browsing and file reading)
**Requirements**: PROJ-04, PROJ-07
**Success Criteria** (what must be TRUE):
  1. User can ask JARVIS to analyze a project and receive a structured response covering architecture overview, code quality observations, and specific improvement suggestions
  2. User can have a multi-turn conversation about a project's code where JARVIS references actual file contents and provides contextual recommendations
  3. Analysis output includes actionable suggestions (not vague advice) tied to specific files or patterns found in the codebase
**Status**: Complete

Plans:
- [x] 14-01-PLAN.md -- analyze_project MCP tool (6-section context gathering, prompt injection defense)
- [x] 14-02-PLAN.md -- System prompt update for multi-turn project discussion guidance

#### Phase 15: Voice Retraining Pipeline
**Goal**: Users can provide JARVIS video source files and trigger an end-to-end pipeline that extracts clean audio, builds a training dataset, retrains the XTTS v2 model, and deploys the improved voice -- all orchestrated through chat
**Depends on**: Phase 12 (file download/transfer for source videos)
**Requirements**: VOICE-13, VOICE-14, VOICE-15, VOICE-16
**Success Criteria** (what must be TRUE):
  1. User can provide video files and JARVIS extracts clean JARVIS-only audio segments using ffmpeg, reporting extraction progress
  2. User can trigger dataset preparation and JARVIS produces LJSpeech-format training data (metadata.csv + wavs/) from extracted audio clips
  3. User can trigger voice model retraining and JARVIS runs XTTS v2 fine-tuning as a background process with progress monitoring via chat
  4. After retraining completes, JARVIS updates the TTS server to use the new model weights and the user hears the improved voice on the next spoken response
**Status**: Complete (4 MCP tools: extract_voice_audio, prepare_voice_dataset, retrain_voice_model, deploy_voice_model)

Plans:
- [x] 15-01: Audio extraction MCP tools (ffmpeg orchestration with resource limits)
- [x] 15-02: Dataset preparation + training pipeline (LJSpeech format, XTTS v2 fine-tuning, background process management)
- [x] 15-03: Model deployment + TTS server update + cache clear

---

### ✅ v1.4 Performance & Reliability (Shipped 2026-01-27)

**Milestone Goal:** Optimize Jarvis for real-time responsiveness and visual polish -- reduce voice latency from 15-30s to <4s via streaming sentence-by-sentence TTS, eliminate chat UI jank during streaming, cut duplicate Proxmox API calls by 50%+, fix dashboard render performance with granular updates, and unify theme/color consistency across all components.

**Measurable Targets:**

| Metric | Current | v1.4 Target |
|--------|---------|-------------|
| Voice first-audio latency | 15-30s | <4s |
| Chat state updates/sec during streaming | ~10 | ~2 |
| Proxmox API calls/min | ~30+ (duplicated) | ~15 (cached) |
| Temperature poll duration | 4-8s sequential | 1-2s parallel |
| NodeCard re-renders per poll | 4 (all) | 1 (changed only) |
| AudioVisualizer idle CPU | >0% (rAF loop) | 0% |
| System prompt build (cached) | ~1-2s | <10ms |
| Initial bundle savings | — | ~40KB gzipped |

#### Phase 16: Streaming Voice Pipeline
**Goal**: Reduce voice latency from 15-30s to <4s by streaming TTS sentence-by-sentence while the LLM is still generating
**Depends on**: Phase 15 (v1.3 complete)
**Requirements**: PERF-001, PERF-002, PERF-003, PERF-004, PERF-005, PERF-006
**Status**: Complete (SentenceAccumulator, synthesizeSentenceToBuffer, progressive-queue.ts, LRU cache)

Plans:
- [x] 16-01: Sentence-boundary text accumulator in chat handler
- [x] 16-02: Per-sentence TTS synthesis + Socket.IO audio delivery
- [x] 16-03: Frontend progressive audio queue (replace monolithic speak)
- [x] 16-04: XTTS sentence cache + TTS timeout fallback

#### Phase 17: Chat Rendering Performance
**Goal**: Eliminate UI jank during chat streaming by reducing renders from ~10/sec to ~2/sec
**Depends on**: None (independent of Phase 16)
**Requirements**: PERF-007, PERF-008, PERF-009, PERF-010
**Status**: Complete (streamingContent O(1) append, RAF token batching, React.memo ChatMessage, throttled scroll)

Plans:
- [x] 17-01: Separate streaming content from messages array (O(1) token append)
- [x] 17-02: RAF-batched token accumulation (batch 5-15 tokens per frame)
- [x] 17-03: React.memo ChatMessage + throttled auto-scroll

#### Phase 18: Backend Data Caching & API Efficiency
**Goal**: Reduce redundant Proxmox API calls by 50%+, cut Home node load
**Depends on**: None (independent of Phases 16-17)
**Requirements**: PERF-011, PERF-012, PERF-013, PERF-014, PERF-015, PERF-016
**Status**: Complete (Proxmox API cache, parallel temp polling, 30s system prompt cache, session history cache, batched memory writes, parallel VM+CT queries)

Plans:
- [x] 18-01: Shared Proxmox API cache (5-15s TTL per resource type)
- [x] 18-02: Parallel temperature polling (Promise.allSettled)
- [x] 18-03: Cache system prompt cluster summary (30s TTL)
- [x] 18-04: Cache session history + batch memory touch writes
- [x] 18-05: Parallel VM+CT queries in system prompt builder

#### Phase 19: Dashboard Rendering Performance
**Goal**: Fix choppy animations by eliminating unnecessary re-renders through granular store updates and component memoization
**Depends on**: None (independent, but 19-02 depends on 19-01 internally)
**Requirements**: PERF-017, PERF-018, PERF-019, PERF-020, PERF-021, PERF-022, PERF-023
**Status**: Complete (diff-based store, React.memo cards, SVG hoisting, AudioVisualizer 30fps/0% idle, lazy-load motion 40KB saved, prefers-reduced-motion, ResizeObserver cleanup)

Plans:
- [x] 19-01: Granular cluster store updates (diff-based, stable references)
- [x] 19-02: React.memo NodeCard + VMCard
- [x] 19-03: SVG filter hoisting + AudioVisualizer 30fps throttle
- [x] 19-04: Lazy-load motion library + prefers-reduced-motion support

#### Phase 20: Theme Consistency & Visual Polish
**Goal**: Fix color/theme mismatches and layout bugs for cohesive visual experience
**Depends on**: Phase 19 (all components stable before polishing)
**Requirements**: PERF-024, PERF-025, PERF-026, PERF-027
**Status**: Complete (CSS variable color tokens, overflow handling, standardized glow intensities via CSS vars, memoized EventRow)

Plans:
- [x] 20-01: Audit and unify color tokens (replace all hardcoded rgba/hex/tailwind colors)
- [x] 20-02: Fix layout bugs (QuorumIndicator overflow, z-index conflicts)
- [x] 20-03: Standardize glow intensities + memoize EventRow

**Phase Dependencies:**
```
Phase 16 (Voice) ← no deps, highest impact, do first
Phase 17 (Chat Rendering) ← independent, second highest impact
Phase 18 (Backend Caching) ← independent, reduces Home node load
Phase 19 (Dashboard Rendering) ← 19-02 (memo) depends on 19-01 (granular store)
Phase 20 (Theme/Polish) ← last, lowest urgency, all components stable
```

Phases 16, 17, 18, 19 are largely independent and could run in parallel if needed.

**Deferred to v1.5+:**
- GPU-accelerated TTS (needs hardware changes)
- WebSocket compression (unnecessary at LAN speeds)
- Full virtual scrolling library (only if conversations exceed 50+ messages)
- Runbook concurrency limiter (low priority for 4-node cluster)
- Worker thread TTS (streaming approach handles this)

---

## Requirements Mapping

**Phase 7 (Hybrid LLM Router + Cost Tracking):** ROUTE-01 through ROUTE-10
**Phase 8 (Persistent Memory):** MEM-01 through MEM-10
**Phase 9 (Docker Deployment):** DOCK-01 through DOCK-11
**Phase 10 (E2E Testing):** TEST-01 through TEST-12
**Phase 11 (JARVIS Voice):** VOICE-01 through VOICE-12
**Phase 12 (File Operations Foundation):** FILE-01, FILE-02, FILE-03, FILE-04, FILE-05, FILE-06, FILE-07
**Phase 13 (Project Intelligence):** PROJ-01, PROJ-02, PROJ-03, PROJ-05, PROJ-06
**Phase 14 (Code Analysis & Discussion):** PROJ-04, PROJ-07
**Phase 15 (Voice Retraining Pipeline):** VOICE-13, VOICE-14, VOICE-15, VOICE-16
**Phase 16 (Streaming Voice Pipeline):** PERF-001 through PERF-006
**Phase 17 (Chat Rendering Performance):** PERF-007 through PERF-010
**Phase 18 (Backend Data Caching):** PERF-011 through PERF-016
**Phase 19 (Dashboard Rendering Performance):** PERF-017 through PERF-023
**Phase 20 (Theme Consistency & Visual Polish):** PERF-024 through PERF-027

Total requirements: 100 (55 v1.0-v1.2 + 18 v1.3 + 27 v1.4)

---

## Definition of Done

**Phase-level DoD:**
- All plans executed and committed
- All requirements addressed with working implementation
- Success criteria verified (manual testing or automated checks)
- No regressions in existing functionality
- Phase SUMMARY.md created documenting what was built

**Milestone-level DoD (v1.3):**
- All 4 phases complete (12-15)
- File download/transfer works across all 4 cluster nodes
- Project browsing covers all 24 indexed projects
- Code analysis produces actionable, file-specific suggestions
- Voice retraining pipeline runs end-to-end from video to deployed model
- No regressions in existing v1.0-v1.2 functionality

---

## Technical Debt

1. **Manual Proxmox token creation** - API tokens must be created on each PVE node before deployment (can't be automated via Proxmox API)
2. ~~**SQLite WAL cleanup**~~ (RESOLVED: Phase 9 -- STOPSIGNAL SIGTERM + stop_grace_period 15s in Docker Compose)
3. **Context window overflow** - Qwen 4096 token limit requires aggressive history pruning
4. ~~**SSH key management**~~ (RESOLVED: Phase 9 -- keys volume-mounted via docker-compose.yml, not baked into images)
5. **Override context race condition** - Global mutable state in context.ts is a latent race condition with concurrent WebSocket clients (flagged by v1.3 research, addressed in Phase 12 Plan 01)
6. **Triple-registration validation** - New tools require changes in 3 files (handler, tier, Claude description) with no automated mismatch detection

---

## Progress

**Execution Order:**
Phases 12 through 15 execute sequentially. Phase 15 depends on Phase 12 (file download) but is independent of Phases 13-14.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-01-26 |
| 2. Database | v1.0 | 2/2 | Complete | 2026-01-26 |
| 3. AI Integration | v1.0 | 3/3 | Complete | 2026-01-26 |
| 4. Real-time Comms | v1.0 | 2/2 | Complete | 2026-01-26 |
| 6. Dashboard & Monitoring | v1.0 | 8/8 | Complete | 2026-01-26 |
| 7. Hybrid LLM Router | v1.1 | 3/3 | Complete | 2026-01-26 |
| 8. Persistent Memory | v1.1 | 3/3 | Complete | 2026-01-26 |
| 9. Docker Deployment | v1.1 | 2/2 | Complete | 2026-01-26 |
| 10. E2E Testing | v1.1 | 2/2 | Complete | 2026-01-26 |
| 11. JARVIS Voice | v1.2 | 4/4 | Complete | 2026-01-26 |
| 12. File Operations | v1.3 | 3/3 | Complete | 2026-01-27 |
| 13. Project Intelligence | v1.3 | 3/3 | Complete | 2026-01-27 |
| 14. Code Analysis | v1.3 | 2/2 | Complete | 2026-01-27 |
| 15. Voice Retraining | v1.3 | 0/3 | Not started | - |
| 16. Streaming Voice Pipeline | v1.4 | 0/4 | Not started | - |
| 17. Chat Rendering Performance | v1.4 | 0/3 | Not started | - |
| 18. Backend Data Caching | v1.4 | 0/5 | Not started | - |
| 19. Dashboard Rendering | v1.4 | 0/4 | Not started | - |
| 20. Theme Consistency | v1.4 | 0/3 | Not started | - |

---

Last updated: 2026-01-27 (v1.4 milestone planned -- Phases 16-20)

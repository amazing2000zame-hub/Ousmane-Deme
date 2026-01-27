# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Milestone v1.4 -- Performance & Reliability (Phases 16-20 planned)

## Current Position

Milestone: v1.4 Performance & Reliability
Phase: 16 of 20 (Streaming Voice Pipeline) -- NOT STARTED
Plan: 0 of 4
Status: Milestone planned, ready for Phase 16 execution
Last activity: 2026-01-27 -- Created v1.4 milestone with 5 phases, 27 requirements, 19 plans

Progress: [░░░░░░░░░░░░░░░░░░░░] 0% v1.4 (v1.0-v1.2 complete, v1.3 Phases 12-14 shipped, Phase 15 pending)

## Performance Metrics

**Velocity (from v1.0-v1.3):**
- Total plans completed: 39
- Average duration: 4.9 min
- Phases shipped: 14
- v1.4 planned: 19 plans across 5 phases

## Accumulated Context

### Key Decisions (v1.4)

- Streaming voice pipeline targets <4s first-audio (vs current 15-30s)
- Sentence boundaries detected during LLM streaming, TTS per-sentence
- Audio delivered as Socket.IO binary events (not WebRTC)
- Chat token appending redesigned to O(1) with separate streaming content state
- requestAnimationFrame batching for token accumulation (~2 updates/sec)
- Shared Proxmox API cache with TTL (5s nodes, 15s storage)
- Temperature polling parallelized with Promise.allSettled
- System prompt cluster summary cached 30s between messages
- Session history cached in-memory per socket (not re-read from DB)
- Memory access tracking batched into single SQLite transaction
- Granular cluster store updates (diff-based, stable references)
- React.memo for NodeCard, VMCard, ChatMessage, EventRow
- SVG filters hoisted outside render (static, created once)
- AudioVisualizer: 30fps during playback, 0fps when idle
- Motion library lazy-loaded (saves ~40KB gzipped)
- prefers-reduced-motion support for accessibility
- All hardcoded colors replaced with theme tokens
- Glow effects standardized to sm/md/lg intensity tokens
- 27 requirements (PERF-001 through PERF-027)
- 3 future requirements deferred to v1.5+ (GPU TTS, WebSocket compression, virtual scrolling)

### Key Decisions (v1.3 - carried forward)

- File operations use SSH to remote nodes (not file agents on each node)
- Project intelligence queries existing registry on agent1 (not a new index)
- Code analysis uses Claude via existing agentic loop (not AST parsing)
- Voice training orchestrates existing TTS container scripts via docker exec
- Zero new npm dependencies -- Node.js 22 built-ins handle all requirements
- AsyncLocalStorage with module-level fallback for backward-compatible override context
- Safety audit logs use existing events table (type: action, severity: warning)
- URL validation resolves DNS before checking IP to catch hostname-based SSRF
- Protected path matching: trailing slash = directory subtree, no slash = exact file
- Secret blocking: 28 filenames + 13 patterns + 8 path segments
- Total MCP tools: 28 (23 existing + 4 project + 1 analysis tool)
- analyze_project gathers 6 context sections with prompt injection defense

Previous milestones:
- v1.0 MVP (Phases 1-6): Full dashboard + AI + monitoring + safety
- v1.1 Hybrid Intelligence (Phases 7-10): Hybrid LLM, memory, Docker, testing
- v1.2 JARVIS Voice (Phase 11): TTS/STT with XTTS v2, ElevenLabs, OpenAI
- v1.3 File Ops & Intelligence (Phases 12-14): File ops, project tools, code analysis (Phase 15 pending)

### Pending Todos

- Voice quality poor with current XTTS v2 training -- Phase 15 will retrain with proper sources
- Voice latency 15-30s -- Phase 16 will reduce to <4s via streaming pipeline
- Chat UI jank during streaming -- Phase 17 will fix with O(1) append + RAF batching
- Duplicate Proxmox API calls -- Phase 18 will add shared cache layer
- Dashboard unnecessary re-renders -- Phase 19 will add granular updates + memoization
- Hardcoded colors bypass theme tokens -- Phase 20 will unify

### Blockers/Concerns

- Voice training quality depends on quality of source videos user provides (Phase 15)
- XTTS local inference speed (~8-15s for full text) is the voice latency bottleneck -- streaming per-sentence is the mitigation
- React.memo effectiveness depends on stable object references from stores (Phase 19-01 must precede 19-02)

## Session Continuity

Last session: 2026-01-27
Stopped at: Created v1.4 Performance & Reliability milestone -- 5 phases, 27 requirements, 19 plans
Resume file: None

**Next steps:**
1. Begin Phase 16 (Streaming Voice Pipeline) planning or execution
2. Phase 16-01: Sentence-boundary text accumulator in chat handler
3. Alternatively, complete Phase 15 (Voice Retraining) first if source videos are available

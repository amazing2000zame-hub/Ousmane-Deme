# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Milestone v1.5 -- Optimization & Latency Reduction

## Current Position

Milestone: v1.5 Optimization & Latency Reduction
Phase: 21 -- Quick Wins & Measurement Baseline
Plan: --
Status: Roadmap complete, ready for phase planning
Last activity: 2026-01-27 -- v1.5 roadmap created (Phases 21-25)

Progress: [░░░░░░░░░░░░░░░░░░░░] 0% v1.5 (0/5 phases)

## Performance Metrics

**Velocity (from v1.0-v1.4):**
- Total plans completed: 39
- Average duration: 4.9 min
- Phases shipped: 20
- Milestones shipped: 5 (v1.0, v1.1, v1.2, v1.3, v1.4)

## Accumulated Context

### Key Decisions (v1.5)

- Piper TTS deployed as fast fallback alongside XTTS (3-second timeout triggers Piper)
- Phase 4 items (GPU TTS, distributed architecture, VLAN, ML router) deferred to v1.6+
- Optimization guide from /root/PNfj.docx is primary source document
- Focus: 5 phases (Quick Wins, TTS Fallback, Parallel+Opus, Observability+Context, Chat Virtualization)
- Zero new npm backend dependencies; one new Docker container (Piper TTS)
- XTTS v2 cannot parallelize (batch_size=1 "wontfix") -- CPU affinity is highest-impact optimization
- Opus encoding optional/configurable -- adds latency on LAN, only useful for remote access
- Web Worker audio decoding DEFERRED (AudioContext not available in Workers)
- @tanstack/react-virtual chosen over react-window for chat virtualization
- Never mix TTS engines within a single response (voice consistency enforcement)
- Bounded to max 2 concurrent TTS workers to avoid CPU starvation of LLM
- Conversation summarization must preserve structured context (VMIDs, IPs, paths)

### Key Decisions (v1.4 - carried forward)

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

### Key Decisions (v1.3 - carried forward)

- File operations use SSH to remote nodes (not file agents on each node)
- Project intelligence queries existing registry on agent1 (not a new index)
- Code analysis uses Claude via existing agentic loop (not AST parsing)
- Voice training orchestrates existing TTS container scripts via docker exec
- Zero new npm dependencies -- Node.js 22 built-ins handle all requirements
- Voice retrained with 64 clips from 3 YouTube/video sources (vs 10 poor clips before)
- Fine-tuned GPT decoder: 441M params, 6 epochs, 384 steps, loss 6.95->5.1
- Speaker embedding recomputed with fine-tuned conditioning encoder

Previous milestones:
- v1.0 MVP (Phases 1-6): Full dashboard + AI + monitoring + safety
- v1.1 Hybrid Intelligence (Phases 7-10): Hybrid LLM, memory, Docker, testing
- v1.2 JARVIS Voice (Phase 11): TTS/STT with XTTS v2, ElevenLabs, OpenAI
- v1.3 File Ops & Intelligence (Phases 12-15): File ops, project tools, code analysis, voice retraining
- v1.4 Performance & Reliability (Phases 16-20): Streaming voice, chat rendering, backend caching, dashboard perf, theme polish

### Pending Todos

- Voice latency still 15-30s -- v1.5 Quick Wins + TTS overhaul will address
- TTS reliability ~70% -- Piper fallback (Phase 22) will push to 99%+
- No conversation windowing -- context grows unbounded, slowing LLM (Phase 24)
- No latency tracing -- can't identify bottlenecks precisely (Phase 24)
- Health endpoint is liveness-only -- no component-level status (Phase 21)

### Blockers/Concerns

- Home node disk usage should stay under 80% (currently ~52%)
- Piper TTS Docker image adds ~500MB to deployment footprint
- Opus codec requires browser support (all modern browsers support it, Safari has edge cases)
- CPU contention risk: 20 threads shared between llama-server (16), XTTS (14 Docker limit), Proxmox
- Qwen tokenizer endpoint availability unclear for accurate token counting

## Session Continuity

Last session: 2026-01-27
Stopped at: v1.5 roadmap created -- ready for Phase 21 planning
Resume file: None

**Next steps:**
1. Plan Phase 21 (Quick Wins & Measurement Baseline)
2. Execute Phase 21 plans
3. Continue through Phases 22-25

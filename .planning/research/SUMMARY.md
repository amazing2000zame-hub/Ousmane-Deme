# Project Research Summary

**Project:** Jarvis v1.5 - Optimization & Latency Reduction
**Domain:** AI voice assistant performance optimization (self-hosted, CPU inference)
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

Jarvis v1.5 targets reducing first-audio latency from 15-30s to 2-4s with 99%+ reliability. Research reveals that the primary bottleneck is CPU-bound TTS synthesis (XTTS v2 takes 3-10s per sentence on CPU) compounded by serial processing. The system runs on shared CPU resources (20 threads split between LLM inference, TTS, Docker, and Proxmox cluster operations), making naive parallelization counterproductive.

The recommended approach combines four high-impact optimizations: (1) **Piper TTS fallback** for <200ms synthesis when XTTS is slow, (2) **bounded parallel TTS** (max 2 concurrent) with CPU affinity separation, (3) **Opus audio codec** to reduce transfer/decode overhead 8-10x, and (4) **disk-persistent TTS cache** with startup pre-warming. Supporting features include latency tracing for measurement, enhanced health checks for reliability, and conversation sliding window for better Qwen context management.

Key risks center on CPU contention (parallel TTS starving LLM), voice consistency (XTTS vs Piper sound drastically different), and browser compatibility (Safari Opus support is inconsistent). The system's single-user homelab context eliminates multi-tenancy concerns but introduces unique constraints: optimization decisions can monopolize resources, and some "standard" optimizations (like Opus encoding) may hurt performance on a local gigabit network where bandwidth is not the bottleneck.

## Key Findings

### Recommended Stack

**NEW: v1.5 adds only ONE new dependency stack-wide** — the Piper TTS container. Everything else uses Node.js 22 built-ins (`child_process.spawn` for FFmpeg, `performance.now()` for tracing, `fetch()` for health checks) or extends existing components. This is a "surgical strike" optimization that fits within the established architecture.

**Core additions:**
- **Piper TTS (Docker)**: Fast CPU fallback TTS (~100-200ms per sentence vs 3-10s XTTS) — Uses official `rhasspy/wyoming-piper` image with `en_US-lessac-medium` voice model
- **FFmpeg (in backend container)**: WAV-to-Opus encoding via `child_process.spawn` — Already on host, just needs adding to Docker image
- **@tanstack/react-virtual (optional frontend)**: Chat history virtualization — Only if UI performance phase included, not critical for latency goals

**What NOT to add:**
- `@discordjs/opus` or native Opus bindings (FFmpeg handles encoding without node-gyp compilation)
- OpenTelemetry / distributed tracing (lightweight `performance.now()` timestamps sufficient)
- `react-window` (inferior dynamic height support vs @tanstack/react-virtual)
- Web Worker audio decoding libraries (AudioContext unavailable in Workers, native `decodeAudioData` fast enough with Opus)

**Existing stack validated and unchanged:**
- Express 5 + Socket.IO 4 (backend realtime)
- React 19 + Vite 6 (frontend build)
- XTTS v2 in Docker (primary TTS, custom JARVIS voice)
- better-sqlite3 + Drizzle ORM (WAL mode already enabled, needs additional PRAGMAs)
- Progressive audio queue with Web Audio API (handles out-of-order chunks natively via index sorting)

### Expected Features

**Must have (table stakes):**
- **TTS fallback system** — 99%+ reliability requires backup when XTTS is slow/unhealthy. Browser SpeechSynthesis always available as last resort.
- **Per-sentence timeout with fallback trigger** — Current 20s timeout skips audio on failure; should trigger Piper instead.
- **Health-aware routing** — Don't attempt XTTS synthesis if health check failed recently.
- **Token-aware message truncation** — Current 20-message limit doesn't account for message length; Qwen's 4096 context needs token counting.
- **Per-request timing breakdown** — Essential for validating optimizations aren't placebo.

**Should have (competitive differentiators):**
- **Automatic fallback recovery detection** — When XTTS recovers, switch back seamlessly.
- **CPU affinity separation** — Pin llama-server and XTTS to separate core sets to eliminate contention (single biggest performance win available).
- **Speculative next-sentence synthesis** — Already works via existing serial queue; verify and optimize.
- **Disk-persistent TTS cache** — Current cache is in-memory only; container restart loses all entries.
- **Optional Opus encoding** — Config flag for remote access via VPN; default to WAV on LAN.
- **Parallel TTS with bounded concurrency** — Max 2 concurrent on this hardware; prevents CPU saturation.

**Defer (v2+):**
- **List virtualization** — Only impactful at 100+ messages in session; lower priority than latency.
- **Web Worker audio decoding** — Opus encoding reduces buffer sizes 8-10x; main thread decode likely fast enough.
- **ElevenLabs cloud fallback** — Optional; only if user has API key and wants cloud backup.
- **Summary persistence across sessions** — Nice-to-have for session resume; not critical for v1.5 latency goals.

**Anti-features (explicitly avoid):**
- Multiple XTTS worker instances (XTTS v2 batch_size=1 constraint; concurrent requests cause errors)
- Voice cloning on fallback (accept voice change on fallback rather than adding complexity)
- RAG-based context retrieval (overkill for single-user homelab)
- Always-on Opus encoding (adds 10-50ms latency with zero benefit on gigabit LAN)

### Architecture Approach

The existing architecture is a **modular monolith** with clear component boundaries: frontend (React + Zustand stores) communicates via Socket.IO with backend (Express + realtime handlers), which orchestrates LLM providers, TTS synthesis, SQLite persistence, and Proxmox API. All v1.5 changes fit within this pattern — no architectural rewrites needed.

**Major components:**
1. **TTS Router (extends tts.ts)** — Timeout-based fallback: try XTTS (8s timeout), fall back to Piper (3s timeout), return null if both fail. Include engine ID in cache keys to prevent serving cached audio from wrong engine.
2. **Parallel TTS Queue (replaces serial drainTtsQueue in chat.ts)** — Bounded worker pool with max 2 concurrent synthesis requests. Frontend already handles out-of-order arrival via index-based sorting; no frontend changes needed.
3. **Opus Encoder (new opus-encoder.ts module)** — Spawns FFmpeg subprocess for WAV-to-Opus transcoding after TTS synthesis, before Socket.IO emit and caching. Encoding adds ~10-50ms per sentence but reduces transfer size 8-10x.
4. **Conversation Window Manager (new conversation-window.ts)** — Background summarization via Qwen when history exceeds threshold. Summary stored in existing `memories` table with tier='conversation', injected at history load time.
5. **Latency Trace Collector (new latency-trace.ts)** — Lightweight timestamp collection at pipeline stages using `performance.now()`. No OpenTelemetry; just structured JSON logs + single Socket.IO event per response.

**Data flow changes:**
- **Current (serial)**: Sentence detected → queue → synthesize → emit → next sentence
- **New (parallel)**: Sentence detected → queue → 2 workers pull concurrently → synthesize → encode Opus → emit out-of-order → frontend sorts by index → plays sequentially

**Integration points:**
- Piper container communicates with backend via internal Docker network (HTTP on port 5000)
- FFmpeg installed in backend container, invoked via `child_process.spawn` with pipe-based I/O
- Health endpoint expands from trivial liveness to component health aggregation (TTS, LLM, Proxmox, DB)
- Cache pre-warming triggers via `setTimeout()` after `server.listen()`, non-blocking

**Files to modify:** 10 (docker-compose.yml, backend Dockerfile, config.ts, tts.ts, chat.ts, health.ts, index.ts, db/index.ts, useChatSocket.ts, progressive-queue.ts)
**Files to create:** 4 (opus-encoder.ts, tts-prewarm.ts, conversation-window.ts, latency-trace.ts)
**Files unchanged:** 9 (all provider files, schema.ts, memories.ts, socket.ts, stores, useVoice.ts)

### Critical Pitfalls

1. **TTS Fallback Voice Mismatch Creates Jarring User Experience** — XTTS produces custom-cloned JARVIS voice; Piper uses pre-trained VITS models with different prosody/accent. Mid-response voice change is worse than silence. **Prevention:** Never mix engines within a single response. If XTTS fails on sentence 1, use Piper for ALL subsequent sentences in that response. Set fallback timeout high (use health check failure as trigger, not timeout).

2. **Parallel TTS Overwhelms CPU and Starves LLM Inference** — The Home node has 20 threads shared between llama-server (16 threads), XTTS (up to 14 CPUs in Docker), and Proxmox cluster services. Running 3+ concurrent TTS requests will slow both TTS and LLM dramatically. XTTS v2 has known issues with concurrent requests. **Prevention:** Limit to 2 concurrent maximum. Use CPU affinity or cgroup limits to prevent TTS from starving LLM. Profile before committing to any parallelism level.

3. **Opus Codec Breaks Safari Audio Playback** — Safari has extensive WebKit bugs with Opus decoding (bugs #226922, #238546, #245428). Opus-in-WebM inconsistent across browsers. **Prevention:** Keep WAV as primary format for `decodeAudioData()`. Use Opus only for transfer encoding if bandwidth is bottleneck (it's not on local gigabit network). On a single-user homelab, test Opus on your specific device before deploying.

4. **Conversation Sliding Window Silently Drops Critical Context** — LLM summarization is lossy. Technical context (VMIDs, IPs, file paths, exact error messages) poorly preserved. The system routes between Claude (agentic with tools) and Qwen (conversational) — tool call context especially at risk. **Prevention:** Separate structured context from conversational context. Extract key entities rather than generating free-form summaries. Validate that tool call identifiers survive summarization.

5. **Audio Chunk Race Conditions When Adding Parallel Synthesis** — Current system assigns chunk indices deterministically but assumes serial delivery. With parallel synthesis, chunks arrive out-of-order. Frontend sorts by index but playback logic just plays first item in queue — if chunk 3 arrives before chunk 2, it may play first. **Prevention:** Track expected next index. Only play if `queue[0].index === nextExpectedIndex`. Add timeout for missing chunks (skip and advance). Emit `audio_skip` event for failed synthesis so frontend can advance index.

## Implications for Roadmap

Based on research, suggested 7-phase structure optimized for dependency ordering and impact-to-effort ratio:

### Phase 1: Foundation - Quick Wins
**Rationale:** No new infrastructure, immediate measurable improvement, establishes measurement baseline
**Delivers:** Faster DB queries, expanded cache, better health visibility, tuned sentence detection
**Addresses:**
- Health check expansion (FEATURES: health-aware routing)
- SQLite performance PRAGMAs (STACK: WAL mode additional tuning)
- TTS cache expansion to 200 entries (STACK: cache size optimization)
- Sentence detection tuning (MIN_SENTENCE_LEN from 20 to 15)
**Avoids:** Pitfall #7 (health check design sets foundation for later phases)

**Files:** config.ts (PRAGMAs), db/index.ts (WAL settings), tts.ts (cache constant), api/health.ts (complete rewrite), ai/sentence-stream.ts (constant)

### Phase 2: Reliability - Piper TTS Fallback
**Rationale:** Fallback improves reliability before adding complexity. Without Piper, a stuck XTTS request blocks worker slot for 20s. With Piper at 3s timeout, worst case is 3s + 100ms.
**Delivers:** 99%+ TTS reliability, <500ms fallback synthesis, graceful degradation
**Addresses:**
- Piper TTS container (STACK: fast fallback engine)
- TTS router with timeout-based fallback (FEATURES: automatic fallback)
- Health-aware routing (FEATURES: don't attempt XTTS if unhealthy)
- Fallback voice selection and testing (PITFALLS: voice mismatch prevention)
**Avoids:** Pitfall #1 (voice mismatch), Pitfall #11 (timeout too short)

**Files:** docker-compose.yml (new service), config.ts (Piper endpoint + timeouts), tts.ts (synthesizePiper function, fallback logic)

### Phase 3: Performance - Parallel TTS + Opus Encoding
**Rationale:** These features compound — parallel TTS produces chunks faster, Opus makes them 8x smaller to transfer. Requires careful CPU profiling.
**Delivers:** 40-60% speedup from parallelism (if CPU permits), 8-10x smaller audio payloads
**Addresses:**
- Bounded parallel synthesis pool (FEATURES: parallel TTS)
- Opus encoding via FFmpeg (FEATURES: bandwidth reduction)
- CPU affinity separation (ARCHITECTURE: prevent LLM starvation)
- Out-of-order chunk handling (ARCHITECTURE: index-based reordering)
**Avoids:** Pitfall #2 (CPU starvation), Pitfall #3 (Safari Opus issues), Pitfall #8 (race conditions), Pitfall #12 (encoding overhead on LAN)

**Files:** jarvis-backend/Dockerfile (ffmpeg), opus-encoder.ts (new), chat.ts (parallel queue), config.ts (concurrency limit, codec flag), useChatSocket.ts (chunk ordering)

**Research flag:** Needs benchmarking before committing to parallelism level. May discover 1 concurrent is optimal.

### Phase 4: Persistence - Cache Pre-Warming
**Rationale:** Pre-warm should cache Opus-encoded audio (not WAV that would need re-encoding). Must run after Phase 3 completes.
**Delivers:** Instant response for common phrases, cache survives restarts
**Addresses:**
- Disk-persistent cache (FEATURES: cache durability)
- Startup pre-warming (FEATURES: warm-through pattern)
- Usage-based phrase selection (ARCHITECTURE: frequency tracking)
**Avoids:** Pitfall #9 (blocking startup), Pitfall #15 (cache invalidation)

**Files:** tts-prewarm.ts (new), index.ts (startup hook), tts.ts (disk I/O for cache)

**Research flag:** Analyze cache hit rates of existing LRU before investing in pre-warming infrastructure.

### Phase 5: Observability - Latency Tracing
**Rationale:** Best placed after main changes are in. Traces should measure the actual improved pipeline, not the baseline.
**Delivers:** Per-request timing breakdown, pipeline stage metrics, bottleneck identification
**Addresses:**
- Lightweight timing instrumentation (FEATURES: latency tracing)
- Backend-only timestamps to avoid clock skew (PITFALLS: frontend/backend correlation)
- Trace data buffering and batching (PITFALLS: overhead minimization)
**Avoids:** Pitfall #5 (tracing overhead), Pitfall #6 (clock skew)

**Files:** latency-trace.ts (new), chat.ts (timestamp collection), tts.ts (timing metadata), useChatSocket.ts (frontend timing)

### Phase 6: Context Management - Conversation Window
**Rationale:** Independent of TTS pipeline; can be built in parallel by different developer. Start with token counting before summarization.
**Delivers:** Better Qwen context utilization, cross-session memory integration
**Addresses:**
- Token-aware truncation (FEATURES: sliding window)
- Background summarization (FEATURES: context compression)
- Summary persistence in memory system (ARCHITECTURE: memory tier integration)
**Avoids:** Pitfall #4 (context loss), Pitfall #13 (choppy TTS from short summaries), Pitfall #16 (token counting accuracy)

**Files:** conversation-window.ts (new), chat.ts (window management, summary injection), config.ts (window thresholds)

**Research flag:** Token counting per-provider needs validation. Qwen tokenizer endpoint may not be available.

### Phase 7: Frontend Polish (Optional)
**Rationale:** Depends on Opus being deployed. Measure audio decode jank post-Opus before implementing Workers.
**Delivers:** Smooth chat scrolling at 100+ messages, gapless audio playback
**Addresses:**
- Chat history virtualization (FEATURES: UI performance)
- Pre-decode next chunk (ARCHITECTURE: eliminate inter-sentence gap)
- Web Worker audio decode (conditional on measurements)
**Avoids:** Pitfall #10 (AudioContext unavailable in Workers)

**Files:** progressive-queue.ts (decode-worker delegation if needed), ChatPanel.tsx (virtualization)

**Research flag:** Likely unnecessary. Opus encoding eliminates decode jank; virtualization only helps at 100+ messages.

### Phase Ordering Rationale

1. **Quick wins establish baseline** — Can't validate optimizations without knowing starting performance. Health checks enable measurement.
2. **Reliability before performance** — Piper fallback makes the system robust before adding parallel synthesis complexity.
3. **Opus with parallel TTS** — These features multiply each other's impact. Parallel TTS without Opus sends 2x the data. Opus without parallelism just adds encoding latency.
4. **Pre-warm after Opus** — Cache should store final output format (Opus), not intermediate (WAV).
5. **Trace after changes** — Tracing the optimized pipeline is more useful than tracing the baseline.
6. **Window management last** — Independent of TTS; doesn't block other work.
7. **Frontend polish conditional** — Only if measurements show need.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 3 (Parallel TTS):** CPU profiling required. May discover parallelism counterproductive. Needs "benchmark and decide" step before committing.
- **Phase 3 (Opus):** Browser compatibility testing on specific devices used to access Jarvis. Safari issues may force WAV-only decision.
- **Phase 6 (Conversation Window):** Qwen tokenizer endpoint availability unclear. May need approximation or skip summarization entirely.
- **Phase 7 (Web Worker Audio):** AudioContext Worker limitations are fundamental; may eliminate this phase entirely.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Quick Wins):** SQLite PRAGMAs, cache size, health checks are well-documented patterns.
- **Phase 2 (Piper Fallback):** Piper HTTP API is thoroughly documented; integration pattern is straightforward.
- **Phase 4 (Cache Pre-Warming):** LRU cache with disk persistence is established pattern.
- **Phase 5 (Latency Tracing):** `performance.now()` timestamps are trivial; structured logging is standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Piper HTTP API verified via official docs. FFmpeg Opus support verified on host. Node.js built-ins well-documented. All recommendations based on direct codebase analysis. |
| Features | **HIGH** | Table stakes (fallback, health checks, token counting) are industry standard. Differentiators (CPU affinity, disk cache, parallel TTS) tailored to specific hardware constraints. Anti-features identified via XTTS v2 maintainer confirmations of batch_size=1 limitation. |
| Architecture | **HIGH** | All integration points verified by reading existing codebase. File modifications are specific and localized. Dependency graph clear. Docker Compose pattern matches existing services. |
| Pitfalls | **HIGH** | Critical pitfalls verified via multiple sources: Safari Opus bugs (#226922, #238546, #245428), XTTS concurrency issues (HuggingFace discussion #107), AudioContext Worker limitations (W3C spec issue #16). CPU contention risk confirmed by resource analysis of Home node. |

**Overall confidence:** **HIGH**

### Gaps to Address

**During Phase 3 Planning (Parallel TTS + Opus):**
- **CPU contention on Home node**: Benchmark required. The 20-thread CPU shared with llama-server (16 threads), XTTS (14 CPUs Docker limit), and Proxmox may not support 2 concurrent TTS. May need to reduce to 1 concurrent or implement adaptive concurrency. Address via: Profile serial vs 2-concurrent; if LLM tok/s drops >30%, keep serial.
- **Opus browser support on actual access devices**: Research says Safari has issues; but if the specific device used to access Jarvis is an iPhone with Safari 17+, Opus may work fine. Address via: Test Opus `decodeAudioData()` on the actual device during phase planning. If fails, use WAV.

**During Phase 6 Planning (Conversation Window):**
- **Qwen tokenizer accuracy**: Character-based approximation (length / 4) is rough. Qwen may have tokenizer endpoint available via llama-server. Address via: Check llama-server `/tokenize` endpoint availability. If exists, use; otherwise, character approximation with 25% headroom is acceptable.
- **Summarization quality for tool contexts**: LLM-generated summaries may hallucinate or lose tool call details. Address via: Start with extraction (structured key-value facts) rather than generation (free-form summary). Test tool call accuracy before/after enabling summarization.

**During Phase 7 Planning (Frontend Polish):**
- **Web Worker necessity**: Opus encoding likely eliminates decode jank. Address via: Deploy Phase 3, measure main thread impact of `decodeAudioData()` with Opus buffers. Only proceed with Worker implementation if decode consistently takes >5ms and causes visible UI jank.

## Sources

### Primary (HIGH confidence)

**Stack dimension:**
- [OHF-Voice/piper1-gpl GitHub](https://github.com/OHF-Voice/piper1-gpl) — Current Piper repository, HTTP API docs
- [piper-tts PyPI v1.3.0](https://pypi.org/project/piper-tts/) — Latest stable release
- [rhasspy/piper-voices HuggingFace](https://huggingface.co/rhasspy/piper-voices) — Voice model repository
- [FFmpeg official docs](https://ffmpeg.org/ffmpeg-codecs.html#libopus) — Opus encoding parameters
- [@tanstack/react-virtual npm](https://www.npmjs.com/package/@tanstack/react-virtual) — v3.13.18 published 2026-01-16
- [better-sqlite3 performance docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — WAL mode and PRAGMAs

**Features dimension:**
- [Coqui TTS XTTS Documentation](https://docs.coqui.ai/en/latest/models/xtts.html) — Official XTTS v2 specs
- [XTTS v2 batch inference discussion (GitHub #3713)](https://github.com/coqui-ai/TTS/discussions/3713) — batch_size=1 limitation
- [XTTS v2 concurrent request CUDA errors (HuggingFace #107)](https://huggingface.co/coqui/XTTS-v2/discussions/107) — Concurrency issues
- [Inferless TTS model comparison](https://www.inferless.com/learn/comparing-different-text-to-speech---tts--models-part-2) — Piper vs XTTS latency benchmarks
- [Context Window Management (Agenta)](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms) — Sliding window patterns

**Architecture dimension:**
- Direct codebase analysis — 13 files read (chat.ts, tts.ts, config.ts, docker-compose.yml, progressive-queue.ts, etc.)
- [Piper HTTP API specification](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md) — REST endpoints
- [Node.js Reference Architecture - Health Checks](https://nodeshift.dev/nodejs-reference-architecture/operations/healthchecks/) — Liveness vs readiness

**Pitfalls dimension:**
- [WebKit Bug 226922](https://bugs.webkit.org/show_bug.cgi?id=226922) — Safari 15 WebM Opus failures
- [WebKit Bug 238546](https://bugs.webkit.org/show_bug.cgi?id=238546) — Safari 15.4 inconsistent support
- [WebKit Bug 245428](https://bugs.webkit.org/show_bug.cgi?id=245428) — Safari 16 blob URL issues
- [WebAudio/web-audio-api Issue #16](https://github.com/WebAudio/web-audio-api/issues/16) — AudioContext in Workers (open since 2013)
- [OpenTelemetry OTEP #154](https://github.com/open-telemetry/oteps/issues/154) — Clock skew issues
- [Chroma Research: Context Rot](https://research.trychroma.com/context-rot) — LLM context degradation
- [Aerospike: Cache Warming Pitfalls](https://aerospike.com/blog/cache-warming-explained) — Anti-patterns

### Secondary (MEDIUM confidence)
- [Chrome Status: Opus in decodeAudioData](https://chromestatus.com/feature/5649634416394240) — Chrome Opus support timeline
- [WebCodecs GitHub #366](https://github.com/w3c/webcodecs/issues/366) — Audio decoding limitations
- [npm trends: react-virtual vs react-window](https://npmtrends.com/@tanstack/react-virtual-vs-react-window) — Usage comparison
- [Getmaxim: Context Window Strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) — Token counting approaches

### Tertiary (LOW confidence)
- [Baseten: Streaming TTS with XTTS V2](https://www.baseten.co/blog/streaming-real-time-text-to-speech-with-xtts-v2/) — Production deployment patterns (cloud-focused, GPU-based)
- [Deepgram Discussion #791](https://github.com/orgs/deepgram/discussions/791) — TTS concurrency patterns (different architecture)

---
*Research completed: 2026-01-27*
*Ready for roadmap: yes*

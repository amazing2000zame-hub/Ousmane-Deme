# Feature Landscape: v1.5 Optimization & Latency Reduction

**Domain:** AI voice assistant latency optimization (self-hosted, single-user LAN)
**Project:** Jarvis 3.1 -- v1.5 Optimization Milestone
**Researched:** 2026-01-27
**Target:** Reduce first-audio latency from 15-30s to 2-4s with 99%+ reliability

---

## Existing Foundation (Already Built)

These features are live and define what the optimization features build upon:

| Component | Status | Performance Baseline |
|-----------|--------|---------------------|
| Streaming voice pipeline (sentence-by-sentence TTS) | Working | Sentences dispatched during LLM streaming |
| XTTS v2 with fine-tuned JARVIS voice | Working | ~4s per short sentence (CPU), 8-15s typical |
| LRU TTS cache (50 entries, in-memory) | Working | Cache hits return instantly |
| Progressive audio queue on frontend | Working | Chunks play sequentially as they arrive |
| Serial TTS queue (one-at-a-time synthesis) | Working | Guarantees order, prevents server overload |
| SentenceAccumulator (min 20 chars) | Working | Detects sentence boundaries during streaming |
| O(1) token append, RAF batching, React.memo | Working | Chat rendering optimized |
| Shared Proxmox API cache (5-15s TTL) | Working | Reduces redundant API calls |
| Health endpoint (/api/health) | Working | Returns status, uptime, version only |
| Text cleaner (markdown stripping for TTS) | Working | Removes code blocks, formatting, etc. |
| 20-message chat history limit | Working | Hard cutoff, no summarization |
| AbortController for request cancellation | Working | Per-session abort on disconnect |

### Key Constraints for Optimization

1. **CPU-only inference**: No GPU. XTTS v2 runs on CPU (14 cores, 20 threads shared with llama-server). Parallelism is CPU-bound.
2. **XTTS batch_size=1**: XTTS v2 does not support batch inference. Parallel requests cause errors even on GPU. On CPU, they compete for the same cores.
3. **Single user on LAN**: No multi-tenant concerns. Optimizations can be aggressive (pre-warm, pre-allocate, monopolize resources).
4. **WAV output from XTTS**: Current TTS returns uncompressed WAV. A 4-second sentence is ~350KB over LAN (negligible on gigabit), but encoding to Opus would reduce to ~10KB.
5. **llama-server shares CPU**: TTS and LLM compete for the same 14 CPU cores. Running both simultaneously degrades both.

---

## Feature Domain 1: TTS Fallback System

### How Production Systems Handle This

Production TTS pipelines use a tiered fallback strategy: primary engine (highest quality), secondary engine (acceptable quality, higher availability), and tertiary/browser fallback (last resort, always available). The key principles:

- **Timeout per sentence**: 15-30s for CPU inference is too high. Production systems use 5-10s timeouts for individual TTS calls, with the understanding that if synthesis hasn't started producing audio in that window, the service is likely stuck.
- **Mid-sentence fallback**: The hardest case. If the primary TTS fails mid-sentence, the options are: (a) skip that sentence entirely, (b) retry with fallback engine from the beginning of the sentence, or (c) emit silence and continue. Option (b) is most common.
- **Voice consistency**: Switching voices mid-response is jarring. Production systems accept voice inconsistency on fallback as preferable to silence, but minimize it by completing the current sentence with the fallback and attempting to return to primary for the next sentence.
- **Health-gated routing**: Check TTS health before dispatching. The existing 60s health cache is good but should reset on failure (which it already does -- `lastHealthCheck = 0` on error).

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Automatic fallback to browser SpeechSynthesis | When XTTS is down or slow, user hears nothing. Browser TTS is always available, instant, and acceptable for a fallback. | Medium | Frontend detection of TTS failure/timeout, browser SpeechSynthesis API |
| Per-sentence timeout with fallback trigger | Current 20s timeout returns null on failure. Should trigger fallback instead of silence. | Low | Modify `synthesizeSentenceToBuffer` to return fallback signal |
| Health-aware routing before dispatch | Don't attempt XTTS synthesis if health check failed recently. Route directly to fallback. | Low | Already partially implemented (60s health cache). Extend to expose to chat handler. |
| Graceful degradation notification | User should know when fallback is active ("Voice quality reduced -- TTS server recovering"). | Low | New socket event `chat:tts_fallback` |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| ElevenLabs cloud fallback (optional) | Higher quality than browser TTS. Already coded but not wired into fallback chain. Use when API key present. | Low | Existing `synthesizeElevenLabs` function, API key config |
| Automatic recovery detection | When primary TTS recovers, switch back seamlessly without user action. The existing health check interval handles this. | Low | Health check polling already exists |
| Fallback latency tracking | Log which fallback was used and why. Feeds into latency tracing pipeline. | Low | Logging, ties to Feature Domain 5 |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multiple TTS engine instances | XTTS v2 does not support concurrent requests (even on GPU, causes CUDA assertion errors). Running multiple instances on CPU would starve both LLM and TTS. | Single serial queue with fallback to a different engine type |
| Voice cloning on fallback | Trying to match JARVIS voice on ElevenLabs/browser TTS adds complexity with minimal benefit. Accept voice change on fallback. | Use best available preset voice on fallback (e.g., "Daniel" on ElevenLabs, default male on browser) |
| Retry loops on primary | Retrying failed XTTS requests when the service is unhealthy wastes time. Fail fast, fallback fast. | Circuit breaker pattern: after N failures in M seconds, route to fallback for cooldown period |

---

## Feature Domain 2: Parallel TTS Synthesis

### How Production Systems Handle This

Production voice pipelines use multi-worker architectures to synthesize sentences in parallel:

- **Worker count**: Typically 2-4 workers for GPU systems. For CPU-only XTTS v2 on shared hardware, parallelism is counterproductive. XTTS batch_size=1 is a hard constraint, and concurrent requests cause errors.
- **Ordering**: Workers pull from a shared queue and deposit results into an ordered output buffer. Each sentence gets an index at detection time (which Jarvis already does). The output buffer waits for the next expected index before releasing to playback.
- **Slow worker handling**: A "straggler" worker blocks playback of all subsequent sentences. Production systems use timeouts: if sentence N hasn't completed in T seconds, skip it and move to N+1.
- **Cancellation**: On user interrupt (new message, stop button), all workers receive abort signal and discard pending work. Jarvis already has AbortController per session.

### Critical Constraint: XTTS Cannot Parallelize

XTTS v2 is confirmed to support only batch_size=1. Concurrent GPU requests cause CUDA assertion errors. On CPU, the same model cannot process two requests simultaneously without thread contention that makes both slower. The "parallel TTS" story for Jarvis is NOT about running multiple XTTS instances.

**The real opportunity**: Parallel XTTS + LLM is counterproductive on shared CPU. But overlapping LLM streaming with sequential TTS (which Jarvis already does) IS the parallelism. The improvement path is making each sequential TTS call faster, not adding more concurrent calls.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Preserve serial queue (current design) | The current one-at-a-time TTS queue is the correct architecture for CPU-only XTTS v2. Changing to parallel would degrade performance. | None (keep current) | N/A |
| Abort propagation to TTS queue | When user sends new message or disconnects, pending TTS sentences should be cancelled immediately. Current AbortController check exists but could be tighter. | Low | AbortController signal check before each queue item |
| Queue depth limiting | If LLM generates 20 sentences but user interrupts after 3, don't synthesize remaining 17. Cap queue at 3-5 ahead of playback. | Low | Max queue depth constant, drop excess |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Speculative next-sentence synthesis | Start synthesizing sentence N+1 immediately after sentence N completes (before N finishes playing). Current design already does this via the queue. Verify it works correctly. | Low | Audit existing `drainTtsQueue` logic |
| CPU affinity separation | Pin llama-server to cores 0-7 and XTTS to cores 8-13 using `taskset` to eliminate contention. This is the single biggest performance win available. | Medium | systemd service modification, Docker `cpuset` |
| Sentence length optimization | Shorter sentences synthesize faster on XTTS. Tune `SentenceAccumulator` MIN_SENTENCE_LEN and max length to find the sweet spot (e.g., 50-150 chars). | Low | Benchmark different sentence lengths |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multiple XTTS worker instances | XTTS v2 cannot process concurrent requests. Running two instances doubles memory (~2GB each) and causes CPU thrashing. Confirmed as "wontfix" by maintainers. | Single serial queue, optimize per-sentence latency |
| GPU TTS offloading | No GPU in cluster. Adding one changes hardware scope of this milestone. | Future milestone if GPU added |
| Non-autoregressive TTS model swap | Models like FastSpeech 2 are much faster but produce lower quality, no voice cloning. Would lose the JARVIS personality voice. | Keep XTTS v2, optimize around its constraints |

---

## Feature Domain 3: Opus Audio Codec

### How This Works in Web Applications

The current pipeline sends uncompressed WAV from XTTS to the browser. WAV at 22050Hz mono 16-bit is approximately 44KB/s. Opus at 32kbps would be approximately 4KB/s -- a 10x reduction. On LAN this bandwidth difference is negligible, but Opus has other benefits:

- **Encoding on server (Node.js)**: Use `ffmpeg` (CLI) or a native Node.js binding to transcode WAV to Opus in a WebM container. The encoding step adds 10-50ms per sentence. `ffmpeg -i input.wav -c:a libopus -b:a 32k -f webm output.webm` is the standard approach.
- **WebM container vs raw Opus**: WebM is the correct container for browser playback. Ogg containers are not supported by Media Source Extensions (MSE). All modern browsers support Opus in WebM. Safari added Opus support in Safari 18.4 (2025). Raw Opus frames require a custom decoder.
- **Browser decoding**: `AudioContext.decodeAudioData()` natively handles Opus-in-WebM in all modern browsers. No WASM decoder needed. The current `decodeAudioData` call in `progressive-queue.ts` would work unchanged if the server sends WebM/Opus instead of WAV.
- **Latency implication**: Opus encoding adds 10-50ms but reduces transfer time. On LAN (gigabit), transfer time for a 4-second WAV sentence is ~1.5ms, so Opus encoding would be a net negative. **On slower networks or WiFi, Opus becomes beneficial.** For a single user on wired LAN, this is a marginal optimization.
- **libopus 1.6** (released December 2025): Latest version with backward-compatible bandwidth extension improvements.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Keep WAV for LAN (current default) | On gigabit LAN, WAV transfer is instant. Opus encoding overhead (10-50ms per sentence) would increase latency, not decrease it. | None (keep current) | N/A |
| Content-type aware playback | Frontend should handle both WAV and Opus content types from `decodeAudioData`. It already does this implicitly -- `decodeAudioData` auto-detects format. | None (already works) | N/A |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Optional Opus encoding (config flag) | For remote access (Twingate VPN, mobile on WiFi), Opus reduces audio from ~350KB to ~10KB per sentence. Add `AUDIO_CODEC=wav|opus` config option. | Medium | ffmpeg installed in backend container, transcode step in TTS pipeline |
| Adaptive codec selection | Detect connection speed (first-packet timing or explicit header) and auto-select WAV (LAN) vs Opus (remote). | High | Network quality detection, per-client codec selection |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Always-on Opus encoding | Adds 10-50ms latency per sentence with zero benefit on LAN. Only useful for remote access. | Config flag, default to WAV |
| WASM Opus decoder in browser | All modern browsers decode Opus natively via `decodeAudioData`. A WASM decoder adds bundle size and complexity for zero benefit. | Use native browser decoding |
| Raw Opus frames (no container) | Requires custom framing protocol. WebM container is universally supported and works with existing decodeAudioData. | Use WebM container |
| Media Source Extensions (MSE) for playback | MSE adds complexity for streaming scenarios. The current approach (decode full sentence buffer, play via AudioBufferSourceNode) is simpler and correct for sentence-sized chunks. | Keep AudioBufferSourceNode approach |

---

## Feature Domain 4: Conversation Sliding Window

### How Production Chat Systems Manage Context

The current system uses a hard 20-message cutoff (`chatHistoryLimit: 20`). This is functional but loses important context from earlier in long conversations. Production systems use several strategies:

- **Sliding window with summarization**: Keep the last 8-10 messages verbatim, summarize older messages into a running summary. When total tokens exceed budget, the oldest messages get summarized first. This preserves recent context while retaining key decisions from earlier.
- **Token counting**: Use tiktoken (for OpenAI models) or approximate counting (4 chars per token as rough heuristic). Monitor total context usage and trigger summarization when approaching the limit.
- **When to trigger summarization**: After every 8-10 exchanges, OR when token count exceeds 60-70% of context window. For Qwen (4096 token context), summarization should trigger around 2500 tokens of history. For Claude (200K context), this is far less critical.
- **Summarization reduces tokens by 60-70%**: A summary of 10 messages (~2000 tokens) typically compresses to 400-600 tokens while preserving essential information.
- **Hierarchical memory**: Jarvis already has episodic/semantic memory tiers. The sliding window can leverage this -- key decisions extracted during summarization feed into the existing memory system.

### Critical Context: Qwen vs Claude

- **Qwen (4096 tokens)**: Context window is tiny. 20 messages easily exceeds it, especially with the system prompt consuming ~500-800 tokens. Summarization is essential.
- **Claude (200K tokens)**: Context window is enormous. 20 messages is a fraction of capacity. Summarization is nice-to-have but not critical for context management; it's more about cost optimization.

The sliding window is primarily a Qwen optimization. Claude benefits minimally.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Token-aware message truncation | Current 20-message limit doesn't account for message length. One long tool output could consume the entire Qwen context window. Count tokens, not messages. | Medium | Token counting utility (tiktoken or heuristic), modify history loading |
| Sliding window with summary prefix | When history exceeds token budget, summarize oldest messages and prepend summary to context. "Previous context: [summary]. Recent messages: [verbatim]." | Medium | LLM call for summarization (use Qwen itself), summary caching |
| System prompt token budget | Reserve fixed token budget for system prompt (800 tokens for Qwen) and allocate remainder to history. Current config doesn't account for system prompt size. | Low | Token counting of system prompt, reduce available history budget |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Automatic summarization trigger | Monitor token count per exchange. When cumulative history exceeds threshold (e.g., 2500 tokens for Qwen), auto-summarize oldest half. | Medium | Background summarization call, cache invalidation |
| Summary persistence across sessions | Store conversation summaries in SQLite alongside messages. When session resumes, load summary instead of full history replay. | Medium | New `session_summaries` table, session resume logic |
| Memory extraction during summarization | When summarizing old messages, extract key facts into the existing memory system (episodic/semantic). Two birds, one stone. | Low | Already have `extractMemoriesFromSession`, call during summarization |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| RAG-based context retrieval | For a single user on a homelab, the overhead of vector stores and embedding models is unjustified. Simple summarization covers the use case. | Sliding window + summarization |
| Per-message importance scoring | Scoring each message's importance before deciding what to keep adds LLM calls and complexity. Simple FIFO with summarization works fine. | FIFO sliding window |
| Infinite context via external memory | The memory system already handles long-term recall. The sliding window manages short-term conversation flow. Don't conflate them. | Keep memory and sliding window as separate systems |

---

## Feature Domain 5: Latency Tracing Pipeline

### How Production Systems Trace End-to-End Latency

For an AI voice pipeline, the critical path is: User input -> LLM routing -> LLM first token -> LLM sentence complete -> TTS synthesis -> Audio delivery -> Playback start. Each segment needs timing.

- **Span IDs**: OpenTelemetry uses trace IDs (for the full request) and span IDs (for each segment). For Jarvis, a single "trace" is one user message through to audio playback. Each pipeline stage is a "span."
- **Timing events**: Record `performance.now()` (or `Date.now()`) at each transition. Events within spans capture sub-steps (e.g., within TTS span: "health check", "synthesis start", "first byte", "complete").
- **Aggregation**: For a single-user system, per-request traces are more useful than percentile aggregation. But over time, tracking p50/p95/p99 across sessions reveals trends. Store timing data in SQLite for analysis.
- **What percentiles matter**: p50 (typical experience), p95 (occasional slowdown), p99 (worst case excluding outliers). For single-user, max is also relevant since there's no averaging across concurrent users.

### Lightweight vs Full OpenTelemetry

For a single-service, single-user system, full OpenTelemetry with a collector and Jaeger is overkill. The right approach is:

1. **Structured timing logs**: `console.log(JSON.stringify({ traceId, spanName, startMs, endMs, durationMs }))` with a unique traceId per user message.
2. **SQLite storage**: Write timing records to a `latency_traces` table for trend analysis.
3. **Dashboard display**: Expose timing breakdown in the UI (routing: 5ms, thinking: 200ms, synthesis: 4000ms, playback: 50ms).

If the system grows to multiple services or users, OpenTelemetry can be added later without changing the trace format.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Per-request timing breakdown | For every voice response, log: total time, LLM time, TTS time per sentence, audio delivery time. Without this, optimization is guesswork. | Medium | Timing instrumentation in chat handler, TTS functions |
| Trace ID per request | Unique ID that links all timing events for a single user message. Essential for correlating logs. | Low | `crypto.randomUUID()` (already used for session IDs) |
| Pipeline stage timing in UI | Show user the timing breakdown: "Routing: 5ms, Thinking: 1.2s, Synthesis: 3.8s, Total: 5.0s". The `pipelineStage` system already exists; add timing to it. | Medium | Extend `chat:stage` events with timestamps, frontend timing display |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Historical latency trends | Store timing data in SQLite. Show a chart of latency over time on the dashboard. Detect regressions after config changes. | Medium | New `latency_traces` SQLite table, chart component |
| Performance budget alerts | Define target latencies (e.g., first audio < 5s, total < 15s). Log warnings when exceeded. Surface in dashboard. | Low | Threshold constants, conditional logging |
| TTS queue depth tracking | Log how many sentences are queued vs. playing at any given time. Identifies if LLM is producing sentences faster than TTS can consume. | Low | Counter in `drainTtsQueue`, emit with trace data |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full OpenTelemetry + Collector + Jaeger | Massive infrastructure overhead for a single-service, single-user system. Three additional containers (collector, Jaeger, storage) for questionable benefit. | Structured timing logs + SQLite storage |
| Distributed tracing across services | Jarvis is one backend service. There is no distributed system to trace across (TTS is called via HTTP, but from the same container network). | Single-service timing instrumentation |
| Real-time monitoring dashboards (Grafana/Prometheus) | Another set of infrastructure to maintain. The Jarvis dashboard itself should show timing data. | Build timing display into existing Jarvis UI |

---

## Feature Domain 6: Health Check Endpoints

### Production Patterns: Liveness vs Readiness

The existing `/api/health` endpoint returns `{ status: "ok", timestamp, uptime, version }`. This is a liveness check only -- it confirms the Node.js process is running but says nothing about whether the system can actually serve requests.

Production systems separate concerns:

- **`/livez` (Liveness)**: Is the process alive? Should be lightweight, never check external dependencies. A failing liveness probe causes container restart, so dependency failures would create restart loops.
- **`/readyz` (Readiness)**: Can the system serve requests? Check all dependencies: TTS container health, LLM server reachability, database connectivity, Proxmox API access. A failing readiness probe removes from load balancer (or in Jarvis's case, shows degraded status in UI).
- **Startup probe**: Gives extra time for slow starts. XTTS container takes 300s to start (configured in Docker healthcheck).

### What Should Jarvis Health Return

For a single-user self-hosted system, the distinction between liveness and readiness is less critical (no load balancer), but structured health data is valuable for the dashboard:

```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2026-01-27T...",
  "uptime": 12345,
  "version": "1.5.0",
  "services": {
    "tts": { "status": "healthy", "latencyMs": 45, "lastCheck": "..." },
    "llm": { "status": "healthy", "latencyMs": 120, "lastCheck": "..." },
    "proxmox": { "status": "healthy", "nodesReachable": 4, "lastCheck": "..." },
    "database": { "status": "healthy", "sizeBytes": 1234567 }
  }
}
```

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Dependent service health checks | Check TTS, LLM, Proxmox, and DB. Return per-service status. Currently health endpoint ignores all dependencies. | Medium | HTTP health checks to TTS (`:5050/health`) and LLM (`:8080/health`), DB ping, Proxmox client ping |
| Overall status aggregation | `healthy` if all services up, `degraded` if some down, `unhealthy` if critical services down (LLM or DB). | Low | Status aggregation logic |
| `/livez` and `/readyz` split | Separate lightweight liveness from dependency-checking readiness. Docker healthcheck should use `/livez` (fast), dashboard should use `/readyz` (comprehensive). | Low | Two new routes, move current health to `/livez`, add checks to `/readyz` |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Health check latency measurement | Each dependency check records response time. Surfaces in dashboard. "TTS health: 45ms, LLM: 120ms". | Low | `performance.now()` around each check |
| Background health polling | Run health checks every 30s in background, cache results. Endpoint returns cached data instantly instead of blocking on live checks. | Medium | `setInterval` polling, in-memory cache |
| Health history | Store health snapshots in SQLite. Show uptime/availability trends on dashboard. "TTS was down for 5 minutes yesterday." | Medium | New `health_snapshots` table, trend chart |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Checking dependencies in Docker HEALTHCHECK | Docker healthcheck uses `/livez`. If it checks TTS and TTS is restarting, Docker restarts the backend too -- cascade failure. | Docker checks `/livez` (process only), dashboard checks `/readyz` (with deps) |
| Health check authentication | Health endpoints should be unauthenticated. They're used by Docker, monitoring, and the frontend pre-login. Adding auth breaks all of these. | No auth on health endpoints |
| Aggressive health check intervals | Checking every 5s adds unnecessary load. TTS and LLM health don't change that fast. | 30s interval for background polling |

---

## Feature Domain 7: TTS Cache Pre-warming

### How This Works in Practice

The existing LRU cache (50 entries, in-memory) caches sentences after first synthesis. Pre-warming means synthesizing common phrases at startup so the first request for them is instant.

- **What to pre-warm**: Greeting phrases ("Good evening, sir", "At your service", "How may I assist you?"), error messages ("I apologize, but I'm unable to..."), common responses ("Certainly", "Right away", "Of course"). For Jarvis specifically, JARVIS-personality phrases that appear in many responses.
- **How many**: 10-30 phrases is the sweet spot. Each takes 4-10s on CPU, so pre-warming 20 phrases takes 80-200s at startup. This must happen in background, not blocking service readiness.
- **When to refresh**: On service restart (re-warm from disk cache). Periodically (e.g., every 24h) to update if voice model changes. Never during active conversation (CPU contention with live TTS).
- **Disk persistence**: Write cached audio buffers to disk (e.g., `/cache/prewarm/`) keyed by text hash. On startup, load from disk instead of re-synthesizing. This survives container restarts.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Disk-persistent TTS cache | Current cache is in-memory only. Container restart loses all 50 cached entries. Write to `/cache/` volume (already mounted for XTTS). | Medium | File I/O for cache read/write, hash-based filenames, cache manifest |
| Startup cache loading from disk | On backend start, load previously cached audio from disk into the LRU cache. Instant cache hydration. | Medium | Read disk cache dir, populate `sentenceCache` Map |
| Background pre-warm on startup | After service is ready, synthesize common JARVIS phrases in background. Don't block readiness. | Medium | Async startup task, list of phrases, sequential synthesis |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Usage-based pre-warm list | Track which phrases are actually spoken most. On next startup, pre-warm the top-N most frequent. | Medium | Frequency counter in cache, persist to disk/DB |
| Warm-through pattern | On cache miss, serve the live-synthesized result AND write to disk for next time. Combines cache miss handling with disk persistence. | Low | Write-behind to disk after synthesis completes |
| Cache size management | Current 50-entry limit is arbitrary. With disk persistence, can cache hundreds of entries. In-memory LRU stays at 50, disk cache grows larger with LRU eviction at a higher threshold. | Medium | Two-tier cache: hot (memory, 50) and warm (disk, 500) |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Pre-warming during active conversation | CPU contention with live TTS requests. Pre-warming should only happen when idle. | Pre-warm at startup or during detected idle periods |
| Pre-warming hundreds of phrases | 100 phrases x 5s each = 500s (8+ minutes). Blocks TTS for active requests during that time. | Cap at 20-30 highest-value phrases |
| Voice-model-versioned cache | Adding voice model version to cache keys adds complexity. If the voice model changes, just clear the cache directory. | Clear cache on model update, simple hash keys |
| Network-shared cache | The TTS container and backend are on the same machine. No need for Redis or shared cache infrastructure. | Local disk cache in Docker volume |

---

## Feature Domain 8: Web Worker Audio Decoding

### How This Works in Browsers

The current frontend decodes audio using `AudioContext.decodeAudioData()` on the main thread. For WAV sentences (~350KB), this is fast (~5ms) and doesn't block the UI. The question is whether moving this to a Web Worker improves anything.

- **AudioContext limitation**: `AudioContext` (the live rendering context) is NOT available in Web Workers. Only `OfflineAudioContext` is available in workers, which can decode audio but cannot play it.
- **The transfer pattern**: Main thread receives audio ArrayBuffer -> transfer to Worker via `postMessage(buffer, [buffer])` (zero-copy) -> Worker decodes with OfflineAudioContext -> transfers AudioBuffer data back to main thread -> main thread creates AudioBufferSourceNode and plays.
- **The overhead problem**: The transfer back requires copying Float32Array channel data (AudioBuffer cannot be transferred). For a 4-second mono 22050Hz sentence, that's ~88KB of float data per transfer. The round-trip overhead likely exceeds the 5ms decoding time saved.
- **When workers help**: Large audio files (minutes of audio), complex processing (FFT, filtering), or when the main thread is genuinely blocked. For small sentence-sized chunks, workers add latency.

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Keep main-thread decoding (current approach) | For sentence-sized audio chunks (~350KB WAV or ~10KB Opus), `decodeAudioData` on the main thread takes <10ms. Worker overhead would be greater than the savings. | None (keep current) | N/A |
| Ensure `decodeAudioData` uses the latest API | The current code uses `ctx.decodeAudioData(chunk.buffer.slice(0))` which is correct. The `.slice(0)` creates a copy because the ArrayBuffer may have been transferred. | None (already correct) | N/A |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| AudioWorklet for playback smoothing | Instead of Web Workers for decoding, use AudioWorklet for gapless playback between sentences. The current approach has a gap when `onended` fires and the next source starts. AudioWorklet could crossfade. | High | AudioWorklet processor, SharedArrayBuffer (requires COOP/COEP headers) |
| Pre-decode next chunk | While current chunk is playing, pre-decode the next queued chunk so it's ready instantly when `onended` fires. | Low | Decode in parallel with playback, store decoded AudioBuffer |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Web Worker for audio decoding | Round-trip overhead exceeds decoding time for sentence-sized chunks. Worker creation, message passing, and data copy back all add latency. | Keep main-thread `decodeAudioData` |
| WASM audio decoder | Browsers natively decode WAV and Opus. A WASM decoder adds bundle size (~200KB) with no benefit. Only useful for exotic codecs. | Use native `decodeAudioData` |
| SharedArrayBuffer for audio transfer | Requires Cross-Origin-Isolation headers (COOP/COEP), which break many third-party integrations and make deployment harder. Overkill for this use case. | Transferable ArrayBuffer if needed, but prefer main thread |

---

## Feature Dependencies

```
Feature Domain 1 (TTS Fallback)
    |
    +--> Feature Domain 5 (Latency Tracing) -- fallback events feed into traces
    |
    +--> Feature Domain 6 (Health Checks) -- health status gates fallback routing

Feature Domain 2 (Parallel TTS / CPU Affinity)
    |
    +--> Feature Domain 7 (Cache Pre-warming) -- pre-warmed cache reduces TTS calls
    |
    +--> Feature Domain 3 (Opus Codec) -- smaller payloads if sent over network

Feature Domain 4 (Sliding Window)
    |
    +--> Independent (no dependencies on other domains)

Feature Domain 5 (Latency Tracing)
    |
    +--> Feature Domain 6 (Health Checks) -- health data feeds into traces

Feature Domain 6 (Health Checks)
    |
    +--> Independent (foundational, others depend on it)

Feature Domain 7 (Cache Pre-warming)
    |
    +--> Feature Domain 6 (Health Checks) -- pre-warm only when TTS healthy

Feature Domain 8 (Web Worker Decoding)
    |
    +--> Feature Domain 3 (Opus Codec) -- codec choice affects decode approach
```

---

## MVP Recommendation: Maximum Latency Reduction Per Effort

Prioritize by impact-to-effort ratio for reducing the 15-30s first-audio latency:

### Phase 1: Immediate Wins (Days 1-3)

1. **CPU affinity separation** (Domain 2) -- Pin llama-server and XTTS to separate CPU core sets. Single biggest performance win. No code changes, just systemd/Docker config.
2. **Disk-persistent TTS cache** (Domain 7) -- Survive container restarts. Frequent phrases become instant.
3. **Health check expansion** (Domain 6) -- Foundation for everything else. Know what's healthy.

### Phase 2: Core Pipeline Improvements (Days 4-7)

4. **TTS fallback system** (Domain 1) -- 99%+ reliability. When XTTS is slow, browser TTS fills in.
5. **Latency tracing** (Domain 5) -- Measure before optimizing further. Know where time goes.
6. **Pre-warm startup** (Domain 7) -- Common phrases ready at boot.

### Phase 3: Context & Polish (Days 8-10)

7. **Sliding window with summarization** (Domain 4) -- Better Qwen context management.
8. **Pre-decode next chunk** (Domain 8) -- Eliminate inter-sentence gap.

### Defer to Future

- **Opus codec** (Domain 3) -- Only valuable for remote access. Not a latency win on LAN.
- **AudioWorklet crossfade** (Domain 8) -- Perceptual polish, not latency.
- **Full OpenTelemetry** (Domain 5) -- Only if system grows to multiple services.

---

## Confidence Assessment

| Domain | Confidence | Rationale |
|--------|------------|-----------|
| TTS Fallback | HIGH | Well-understood pattern, existing code already has fallback providers |
| Parallel TTS | HIGH | XTTS v2 batch_size=1 constraint confirmed via GitHub issues and Coqui docs |
| Opus Codec | HIGH | Opus codec well-documented, browser support verified via MDN and caniuse |
| Sliding Window | MEDIUM | Patterns well-documented, but Qwen-specific token counting needs testing |
| Latency Tracing | HIGH | OpenTelemetry patterns well-documented, lightweight approach clear |
| Health Checks | HIGH | Kubernetes liveness/readiness pattern is industry standard, well-documented |
| Cache Pre-warming | MEDIUM | Pattern is straightforward, but optimal phrase list needs empirical data |
| Web Worker Decoding | HIGH | AudioContext limitations in workers well-documented by W3C spec and MDN |

---

## Sources

### TTS Fallback & Caching
- [Coqui TTS XTTS Documentation](https://docs.coqui.ai/en/latest/models/xtts.html)
- [XTTS v2 batch inference discussion (GitHub #3713)](https://github.com/coqui-ai/TTS/discussions/3713)
- [XTTS v2 batch processing feature request (GitHub #3776)](https://github.com/coqui-ai/TTS/issues/3776)
- [XTTS v2 concurrent request CUDA errors (HuggingFace)](https://huggingface.co/coqui/XTTS-v2/discussions/107)
- [Pipecat TTS Caching Issue (GitHub #2629)](https://github.com/pipecat-ai/pipecat/issues/2629)
- [Best practices for scaling TTS services (Milvus)](https://milvus.io/ai-quick-reference/what-are-best-practices-for-scaling-tts-services-in-an-application)
- [TTS cache project (GitHub)](https://github.com/bebora/tts-cache)

### Opus Audio Codec
- [Opus codec official site](https://opus-codec.org/)
- [Web audio codec guide (MDN)](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)
- [Opus browser support (caniuse)](https://caniuse.com/opus)
- [WebM Opus interop issue (GitHub)](https://github.com/web-platform-tests/interop/issues/484)
- [Opus format explained (Wowza)](https://www.wowza.com/blog/opus-codec-the-audio-format-explained)

### Context Management
- [Context Window Management Strategies (APXML)](https://apxml.com/courses/langchain-production-llm/chapter-3-advanced-memory-management/context-window-management)
- [Top techniques to manage context length (Agenta)](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms)
- [Context window management strategies (GetMaxim)](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/)
- [Context Rot research (Chroma)](https://research.trychroma.com/context-rot)

### Latency Tracing
- [Traces and Spans in OpenTelemetry (OneUptime)](https://oneuptime.com/blog/post/2025-08-27-traces-and-spans-in-opentelemetry/view)
- [Distributed Tracing primer (Better Stack)](https://betterstack.com/community/guides/observability/distributed-tracing/)
- [Generate Custom Metrics from Spans (Datadog)](https://docs.datadoghq.com/tracing/trace_pipeline/generate_metrics/)
- [Critical Path Tracing (ACM Queue)](https://queue.acm.org/detail.cfm?id=3526967)
- [OpenTelemetry Node.js getting started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)

### Health Checks
- [Node.js Reference Architecture - Health Checks (nodeshift)](https://nodeshift.dev/nodejs-reference-architecture/operations/healthchecks/)
- [Kubernetes Liveness vs Readiness Probes (DEV)](https://dev.to/sagarmaheshwary/kubernetes-liveness-vs-readiness-probes-what-they-actually-mean-3b3l)
- [Effective Docker Healthchecks for Node.js (Medium)](https://patrickleet.medium.com/effective-docker-healthchecks-for-node-js-b11577c3e595)

### Web Audio / Workers
- [Web Audio API spec (W3C)](https://www.w3.org/TR/webaudio-1.1/)
- [AudioWorklet (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [AudioWorklet + SharedArrayBuffer + Worker (Chrome Labs)](https://googlechromelabs.github.io/web-audio-samples/audio-worklet/design-pattern/shared-buffer/)
- [SharedArrayBuffer for getChannelData (WebAudio issue #2446)](https://github.com/WebAudio/web-audio-api/issues/2446)

### Parallel TTS Pipelines
- [Text-to-Speech Architecture: Production Trade-Offs (Deepgram)](https://deepgram.com/learn/text-to-speech-architecture-production-tradeoffs)
- [Streaming real-time TTS with XTTS V2 (Baseten)](https://www.baseten.co/blog/streaming-real-time-text-to-speech-with-xtts-v2/)
- [Low-Latency End-to-End Voice Agents (arXiv)](https://arxiv.org/html/2508.04721v1)

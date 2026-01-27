# Domain Pitfalls -- v1.5 Optimization & Latency Reduction

**Domain:** Adding TTS fallback, parallel synthesis, Opus codec, conversation windowing, latency tracing, health monitoring, cache pre-warming, and Web Worker audio to an existing AI assistant (Jarvis 3.1)
**Researched:** 2026-01-27
**Confidence:** HIGH (verified against current codebase analysis, official documentation, community reports, and browser compatibility databases)

**Scope:** This document focuses on pitfalls specific to ADDING performance optimization features to the EXISTING Jarvis 3.1 voice pipeline. The system currently has a working XTTS v2 TTS pipeline (CPU, 3-10s per sentence), streaming sentence detection via `SentenceAccumulator`, progressive audio queue with Web Audio API, Socket.IO binary delivery, and a serial TTS synthesis queue (`drainTtsQueue`). The Home node (24GB RAM, 20 threads) runs the Docker stack alongside llama-server and Proxmox cluster operations.

---

## Critical Pitfalls

Mistakes that cause system crashes, data corruption, or require rewrites.

---

### Pitfall 1: TTS Fallback Voice Mismatch Creates Jarring User Experience

**What goes wrong:** When XTTS times out and the system falls back to Piper TTS, the user hears a completely different voice mid-response. XTTS v2 produces a custom-cloned JARVIS voice with specific prosody, accent, and timbre trained from reference audio in `/opt/jarvis-tts/voices/`. Piper uses pre-trained VITS models (e.g., `en_US-lessac-medium`) with entirely different vocal characteristics -- different pitch, cadence, speaking rate, and accent. Research confirms that Piper has significantly lower quality than XTTS, with fundamentally different prosodic patterns due to its VITS architecture vs. XTTS's autoregressive decoder. In a progressive playback scenario where sentences play sequentially, sentence 3 suddenly sounding like a different person is worse than a brief pause.

**Why it happens:** Developers treat TTS fallback as a binary availability question ("Is XTTS down? Use Piper.") without considering the perceptual continuity requirement. The current system already hardcodes voice to `'jarvis'` in `synthesizeLocal()` (tts.ts line 109), and the progressive queue plays chunks sequentially. A naive fallback inserts alien-sounding audio into a sequence the user was tracking as a single voice.

**Warning signs:**
- Fallback triggers during normal load (XTTS is just slow, not crashed)
- Users report "voice changed mid-sentence" or "two voices talking"
- Piper fallback voice has noticeably different sample rate or encoding than XTTS output

**Prevention:**
1. **Never mix engines within a single response.** If XTTS fails on sentence 1, use Piper for ALL subsequent sentences in that response. Never alternate between engines sentence-by-sentence.
2. **Set the fallback timeout high enough to avoid false triggers.** The current `SENTENCE_TTS_TIMEOUT` is 20 seconds (tts.ts line 276). XTTS CPU inference takes 3-15s typically. Only fall back when XTTS is genuinely unresponsive (health check fails), not merely slow.
3. **Use Piper's closest-matching voice.** Select a Piper model with similar characteristics to the XTTS JARVIS voice (male, British-accented if applicable, medium pitch). Pre-test voice similarity before deployment.
4. **Signal the fallback to the user.** Add a visual indicator in the frontend (e.g., badge on message) when fallback voice is active so the voice change is expected, not surprising.
5. **Consider silence over mismatch.** For a single-user homelab system, it may be better to skip audio entirely and show a "voice temporarily unavailable" message than to play a jarring different voice.

**Detection:** Log which TTS engine produced each audio chunk. Track fallback frequency. If fallback triggers more than 10% of sentences, investigate XTTS capacity rather than relying on fallback.

**Which phase should address it:** TTS Fallback phase -- this is the first design decision. The fallback strategy (whole-response vs. per-sentence, silent vs. alternate voice) must be decided before implementation.

---

### Pitfall 2: Parallel TTS Overwhelms CPU and Starves LLM Inference

**What goes wrong:** Moving from serial TTS synthesis (current `drainTtsQueue` processes one sentence at a time) to parallel synthesis sends 2-3 concurrent requests to the XTTS container. The XTTS v2 model consumes ~5GB RAM during inference and is CPU-bound. The TTS container has a resource limit of 14 CPUs and 16GB memory (docker-compose.yml lines 103-109), while llama-server runs as a systemd service on the same host using 16 threads for LLM inference. Parallel TTS requests will compete directly with llama-server for CPU cycles, causing both TTS and LLM generation to slow dramatically. Research confirms XTTS v2 has known issues with concurrent requests, including race conditions and CUDA assertion errors (GPU) -- on CPU, concurrent requests cause memory pressure and extreme slowdowns rather than crashes.

**Why it happens:** The optimization sounds obvious: "synthesis takes 8s per sentence, so run 3 in parallel and get 3x throughput." But the system is CPU-bound, not I/O-bound. Three concurrent CPU-bound tasks on a 20-thread machine that is also running LLM inference (16 threads), Docker daemon, Proxmox services, and cluster operations will cause severe contention. The total effect is that each individual synthesis takes 2-3x longer, and LLM token generation drops from ~35 tok/s to ~10 tok/s, making the entire response slower.

**Warning signs:**
- LLM token generation rate drops significantly when TTS is synthesizing
- Individual TTS synthesis times increase rather than decrease with parallelism
- System load average exceeds CPU count (>20)
- TTS timeouts increase due to per-request slowdown
- `top` shows CPU steal time or high iowait

**Prevention:**
1. **Limit parallel TTS to 2 concurrent requests maximum.** Even this may be too much. Benchmark before committing. On a 20-thread CPU shared with llama-server, 1-2 parallel TTS requests is the practical ceiling.
2. **Use CPU affinity or cgroup limits** to prevent TTS from starving LLM. The docker-compose already reserves 4 CPUs for TTS. Consider lowering the limit from 14 to 8 CPUs and ensuring llama-server gets a dedicated share.
3. **Profile first, parallelize second.** Measure: (a) serial TTS time per sentence, (b) LLM generation speed during serial TTS, (c) same metrics with 2 parallel TTS requests. If LLM slows more than TTS speeds up, keep serial.
4. **Implement adaptive concurrency.** Start with 1 concurrent request. If system load is below threshold (e.g., load average < 12), allow 2. Never exceed 2 on this hardware.
5. **Stagger parallel requests** rather than launching all at once. Add 500ms delay between launching concurrent synthesis jobs to avoid CPU spike.

**Detection:** Add CPU utilization monitoring. Track time-per-sentence for TTS and tokens-per-second for LLM. Alert if either metric degrades by more than 30% from baseline.

**Which phase should address it:** Parallel TTS phase -- this requires careful benchmarking. The phase plan should include a "benchmark and decide" step before committing to any parallelism level.

---

### Pitfall 3: Opus Codec Breaks Safari Audio Playback via decodeAudioData

**What goes wrong:** The frontend uses `AudioContext.decodeAudioData()` to play TTS audio chunks (progressive-queue.ts line 193). Switching the backend to output Opus-encoded audio in a WebM container causes decoding failures in Safari. Research confirms extensive, long-running WebKit bugs: Bug 226922 (Safari 15 breaks WebM Opus), Bug 238546 (inconsistent in Safari 15.4), Bug 245428 (Safari 16 cannot play WebM Opus from blob URL). While Safari 17+ added support for 1-2 channel Opus in WebM, Ogg Opus remains completely broken in Safari. Additionally, Firefox has strict Opus header validation and will reject files with truncated OpusTags headers that Chrome accepts.

**Why it happens:** Developers test Opus only in Chrome (where it works reliably), deploy, and then discover Safari users get silence or decode errors. The `decodeAudioData()` API has different codec support per browser engine, and Opus-in-WebM is the most inconsistent format across browsers. Even "supported" formats can fail on edge cases (blob URLs, specific channel configurations, header format variations).

**Warning signs:**
- `decodeAudioData()` throws `DOMException` or `EncodingError` on specific browsers
- Audio plays in Chrome but is silent in Safari or Firefox
- WAV-based pipeline works but Opus pipeline fails intermittently
- Frontend console shows codec-related errors only on certain browsers

**Prevention:**
1. **Keep WAV as the primary format for `decodeAudioData()`.** The current system outputs WAV (tts.ts line 125: `'audio/wav'`), which is universally supported. WAV decoding is fast and never fails.
2. **Use Opus only for transfer encoding, decode on receipt.** If bandwidth savings are needed, encode as Opus for Socket.IO transfer but decode back to PCM on the frontend before passing to `decodeAudioData()`. This requires a client-side Opus decoder (e.g., `opus-decoder` npm package or WebAssembly-based decoder).
3. **If using native Opus decoding**, implement format negotiation: client reports supported codecs at connection time, backend sends Opus only to confirmed-compatible clients. On a single-user homelab accessed from known devices, you can hardcode the format to match your specific browser.
4. **Test on ALL target browsers before deploying.** The single-user homelab context means you know exactly which browsers/devices will access the system. Test Opus playback on each one.
5. **For this specific system**: Given it's a homelab accessed primarily from one device, and WAV transfer over the local network (192.168.1.x) is nearly instantaneous, the bandwidth savings of Opus may not justify the complexity. A 3-second WAV sentence is ~265KB at 22050Hz mono 16-bit. On a local gigabit network, this transfers in <3ms.

**Detection:** Add `try/catch` around `decodeAudioData()` calls (already exists in progressive-queue.ts line 193-212). Log the content type and browser UserAgent on decode failures. Monitor for "Failed to play XTTS chunk" warnings.

**Which phase should address it:** Opus Codec phase -- but this pitfall suggests the phase may be unnecessary for a homelab system on a local network. The roadmap should evaluate whether Opus provides meaningful benefit before committing to implementation.

---

### Pitfall 4: Conversation Sliding Window Silently Drops Critical Context

**What goes wrong:** The current system uses a fixed `chatHistoryLimit` of 20 messages (config.ts line 46) with simple truncation (`history.slice(-config.chatHistoryLimit)` in chat.ts line 138). Adding a sliding window with summarization introduces a more complex failure mode: the summary loses critical details that the LLM needs to maintain coherent tool execution. For example, a user says "restart the VM we discussed earlier" -- but the summarized context says "discussed cluster status" instead of "discussed VM 103 (management)". The LLM either asks the user to clarify (annoying) or guesses wrong (dangerous -- wrong VM restarted). Research confirms that LLM summarization has hallucination risk and "lost in the middle" effects where important details placed in the middle of context are underweighted.

**Why it happens:** Summarization is lossy compression. It works well for casual conversation but poorly for technical/operational context where specific identifiers (VMIDs, IP addresses, file paths, exact error messages) are critical. The current system routes between Claude (agentic with tools) and Qwen (conversational) based on intent -- tool call context from Claude sessions includes structured data (tool names, inputs, results) that is especially poorly preserved by free-form summarization. Token counting accuracy is another issue: different providers (Claude vs. Qwen) use different tokenizers, so a summary sized for Claude's context may be wrong for Qwen's.

**Warning signs:**
- LLM asks for information the user already provided earlier in the conversation
- Tool calls use wrong identifiers (wrong VMID, wrong IP, wrong file path)
- Summarization generates hallucinated details not present in original conversation
- Token count estimates drift from actual usage, causing context overflow errors

**Prevention:**
1. **Separate structured context from conversational context.** Keep a "facts extracted" list (VMIDs mentioned, IPs discussed, tools executed with results) that is never summarized. Only summarize the narrative flow.
2. **Use extraction, not generation, for summaries.** Instead of asking the LLM to "summarize this conversation," extract key entities and decisions: "User asked to restart VM 103. Result: success." This is more deterministic and less prone to hallucination.
3. **Validate token counting per provider.** Use `tiktoken` for Claude (Anthropic uses cl100k_base), and the local tokenizer endpoint for Qwen. The current Qwen context window is only 4096 tokens (config.ts line 51) -- summarization is most critical for Qwen sessions.
4. **Keep the full conversation in the database.** The SQLite database already stores all messages via `memoryStore.saveMessage()`. The sliding window affects only the in-context messages sent to the LLM, not persistence. This means you can always reconstruct full context if needed.
5. **Start with simple truncation improvements** before adding summarization. The current 20-message limit is conservative. For Qwen (4096 token window), count actual tokens rather than messages. For Claude (larger context), increase the message limit. This may solve the problem without needing summarization at all.

**Detection:** Add a "context confidence" metric: after summarization, check if key entities from the last 5 tool calls are present in the summary. Log when the summary fails to preserve tool call context. Compare LLM behavior (accuracy of references to past context) before and after enabling summarization.

**Which phase should address it:** Conversation Windowing phase -- but the phase should start with token-counting improvements to the existing truncation before attempting summarization. The simpler fix may be sufficient.

---

## Moderate Pitfalls

Mistakes that cause delays, degraded performance, or technical debt.

---

### Pitfall 5: Latency Tracing Overhead Slows the System It's Measuring

**What goes wrong:** Adding timing instrumentation to every stage of the pipeline (LLM token generation, sentence detection, TTS synthesis, Socket.IO transfer, audio decoding, playback start) introduces overhead that itself affects latency. Each `Date.now()` call is cheap, but structured logging, span creation, and especially network transmission of trace data consume CPU and memory. On this system, CPU is the bottleneck -- any overhead compounds. Research on OpenTelemetry confirms that enabling tracing can measurably increase latency in high-throughput services, and that synchronous span export is a common mistake that blocks application threads.

**Why it happens:** Developers instrument everything because "more data is better." But on a CPU-constrained system where TTS and LLM compete for cycles, even 2-3% overhead from tracing is meaningful. The current system already has minimal logging (`console.warn` for errors only). Adding structured tracing with span hierarchies, timestamp collection, and data export is a qualitative jump in overhead.

**Warning signs:**
- Measured latency increases after adding instrumentation
- Trace data export causes periodic CPU spikes
- Log file or trace storage grows rapidly (the system has limited disk on root partition)
- Tracing data itself becomes a source of garbage collection pauses in Node.js

**Prevention:**
1. **Use lightweight timing, not full distributed tracing.** For a single-user homelab system, you do not need OpenTelemetry, Jaeger, or span-based tracing. Simple `Date.now()` timestamps at key pipeline stages, stored in-memory and emitted via Socket.IO, are sufficient.
2. **Instrument only the critical path.** Measure: (a) time from user send to first LLM token, (b) time from sentence detection to TTS synthesis complete, (c) time from audio chunk sent to playback start. These 3 measurements capture 90% of perceptible latency. Do not instrument every function call.
3. **Buffer and batch trace data.** Never send trace data synchronously per-event. Buffer timing data per-response and emit a single `chat:latency` event after `chat:done`, containing all timing breakdowns.
4. **Set a retention policy.** Store trace data for the last 100 responses only (in-memory ring buffer). Do not persist to SQLite unless explicitly requested. The root partition is 112GB and already at 52%.
5. **Make tracing opt-in.** Add a `ENABLE_LATENCY_TRACING` environment variable defaulting to `false`. When disabled, all timing code should be no-ops with zero overhead.

**Detection:** Benchmark the system with and without tracing enabled. If overhead exceeds 5% on any measured metric, the tracing implementation needs optimization.

**Which phase should address it:** Latency Tracing phase -- implement as lightweight timestamps first. Only add structured tracing if the simple approach is insufficient for diagnosing issues.

---

### Pitfall 6: Clock Skew Between Frontend and Backend Produces Misleading Latency Numbers

**What goes wrong:** End-to-end latency measurement requires correlating timestamps from the frontend (browser `Date.now()` or `performance.now()`) with backend timestamps (Node.js `Date.now()`). If the browser's system clock differs from the server's clock by even 100ms, the reported "time from message send to first token" is wrong by that amount. Research confirms that browser clock skew is a well-known problem in distributed tracing, with the OpenTelemetry project having open proposals specifically to address client-side clock skew (OTEP #154).

**Why it happens:** In this system, the Home node (192.168.1.50) runs NTP for clock sync, but the user's browser device (phone, laptop) may not be perfectly synced. Even a 200ms offset makes latency measurements unreliable. Developers assume timestamps are comparable across machines and build dashboards showing incorrect data, leading to optimizing the wrong things.

**Warning signs:**
- Negative latency values in traces (client timestamp is ahead of server)
- Latency measurements change dramatically when accessed from different devices
- Metrics don't match perceived experience (system "feels fast" but traces show 500ms latency, or vice versa)
- Latency spikes correlate with nothing (they're actually clock drift events)

**Prevention:**
1. **Measure backend-only latency as the primary metric.** The backend controls all timing: message received -> LLM first token -> sentence detected -> TTS synthesis complete -> audio chunk emitted. These are all server-side timestamps with a single clock.
2. **For frontend latency, use relative timing only.** Measure "time from Socket.IO emit to first `chat:token` received" using `performance.now()` (monotonic, not affected by clock adjustments). This captures network round-trip + server processing without requiring clock sync.
3. **Never subtract a server timestamp from a client timestamp** (or vice versa). Report them separately and let the viewer understand each segment.
4. **If cross-device timing is needed**, implement a simple clock offset estimation: on Socket.IO connect, exchange a timestamp pair (client sends its time, server responds with its time and the client's time). Compute offset. Apply to all subsequent traces. Re-estimate periodically.

**Detection:** Validate that no latency measurement involves subtracting timestamps from different machines. Check for negative values in latency data (indicates clock skew).

**Which phase should address it:** Latency Tracing phase -- the timing architecture must be defined upfront. Mixing client/server timestamps is a design mistake that is hard to fix retroactively.

---

### Pitfall 7: Health Check Dependencies Create Startup Deadlock

**What goes wrong:** The current docker-compose.yml already has health checks and dependency ordering: `jarvis-tts` must be healthy before `jarvis-backend` starts (line 40-41), and `jarvis-backend` must be healthy before `jarvis-frontend` starts (line 67-69). The TTS container has a 300-second `start_period` (line 115) because XTTS model loading is slow on CPU. Adding deeper health checks (e.g., backend checks TTS health, TTS checks model integrity, backend checks LLM endpoint) creates circular dependencies or extends startup time. Research confirms that health checks depending on downstream services cause cascading failures: if TTS is slow to start, backend marks itself unhealthy, frontend never starts.

**Why it happens:** Developers add "deep" health checks that verify all dependencies are working, reasoning that a service isn't truly healthy unless everything it depends on is also healthy. But this creates brittle dependency chains. The current system already has this issue: if `jarvis-tts` takes 6 minutes to load (>300s `start_period`), the entire stack fails to start. Adding more dependency checks to the backend health endpoint (`/api/health`) makes this worse.

**Warning signs:**
- Stack takes longer to start after adding health checks
- `docker compose up` hangs waiting for health checks to pass
- Restarting one container causes cascade of other containers restarting
- Health check flapping (healthy -> unhealthy -> healthy) under normal load

**Prevention:**
1. **Separate liveness from readiness.** The health endpoint should check: "Can this service process requests?" (liveness), NOT "Are all downstream services working?" (readiness). The current backend health check (`wget --spider http://localhost:4000/api/health`) is a liveness check -- keep it that way.
2. **Check dependencies at request time, not health check time.** The existing `checkLocalTTSHealth()` function in tts.ts already caches health for 60 seconds and is called when TTS is actually needed. This is the correct pattern.
3. **Add a separate monitoring endpoint** (e.g., `/api/status`) for detailed dependency status. This endpoint is called by the frontend dashboard, not by Docker health checks.
4. **Increase TTS start_period if adding model validation.** If the health check now validates model loading (not just HTTP response), the 300s start period may not be enough. Consider 600s.
5. **Never add circular dependencies.** If A depends on B being healthy, B must never check A's health.

**Detection:** Monitor container start times. Track how often containers restart due to health check failures. Alert if any container takes more than 5 minutes to become healthy.

**Which phase should address it:** Health Monitoring phase -- design the monitoring architecture to explicitly separate Docker health checks (simple liveness) from application-level health reporting (rich status).

---

### Pitfall 8: Audio Chunk Race Conditions When Adding Parallel Synthesis

**What goes wrong:** The current system assigns chunk indices deterministically at sentence detection time (`audioChunkIndex++` in chat.ts line 267) and drains the TTS queue serially. Parallel synthesis means multiple sentences synthesize concurrently, and audio chunks arrive out of order. The frontend progressive queue already sorts by index (`xttsQueue.sort((a, b) => a.index - b.index)` in progressive-queue.ts line 112), but the playback logic (`playNextXttsChunk`) always takes the first item from the queue. If chunk 3 arrives before chunk 2, chunk 3 plays first because it's at the front of the (sorted) queue -- but only if chunk 2 hasn't arrived yet. The sort pushes chunk 3 after chunk 2's expected position, but since chunk 2 isn't in the queue yet, chunk 3 IS the first item.

**Why it happens:** The current frontend assumes serial delivery (chunks arrive in index order because they're synthesized serially). The sort is a safety net, not the primary ordering mechanism. With parallel synthesis, out-of-order delivery becomes the norm. The playback function needs to wait for the next expected index, not just play whatever's first in the queue.

**Warning signs:**
- Audio sentences play out of order ("good morning" after "how are you")
- Gaps in audio playback followed by rapid sequential playback (waiting chunks arrive, then play back-to-back)
- Progressive playback stutters or pauses between sentences

**Prevention:**
1. **Track expected next index.** Add a `nextExpectedIndex` counter starting at 0. `playNextXttsChunk` only plays if `xttsQueue[0].index === nextExpectedIndex`. If not, wait for the correct chunk to arrive.
2. **Add a timeout for missing chunks.** If the expected chunk hasn't arrived within 10 seconds, skip it (it may have failed synthesis) and advance to the next available index. Log the skip.
3. **Consider a "ready buffer" pattern.** Accumulate chunks until you have N consecutive chunks from the expected index, then start playback. For 2-3 parallel synthesis workers, buffering 2 chunks before starting ensures smooth playback.
4. **Emit chunk index with the audio_done event** so the frontend knows the total expected count and can detect missing chunks.
5. **Signal synthesis failure per-chunk** from the backend. Currently, if `synthesizeSentenceToBuffer` returns null (line 231-238 of chat.ts), no `chat:audio_chunk` event is emitted. The frontend never knows that chunk was attempted and failed. Add a `chat:audio_skip` event for failed chunks so the frontend can advance its expected index.

**Detection:** Track chunk indices received vs. expected. Log out-of-order arrivals. Log gaps where expected chunks never arrive.

**Which phase should address it:** Parallel TTS phase -- the ordering logic must be redesigned BEFORE enabling parallel synthesis. Adding parallelism without fixing the ordering guarantee will cause immediate playback issues.

---

### Pitfall 9: Cache Pre-Warming Blocks Container Startup and Delays First Request

**What goes wrong:** Pre-warming the TTS sentence cache (currently a 50-entry LRU in tts.ts, lines 241-267) at startup means synthesizing common phrases ("Hello!", "How can I help?", "Sure, let me check.") before accepting requests. Each XTTS synthesis takes 3-10 seconds on CPU. Pre-warming 10 phrases takes 30-100 seconds of additional startup time. The backend container already depends on TTS being healthy (docker-compose depends_on), and the TTS container has a 300-second start period. Adding 100 seconds of cache warming on top means the full stack takes 6-7 minutes to start. Research confirms that cache warming blocking startup is an anti-pattern in Node.js, especially when the data changes or the warming set is wrong.

**Why it happens:** Developers add cache warming to eliminate the "cold first request" latency. But on this system, the "cold first request" is a user speaking -- which is an interactive event that happens unpredictably. If the user sends a message 10 seconds after startup, warming isn't complete yet and they still get cold latency. If they send a message 10 minutes after startup, the warmed cache is serving phrases that may not match what the LLM actually generates.

**Warning signs:**
- Container startup time increases by the warming duration
- `docker compose up` takes 7+ minutes instead of 5 minutes
- Warmed phrases don't match actual LLM output (cache miss rate remains high despite warming)
- Memory usage spikes during startup (50 WAV buffers * ~100KB each = 5MB, which is fine, but the CPU load during warming is the real issue)

**Prevention:**
1. **Warm asynchronously, never block startup.** Start accepting requests immediately. Run cache warming in the background with `setTimeout(() => warmCache(), 5000)` after the server is listening.
2. **Warm lazily on first TTS request.** The first time a user enables voice mode, warm the top 10 phrases in the background while serving the first request normally.
3. **Warm from actual usage data.** Instead of guessing common phrases, record which phrases hit the cache in production. On restart, warm those exact phrases. Store the warming set in a small JSON file, not hardcoded.
4. **Rate-limit warming requests.** Send warming synthesis requests with 2-second gaps to avoid overloading the TTS container during its own startup.
5. **Set warming as completely optional.** The 50-entry LRU cache (tts.ts) already fills naturally during use. For a single-user system, after 10-15 messages with voice mode, the cache is effectively warm. Explicit warming may not provide meaningful benefit.

**Detection:** Track cache hit rate over time. Compare hit rate with and without pre-warming. If natural cache filling achieves >60% hit rate within 5 minutes of use, pre-warming adds minimal value.

**Which phase should address it:** Cache Pre-Warming phase -- the phase should begin with cache hit rate analysis of the existing LRU cache before investing in warming infrastructure. If the natural cache is effective, skip warming entirely.

---

### Pitfall 10: Web Worker Audio Processing Fails Because AudioContext Is Unavailable

**What goes wrong:** Attempting to offload audio decoding to a Web Worker to free the main thread runs into a fundamental API limitation: `AudioContext` is not available in Web Workers. The `decodeAudioData()` method exists on `BaseAudioContext`, which includes both `AudioContext` and `OfflineAudioContext`, but neither can be constructed in a Worker context as of 2025-2026. There is an open spec issue (#16) on the Web Audio API repository requesting AudioContext in Workers, filed in 2013, still unresolved. The progressive-queue.ts already uses the main-thread AudioContext (lines 17-35) with a singleton pattern -- moving decoding to a Worker requires a fundamentally different architecture.

**Why it happens:** Developers see "decode audio in a worker for better performance" in articles and assume the Web Audio API supports it. It does not. The `AudioWorklet` API allows custom audio processing in a separate thread, but it processes already-decoded PCM data, not encoded audio files. The only way to decode audio in a Worker is to use a WASM-based decoder (e.g., FFmpeg compiled to WASM) or the emerging `WebCodecs` `AudioDecoder` API. But `AudioDecoder` is not yet supported in Safari (only in Safari Technology Preview as of May 2025), and the WASM approach is ~2x slower than native `decodeAudioData()`.

**Warning signs:**
- `ReferenceError: AudioContext is not defined` in Worker context
- Worker setup code that imports Web Audio API interfaces
- Transferable object errors when trying to send AudioBuffer between threads
- Architecture diagrams showing "decode in worker, play on main thread"

**Prevention:**
1. **Keep audio decoding on the main thread.** The current approach (progressive-queue.ts) is correct. `decodeAudioData()` is already asynchronous and non-blocking. For WAV chunks of 100-300KB, decoding takes <5ms on any modern device. Moving to a Worker adds complexity with no meaningful performance gain.
2. **If main thread is truly blocked**, the bottleneck is not audio decoding. Profile first. The RAF-batched token buffer (PERF-08 in useChatSocket.ts) already prevents token processing from blocking audio. If the main thread is sluggish, the issue is React re-renders or Zustand state updates, not audio decoding.
3. **If you must process audio off-thread**, use `AudioWorklet` for custom DSP (e.g., volume normalization, audio visualization). AudioWorklet runs in a real-time thread and processes decoded PCM streams. This is appropriate for audio effects, not for decoding.
4. **Wait for WebCodecs AudioDecoder browser support** before attempting Worker-based decoding. When Safari supports `AudioDecoder` in production builds, revisit this. Until then, the complexity is not justified.
5. **Use `postMessage` with transferable `ArrayBuffer`** to move raw audio data (not decoded AudioBuffer) between threads if needed for preprocessing (e.g., Opus decoding in WASM worker). Transfer the decoded PCM back to the main thread for `AudioContext` playback.

**Detection:** If implementing Worker-based audio, test on all target browsers immediately. A "works in Chrome" implementation that fails in Safari/Firefox is worse than no implementation.

**Which phase should address it:** Web Worker Audio phase -- this phase may be unnecessary. The current main-thread decoding is fast enough for WAV chunks. The phase should start with profiling to confirm audio decoding is actually a bottleneck before investing in Worker architecture.

---

## Minor Pitfalls

Mistakes that cause annoyance or minor technical debt but are fixable.

---

### Pitfall 11: TTS Fallback Timeout Too Short Triggers Under Normal Load

**What goes wrong:** Setting the XTTS fallback timeout too aggressively (e.g., 5 seconds) causes the system to switch to Piper during normal operation. XTTS CPU synthesis is inherently variable: simple sentences ("Hello!") take 3 seconds, complex sentences with technical terms take 10-15 seconds. The current `SENTENCE_TTS_TIMEOUT` of 20 seconds (tts.ts line 276) already accounts for this, but a fallback mechanism might use a shorter timeout ("if XTTS doesn't respond in 5s, use Piper") that triggers on perfectly healthy but slow synthesis.

**Prevention:** Use the TTS health check (`checkLocalTTSHealth()`) as the fallback trigger, not synthesis timeout. Only fall back when the health endpoint is unreachable, not when synthesis is slow. If a timeout-based fallback is used, set it to at least 30 seconds for CPU inference.

**Which phase should address it:** TTS Fallback phase.

---

### Pitfall 12: Opus Encoding Overhead Negates Transfer Savings on Local Network

**What goes wrong:** Encoding WAV to Opus requires CPU cycles on the backend. For a 3-second sentence WAV (~265KB at 22050Hz mono 16-bit), Opus encoding adds 50-200ms of CPU time. The encoded Opus file is ~15-30KB (10x smaller). But on a local gigabit network (192.168.1.x), the WAV transfer takes <3ms. The encoding overhead (50-200ms) is 15-60x larger than the transfer savings (~2.5ms). Net result: Opus makes the pipeline slower, not faster.

**Prevention:** Calculate the breakeven point. Opus encoding is beneficial only when: `encoding_time < (wav_transfer_time - opus_transfer_time)`. On a local network, this equation never favors Opus. Opus makes sense only for remote access (e.g., via Twingate VPN with limited bandwidth). Consider making Opus encoding conditional on network latency, not default.

**Which phase should address it:** Opus Codec phase -- include a network bandwidth analysis step before implementing encoding.

---

### Pitfall 13: Sentence Accumulator Edge Cases With Summarization Content

**What goes wrong:** The `SentenceAccumulator` (sentence-stream.ts) uses a 20-character minimum sentence length and detects boundaries at `.!?` followed by whitespace. When the LLM generates a conversation summary (for the sliding window), the summary may contain abbreviated text ("User asked about VM 103. Admin confirmed. Restart was successful.") where each "sentence" is exactly at or near the minimum length. This produces many small TTS synthesis requests, each with high per-request overhead from the XTTS model, and the audio sounds choppy due to frequent starts and stops.

**Prevention:** Increase the minimum sentence length for TTS (not for display) to 40-50 characters, or batch consecutive short sentences into a single TTS request. Alternatively, summarization should produce flowing prose, not telegraphic bullet points.

**Which phase should address it:** Conversation Windowing phase -- the summary format should be designed with TTS compatibility in mind.

---

### Pitfall 14: Health Monitoring Storage Bloat From Trace and Metrics Data

**What goes wrong:** Persistent storage of latency traces, health check history, and metrics fills the root partition. The Home node's root disk is 112GB with 52% usage (58GB free). If each response generates 1KB of trace data, and there are 50 responses/day, that's only 50KB/day -- negligible. But if health checks run every 30 seconds and store results, that's 2,880 records/day. Over months without cleanup, the SQLite database or log files grow silently.

**Prevention:** Use in-memory ring buffers for recent metrics (last 100 responses, last 1000 health checks). Only persist summary statistics (daily averages, P95 latencies) to SQLite. Set log rotation on trace files. Add a cron job or timer to clean old metrics.

**Which phase should address it:** Health Monitoring phase -- define retention policy as part of the design, not an afterthought.

---

### Pitfall 15: Fallback Cache Invalidation When Switching TTS Engines

**What goes wrong:** The sentence cache (tts.ts, `sentenceCache` Map) stores `CachedAudio` entries with a `contentType` and `provider` field. If the system falls back from XTTS to Piper, cached entries are still tagged as `provider: 'local'` with `contentType: 'audio/wav'`. When XTTS recovers and the system switches back, the cache may still contain Piper-generated audio. If both engines produce WAV at different sample rates (XTTS: 22050Hz or 24000Hz, Piper: varies by model), the cached Piper audio will play back at the wrong speed when XTTS is active, or the AudioContext may reject it due to sample rate mismatch.

**Prevention:** Include the TTS engine identifier in the cache key. When the active engine changes, either invalidate the entire cache or tag entries with the engine that produced them and only serve cache hits from the currently active engine.

**Which phase should address it:** TTS Fallback phase -- cache invalidation must be part of the fallback design.

---

### Pitfall 16: Conversation Window Token Counter Diverges From Actual Provider Usage

**What goes wrong:** Client-side token counting (using `tiktoken` or approximation) for window management diverges from the actual token count the LLM provider charges for. Claude uses a BPE tokenizer with specific vocabulary; Qwen uses a different tokenizer. The `chatHistoryLimit` is currently message-count-based (20 messages), which is a proxy for token count but not accurate. Switching to token-based windowing requires per-provider tokenizer implementations.

**Prevention:** For Qwen (local), query the tokenizer endpoint or use the model's tokenizer directly. For Claude, use the official `tiktoken` with `cl100k_base` encoding. Always leave 25% headroom: if the context window is 4096 tokens (Qwen), target 3072 tokens for history. The current Qwen configuration already has a separate `qwenHistoryLimit` of 10 messages (config.ts line 52), which is conservative enough that token overflow is unlikely.

**Which phase should address it:** Conversation Windowing phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| TTS Fallback | Voice mismatch between engines (Pitfall 1) | Critical | Never mix engines within a response; test voice similarity pre-deploy |
| TTS Fallback | Timeout too short triggers fallback during normal XTTS load (Pitfall 11) | Minor | Use health check failure, not timeout, as fallback trigger |
| TTS Fallback | Cache entries from wrong engine served (Pitfall 15) | Minor | Include engine ID in cache key |
| Parallel TTS | CPU starvation of LLM inference (Pitfall 2) | Critical | Benchmark before committing; limit to 2 concurrent max |
| Parallel TTS | Audio plays out of order (Pitfall 8) | Moderate | Track expected index; add audio_skip event; buffer before play |
| Opus Codec | Safari decodeAudioData failure (Pitfall 3) | Critical | Keep WAV for decode; use Opus only for transfer if at all |
| Opus Codec | Encoding overhead exceeds transfer savings on LAN (Pitfall 12) | Minor | Calculate breakeven; likely unnecessary for local network |
| Conversation Window | Summary loses critical context for tool calls (Pitfall 4) | Critical | Extract structured facts; don't summarize tool call data |
| Conversation Window | Token counter inaccuracy across providers (Pitfall 16) | Minor | Per-provider tokenizer; 25% headroom |
| Conversation Window | Short summary sentences cause choppy TTS (Pitfall 13) | Minor | Batch short sentences; design summary for TTS compatibility |
| Latency Tracing | Overhead slows the system (Pitfall 5) | Moderate | Lightweight timestamps only; batch emit; make opt-in |
| Latency Tracing | Clock skew produces wrong numbers (Pitfall 6) | Moderate | Measure server-side only; use performance.now() for frontend |
| Health Monitoring | Health checks create startup deadlock (Pitfall 7) | Moderate | Separate liveness from readiness; no circular deps |
| Health Monitoring | Metrics storage bloat (Pitfall 14) | Minor | In-memory ring buffers; daily summary persistence only |
| Cache Pre-Warming | Blocks startup, delays readiness (Pitfall 9) | Moderate | Warm async after server starts; analyze cache hit rates first |
| Web Worker Audio | AudioContext unavailable in Workers (Pitfall 10) | Moderate | Keep decode on main thread; profile before assuming bottleneck |

---

## Integration Pitfalls: Interaction Between Features

These pitfalls emerge from the interaction between multiple optimization features, not from any single feature in isolation.

---

### Integration Pitfall A: Parallel TTS + Fallback = Complex State Machine

**What goes wrong:** When parallel TTS is running 2 synthesis requests and XTTS becomes unhealthy, the fallback logic must handle: (1) the in-flight XTTS requests that may or may not complete, (2) switching to Piper for remaining sentences, (3) deciding whether to wait for in-flight XTTS or cancel them, (4) maintaining audio ordering across the engine transition.

**Prevention:** Design the fallback as a response-level decision, not a per-request decision. At the start of each response, check XTTS health. If healthy, use XTTS for the entire response (with timeouts for individual sentences that skip silently). If unhealthy, use Piper for the entire response. Never switch engines mid-response.

---

### Integration Pitfall B: Conversation Window + Latency Tracing = Feedback Loop

**What goes wrong:** Latency tracing reveals that summarization adds 2-3 seconds of overhead per conversation turn (LLM generating the summary). Developers then try to optimize the summary step, adding caching of summaries, batching summarization, etc. This creates complexity that itself needs tracing, leading to a spiraling instrumentation-optimization loop.

**Prevention:** Define acceptable latency budgets upfront. If summarization adds 2 seconds and the total pipeline is 15 seconds, that's 13% overhead -- probably acceptable. Set thresholds and only optimize when exceeded, not continuously.

---

### Integration Pitfall C: Opus + Web Workers = Wrong Architecture

**What goes wrong:** A design that says "decode Opus in a Web Worker, then play on main thread" hits both limitations: AudioContext isn't available in Workers, and WASM-based Opus decoding is 2x slower than native. The result is slower than the current approach (native WAV decoding on main thread).

**Prevention:** Choose one codec strategy. Either: (a) send WAV, decode natively on main thread (simplest, fastest on LAN), or (b) send Opus, decode natively using `decodeAudioData` on main thread (if browser supports it). Never route through a Worker for audio decoding.

---

### Integration Pitfall D: Cache Pre-Warming + Parallel TTS = Startup Resource Contention

**What goes wrong:** Cache warming sends multiple TTS synthesis requests during startup. If parallel TTS is enabled, warming might use the full parallelism budget, causing the TTS container to be fully loaded during startup. If a user sends a message during this window, their request is either queued behind warming requests or the warming gets cancelled but has wasted CPU.

**Prevention:** Cache warming (if implemented) should use a single serial request with lower priority than user requests. Never use the parallel synthesis path for warming.

---

## Sources

- [Inferless: 12 Best Open-Source TTS Models Compared (2025)](https://www.inferless.com/learn/comparing-different-text-to-speech---tts--models-part-2) -- XTTS vs Piper quality comparison
- [WebKit Bug 226922: Safari 15 breaks all Web Audio content using WebM Opus](https://bugs.webkit.org/show_bug.cgi?id=226922) -- Safari Opus decoding failures
- [WebKit Bug 238546: WebM Opus support still inconsistent in Safari 15.4](https://bugs.webkit.org/show_bug.cgi?id=238546)
- [WebKit Bug 245428: Safari 16 cannot play WebM Opus from blob URL](https://bugs.webkit.org/show_bug.cgi?id=245428)
- [Chrome Status: OPUS codec support in WebAudio decodeAudioData()](https://chromestatus.com/feature/5649634416394240) -- Chrome Opus support
- [Interop Issue #484: WebM Opus audio codec](https://github.com/web-platform-tests/interop/issues/484) -- Cross-browser Opus standardization
- [W3C WebCodecs #366: Decoding mp3/ogg/aac to fix Web Audio API shortcomings](https://github.com/w3c/webcodecs/issues/366)
- [WebAudio/web-audio-api Issue #16: Enable AudioContext in Workers](https://github.com/WebAudio/web-audio-api/issues/16) -- AudioContext in Workers (open since 2013)
- [HuggingFace XTTS-v2 Discussion #107: CUDA Assertion Errors with Concurrent Requests](https://huggingface.co/coqui/XTTS-v2/discussions/107) -- XTTS concurrency issues
- [coqui-ai/TTS Issue #3976: XTTS RAM usage during inference](https://github.com/coqui-ai/TTS/issues/3976) -- XTTS memory consumption
- [OpenTelemetry OTEP #154: Reduce clock-skew issues in client-side traces](https://github.com/open-telemetry/oteps/issues/154) -- Clock skew problem definition
- [OpenTelemetry JS Issue #1728: Add clock skew compensation](https://github.com/open-telemetry/opentelemetry-js/issues/1728)
- [Chroma Research: Context Rot](https://research.trychroma.com/context-rot) -- LLM context window degradation
- [Agenta: Top techniques to Manage Context Lengths in LLMs](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms) -- Sliding window and summarization patterns
- [Getmaxim: Context Window Management Strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) -- Lost in the middle effect, token counting
- [OpenAI Community: TTS-HD failing with multiple parallel requests](https://community.openai.com/t/tts-hd-failing-with-multiple-parallel-requests/1284908) -- Parallel TTS failure patterns
- [Deepgram Discussion #791: TTS concurrency limit](https://github.com/orgs/deepgram/discussions/791) -- TTS rate limiting patterns
- [Aerospike: Cache Warming Explained - Pitfalls and Alternatives](https://aerospike.com/blog/cache-warming-explained) -- Cache warming anti-patterns
- [Last9: Docker Compose Health Checks Guide](https://last9.io/blog/docker-compose-health-checks/) -- Health check timing and cascading failures
- [Andrew Klotz: API Health checks for cascading failure](https://klotzandrew.com/blog/api-health-checks-for-cascading-or-cascading-failure/) -- Liveness vs. readiness separation

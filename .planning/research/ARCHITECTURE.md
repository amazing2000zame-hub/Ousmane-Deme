# Architecture Patterns: v1.5 Optimization & Latency Reduction

**Domain:** AI assistant voice pipeline optimization (existing system)
**Researched:** 2026-01-27
**Overall confidence:** HIGH (based on direct codebase reading + verified research)

---

## Current Architecture (v1.4 Baseline)

Understanding the existing system is critical before designing integration points. All v1.5 changes must fit within the modular monolith pattern already established.

### Component Map

```
+--------------------------+     +---------------------------+
|   jarvis-frontend        |     |   jarvis-backend          |
|   (Docker: nginx:80)     |     |   (Docker: Node.js:4000)  |
|   React 19 + Vite 6      |     |   Express 5 + Socket.IO   |
|                          |     |                           |
|   stores/                |     |   ai/                     |
|     chat.ts (Zustand)    |     |     tts.ts                |
|     voice.ts             |     |     sentence-stream.ts    |
|   audio/                 |     |     text-cleaner.ts       |
|     progressive-queue.ts |     |     providers/             |
|   hooks/                 |     |       claude-provider.ts  |
|     useChatSocket.ts     |     |       qwen-provider.ts   |
|     useVoice.ts          |     |   realtime/               |
|                          |     |     chat.ts               |
+-------------|------------+     |     socket.ts             |
              |                  |   db/                     |
     Socket.IO (4 namespaces)    |     memory.ts             |
              |                  |     memories.ts           |
              |                  |   api/                    |
              v                  |     health.ts             |
+---------------------------+    |     tts.ts (REST)         |
|   jarvis-tts              |    +-------------|-------------+
|   (Docker: Python:5050)   |                  |
|   XTTS v2 + FastAPI       |        HTTP POST /synthesize
|   CPU inference            |                  |
|   24kHz WAV output         |                  v
+---------------------------+    +---------------------------+
                                 |   llama-server            |
                                 |   (systemd: port 8080)    |
                                 |   Qwen 2.5 7B Q4_K_M      |
                                 |   OpenAI-compatible API    |
                                 +---------------------------+
```

### Current Voice Data Flow (Serial)

```
User sends message (voiceMode=true)
    |
    v
[1] chat.ts: routeMessage() -> provider.chat() starts streaming
    |
    v
[2] onTextDelta callback: tokens accumulate in SentenceAccumulator
    |
    v
[3] SentenceAccumulator.drain(): detects sentence boundary (>20 chars + punct + whitespace)
    |
    v
[4] onSentence callback: cleanTextForSpeech() -> push to ttsQueue[]
    |
    v
[5] drainTtsQueue(): SERIAL processing, ONE request at a time
    |  synthesizeSentenceToBuffer() -> LRU cache check -> synthesizeSpeech()
    |  -> HTTP POST to jarvis-tts:5050/synthesize
    |  -> Collect stream into Buffer (WAV, ~300KB-1.2MB per sentence)
    |
    v
[6] socket.emit('chat:audio_chunk', { buffer, index, contentType })
    |  Binary over Socket.IO (WAV data)
    |
    v
[7] Frontend: useChatSocket.ts onAudioChunk -> queueAudioChunk()
    |
    v
[8] progressive-queue.ts: sort by index, decodeAudioData(), play via AudioContext
    |  SERIAL: source.onended -> playNextXttsChunk()
    |
    v
[9] Audio plays through speakers
```

**Current bottlenecks identified from code:**
- Step 5: Serial TTS -- each sentence waits for the previous one to complete (8-15s per sentence on CPU)
- Step 5: 20s timeout per sentence, no fallback engine
- Step 6: WAV transfer over Socket.IO -- 300KB-1.2MB per sentence chunk
- Step 8: `decodeAudioData()` runs on main thread, can cause jank during streaming

---

## Question 1: Where Does Piper TTS Fit?

### Recommendation: Separate Docker Container + Backend Router

**Confidence: HIGH** (based on Piper's HTTP API compatibility and existing architecture patterns)

Piper should run as a **separate Docker container** alongside the existing XTTS container. The backend `tts.ts` module becomes a **TTS router** that chooses between engines.

#### Why Separate Container (Not Sidecar, Not Same Container)

1. **Different runtimes**: XTTS requires Python 3.11 + PyTorch + CUDA/CPU libs (~4GB image). Piper is a lightweight C++ binary with ONNX runtime (~200MB image). Merging them would bloat the XTTS image and complicate builds.

2. **Independent scaling**: Piper can be resource-limited differently (needs ~1 CPU, ~256MB RAM vs XTTS at 4-14 CPUs, 4-16GB RAM).

3. **Independent health**: If XTTS OOM-crashes, Piper continues serving. If Piper has issues, XTTS is unaffected. This is the whole point of the fallback architecture.

4. **Existing pattern**: The project already uses separate containers (`jarvis-backend`, `jarvis-frontend`, `jarvis-tts`). Adding `jarvis-piper` follows the same pattern.

#### Docker Compose Addition

```yaml
# New service in /root/docker-compose.yml
jarvis-piper:
  image: rhasspy/wyoming-piper:latest  # Official image with HTTP API on port 5000
  container_name: jarvis-piper
  restart: unless-stopped
  security_opt:
    - apparmor:unconfined
  volumes:
    - piper-data:/data
  command: --voice en_US-lessac-medium
  networks:
    - jarvis-net
  deploy:
    resources:
      limits:
        cpus: "2"
        memory: 512M
      reservations:
        cpus: "0.5"
        memory: 128M
  healthcheck:
    test: ["CMD", "curl", "-sf", "http://localhost:5000/"]
    interval: 15s
    timeout: 3s
    retries: 3
    start_period: 30s
  logging:
    driver: json-file
    options:
      max-size: "5m"
      max-file: "3"

volumes:
  piper-data:
    driver: local
```

**Key differences from XTTS container:**
- `start_period: 30s` (Piper loads in <10s vs XTTS 300s)
- `cpus: "2"`, `memory: 512M` (vs XTTS at 14 CPUs, 16GB)
- No port exposure (internal network only)
- The `rhasspy/wyoming-piper` image exposes HTTP on port 5000 when run with the `--voice` flag

#### Backend TTS Router Changes

**File: `/root/jarvis-backend/src/ai/tts.ts`**

The current `tts.ts` has a provider priority system (`local > elevenlabs > openai`) but only uses local XTTS in practice. The routing logic needs to become a **timeout-based fallback**:

```
synthesizeSentenceToBuffer(text)
    |
    [1] Check LRU sentence cache -> HIT? return cached audio
    |
    [2] Try XTTS (primary, best quality)
    |   Timeout: 3 seconds (configurable via TTS_XTTS_TIMEOUT_MS)
    |   Success? -> encode to Opus, cache result, return
    |
    [3] XTTS timeout/failure -> Try Piper (fallback, faster)
    |   Timeout: 2 seconds (configurable via TTS_PIPER_TIMEOUT_MS)
    |   Success? -> encode to Opus, cache result, return
    |
    [4] Both failed -> return null (skip audio for this sentence)
```

**New config entries in `/root/jarvis-backend/src/config.ts`:**

```typescript
// Piper TTS fallback
localPiperEndpoint: process.env.LOCAL_PIPER_ENDPOINT || 'http://jarvis-piper:5000',
ttsXttsTimeoutMs: parseInt(process.env.TTS_XTTS_TIMEOUT_MS || '3000', 10),
ttsPiperTimeoutMs: parseInt(process.env.TTS_PIPER_TIMEOUT_MS || '2000', 10),
```

**New function in `tts.ts` -- `synthesizePiper()`:**

Piper's HTTP API accepts a POST request with text in the body and returns WAV audio:

```
POST http://jarvis-piper:5000/
Content-Type: application/json
Body: { "text": "sentence text" }
Response: audio/wav (16-bit PCM, 22050Hz sample rate)
```

The function follows the same pattern as `synthesizeLocal()` (line 99 of `tts.ts`), returning a `TTSResult` with `stream`, `contentType`, and `provider`.

**Integration point:** Modify `synthesizeSentenceToBuffer()` (line ~285 of `tts.ts`) to wrap the existing `synthesizeSpeech()` call in a race with the XTTS timeout, then fall back to Piper.

#### Files to Modify
| File | Change |
|------|--------|
| `/root/docker-compose.yml` | Add `jarvis-piper` service, add `piper-data` volume |
| `/root/jarvis-backend/src/config.ts` | Add Piper endpoint + timeout configs |
| `/root/jarvis-backend/src/ai/tts.ts` | Add `synthesizePiper()`, modify `synthesizeSentenceToBuffer()` with timeout fallback, add Piper health check |

#### Files to Create
| File | Purpose |
|------|---------|
| None | Piper uses official Docker image, no custom code needed |

---

## Question 2: How Does Parallel TTS Change chat.ts Flow?

### Recommendation: Worker Pool with Concurrency Limit + Index-Based Reordering

**Confidence: HIGH** (direct code analysis of current serial queue)

#### Current Flow (Serial)

In `/root/jarvis-backend/src/realtime/chat.ts` lines 220-249:

```
ttsQueue: { text, index }[]   <-- simple array queue
drainTtsQueue():
  while (ttsQueue.length > 0):
    item = ttsQueue.shift()
    audio = await synthesizeSentenceToBuffer(item.text)  <-- BLOCKS here 8-15s
    socket.emit('chat:audio_chunk', { index, audio })
```

One sentence at a time. If sentence 1 takes 12s, sentence 2 waits even if it could have started.

#### New Flow (Parallel with Bounded Concurrency)

Replace the serial queue with a **bounded concurrent worker pool**:

```
ttsQueue: { text, index }[]
activeWorkers: 0
MAX_CONCURRENT_TTS: 2  (configurable via config.maxConcurrentTts)

drainTtsQueue():
  while (ttsQueue.length > 0 AND activeWorkers < MAX_CONCURRENT_TTS):
    item = ttsQueue.shift()
    activeWorkers++
    // Fire-and-forget (no await), each worker completes independently
    processTtsItem(item).finally(() => {
      activeWorkers--
      drainTtsQueue()  // Trigger next item when a slot frees up
    })

async processTtsItem(item):
  audio = await synthesizeSentenceToBuffer(item.text)
  if (audio && !abortController.signal.aborted):
    socket.emit('chat:audio_chunk', { index: item.index, audio })
```

**Key insight:** The frontend `progressive-queue.ts` already handles out-of-order arrival via `xttsQueue.sort((a, b) => a.index - b.index)` on line 112. The `index` field is assigned at sentence detection time (line 267 of chat.ts: `audioChunkIndex++`), so chunks arriving out-of-order are automatically sorted before playback. The frontend plays them sequentially (`source.onended -> playNextXttsChunk()`).

**No frontend changes needed for parallel TTS.** The backend change is entirely within the `drainTtsQueue()` function in `chat.ts`.

#### Why MAX_CONCURRENT_TTS = 2

The Home node has 20 threads (Intel i5-13500HX). Current allocation:
- llama-server: 16 threads (configured in jarvis-api.service)
- XTTS container: up to 14 CPUs (Docker resource limits)
- These overlap and compete for the same physical cores

Running 3+ concurrent XTTS requests would saturate the CPU and slow LLM token generation (which is already the first bottleneck in the pipeline). 2 concurrent requests provides ~40% speedup over serial (pipeline overlap) without starving the LLM.

With Piper fallback, the dynamic is even better: if XTTS times out at 3s, Piper responds in <100ms. So in practice, the 2 worker slots cycle much faster once Piper kicks in.

#### Updated Data Flow (Parallel)

```
LLM stream produces tokens
    |
SentenceAccumulator detects boundary
    |
    v
ttsQueue: [S1, S2, S3]    <-- sentences queued as detected
    |
drainTtsQueue():
    |
    +-- Worker 1: synthesize S1 (XTTS, 8s)
    +-- Worker 2: synthesize S2 (XTTS timeout 3s -> Piper 0.1s)
    |
    S2 finishes first -> emit chunk(index=1)  [out of order!]
    S1 finishes second -> emit chunk(index=0)
    |
    Worker freed -> Worker 1: synthesize S3
    |
Frontend receives:
    chunk(index=1) first -> queued
    chunk(index=0) second -> sorted, plays S1 first (correct order)
    chunk(index=2) arrives -> queued, plays after S1 finishes
```

#### Completion Detection Update

The current `ttsStreamFinished` flag and `audio_done` signal need adjustment. Currently in `onDone` (line 347):

```typescript
sentenceAccumulator.flush();
ttsStreamFinished = true;
if (!ttsProcessing && ttsQueue.length === 0) {
  socket.emit('chat:audio_done', { sessionId, totalChunks: audioChunkIndex });
}
```

With parallel workers, the check should be: `activeWorkers === 0 && ttsQueue.length === 0` instead of `!ttsProcessing`. Each worker, upon completing, checks this condition.

#### Files to Modify
| File | Change |
|------|--------|
| `/root/jarvis-backend/src/realtime/chat.ts` | Replace serial `drainTtsQueue()` with bounded parallel pool, update completion detection |
| `/root/jarvis-backend/src/config.ts` | Add `maxConcurrentTts: 2` config |

#### Files to Create
None. The change is localized to the existing `drainTtsQueue()` closure in `chat.ts`.

---

## Question 3: Where Does Opus Encoding Happen?

### Recommendation: Backend-Side Encoding via ffmpeg Subprocess

**Confidence: HIGH** (verified: ffmpeg supports WAV->Opus piped streaming; Chrome/Firefox `decodeAudioData()` supports Ogg/Opus natively)

#### Architecture Decision

Opus encoding should happen **in the backend** (`jarvis-backend`), not in the TTS container. Reasons:

1. **Single encoding point**: Whether audio comes from XTTS (24kHz) or Piper (22050Hz), the encoding path is identical. Backend encodes after receiving WAV from either engine, normalizing the output format.

2. **No TTS container modifications**: XTTS and Piper continue outputting WAV. The encoding is a post-processing step owned by the backend.

3. **Frontend simplicity**: The frontend already calls `ctx.decodeAudioData()` (line 193 of `progressive-queue.ts`) which natively supports Ogg/Opus in Chrome and Firefox. No new decoder libraries needed.

#### Encoding Flow

```
synthesizeSentenceToBuffer(text)
    |
    v
  [TTS engine returns WAV Buffer]
    |
    v
  encodeToOpus(wavBuffer): Promise<Buffer>
    |
    spawn('ffmpeg', [
      '-i', 'pipe:0',           // WAV input from stdin
      '-c:a', 'libopus',        // Encode to Opus
      '-b:a', '48k',            // 48kbps (voice optimized, ~8-10x smaller than WAV)
      '-application', 'voip',   // Optimize for speech (lower latency than 'audio')
      '-vbr', 'on',             // Variable bitrate for better quality
      '-f', 'ogg',              // Ogg container (required for decodeAudioData)
      'pipe:1'                  // Output to stdout
    ])
    |
    pipe wavBuffer -> ffmpeg stdin
    collect ffmpeg stdout -> opusBuffer
    |
    v
  Return { buffer: opusBuffer, contentType: 'audio/ogg; codecs=opus' }
```

**Size reduction example (verified from XTTS output characteristics):**
- XTTS WAV: 24kHz, 16-bit mono, 1.5s sentence = ~72KB
- Piper WAV: 22050Hz, 16-bit mono, 1.5s sentence = ~66KB
- Opus at 48kbps: ~9KB for 1.5s
- **~8x reduction** in Socket.IO transfer size

#### ffmpeg Dependency in Backend Container

ffmpeg must be available in the `jarvis-backend` Docker container. Add to the Dockerfile:

```dockerfile
# In /root/jarvis-backend/Dockerfile, add before npm install
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
```

This adds ~30MB to the backend image. The alternative (native Node.js Opus via `@discordjs/opus` or `opusscript`) requires compiling native addons in the container, which is more fragile. ffmpeg is battle-tested, already installed on the host, and handles the full WAV->Ogg/Opus pipeline in one step.

#### Frontend Compatibility

The frontend `progressive-queue.ts` currently calls:
```typescript
const audioBuffer = await ctx.decodeAudioData(chunk.buffer.slice(0));  // line 193
```

This method natively decodes Ogg/Opus in:
- **Chrome 70+**: Full Opus support in `decodeAudioData()` (tracked at chromestatus.com)
- **Firefox**: Full Opus in Ogg support
- **Safari 15+**: Opus support in `decodeAudioData()` via Ogg container

**No frontend code changes needed for Opus decoding.** The `contentType` field in the `chat:audio_chunk` event changes from `'audio/wav'` to `'audio/ogg; codecs=opus'`, but the frontend does not branch on `contentType` -- it passes the buffer directly to `decodeAudioData()` regardless.

#### Cache Implications

The backend LRU cache (`sentenceCache` Map in `tts.ts`) currently stores WAV buffers. After Opus encoding, it stores Opus buffers instead. Benefits:
- Smaller per-entry footprint (~9KB vs ~72KB)
- More effective cache (200 entries = ~1.8MB vs ~14.4MB)
- Cache hits skip both TTS synthesis AND encoding

The encoding should happen **before** caching, so cached entries are already Opus-encoded.

#### Files to Modify
| File | Change |
|------|--------|
| `/root/jarvis-backend/Dockerfile` | Add `ffmpeg` package installation |
| `/root/jarvis-backend/src/ai/tts.ts` | Add `encodeToOpus()` call in `synthesizeSentenceToBuffer()` after TTS, change `contentType` to `'audio/ogg; codecs=opus'` |

#### Files to Create
| File | Purpose |
|------|---------|
| `/root/jarvis-backend/src/ai/opus-encoder.ts` | Encapsulate `ffmpeg` spawn + pipe logic for WAV->Opus conversion |

---

## Question 4: Conversation Sliding Window Integration

### Recommendation: Backend-Only Change in chat.ts History Loading + Background Summarization

**Confidence: HIGH** (direct code analysis of current history management)

#### Current System

In `/root/jarvis-backend/src/realtime/chat.ts` lines 132-149:

```typescript
// PERF-014: Load conversation history (cached in-memory after first DB read)
let history: Array<{ role: string; content: string }> = [];
const cachedHistory = sessionHistoryCache.get(sessionId);
if (cachedHistory) {
  cachedHistory.push({ role: 'user', content: message.trim() });
  history = cachedHistory.slice(-config.chatHistoryLimit);  // chatHistoryLimit = 20
} else {
  const dbMessages = memoryStore.getSessionMessages(sessionId);
  history = dbMessages.slice(-config.chatHistoryLimit);
  sessionHistoryCache.set(sessionId, [...history]);
}
```

The current approach is a simple **hard truncation**: keep the last 20 messages, silently drop older ones. This loses context about what was discussed earlier in long sessions.

#### New Approach: Sliding Window with Summary

```
For a session with 50 messages:

CURRENT (chatHistoryLimit=20):
  [msg 31] [msg 32] ... [msg 50]   -- older 30 messages lost entirely

NEW (slidingWindow):
  [SUMMARY of msgs 1-30] [msg 31] [msg 32] ... [msg 50]
```

#### Integration Points (4 Specific Locations)

**1. Window check after message processing (chat.ts onDone callback, ~line 306):**

After `onDone` fires, check if the history cache has grown beyond the threshold:

```
if (cachedHistory.length > config.slidingWindowSummarizeThreshold) {
  // Fire-and-forget background summarization
  summarizeOlderMessages(sessionId, cachedHistory).catch(() => {});
}
```

This is non-blocking. The summary is ready for the NEXT message.

**2. Where the summary lives (memories.ts):**

Use `memoryBank.upsertMemory()` with:
- `tier: 'conversation'` (7-day TTL)
- `category: 'session_summary'`
- `key: session_summary:${sessionId}`
- `content: "Summary of conversation so far: ..."`

This aligns perfectly with the existing memory system in `/root/jarvis-backend/src/db/memories.ts`.

**3. Summary injection into history (chat.ts, before chatMessages construction):**

When loading history for a session, check if a session summary exists:

```
const summary = memoryBank.getMemoryByKey(`session_summary:${sessionId}`);
if (summary) {
  // Prepend summary as first message in history
  chatMessages.unshift({ role: 'system', content: summary.content });
}
```

**4. Summarization engine (new module):**

Use the Qwen provider (local, free, fast) to generate summaries. The summary prompt is simple: "Summarize the following conversation in 2-3 sentences, focusing on topics discussed and decisions made."

#### Integration with Existing Memory System

The existing `buildMemoryContext()` in `/root/jarvis-backend/src/ai/memory-context.ts` already includes recent session summaries in the system prompt under `<recent_conversations>`. The sliding window summaries naturally flow through this existing pipeline for cross-session context.

#### Config Values

```typescript
// In config.ts
slidingWindowSize: parseInt(process.env.SLIDING_WINDOW_SIZE || '30', 10),
slidingWindowSummarizeThreshold: parseInt(process.env.SLIDING_WINDOW_THRESHOLD || '25', 10),
// When cache exceeds 25 messages, summarize the oldest 15, keep the latest 10 in full
```

#### Files to Modify
| File | Change |
|------|--------|
| `/root/jarvis-backend/src/realtime/chat.ts` | Add window management after `onDone`, inject summary at history load, trigger background summarization |
| `/root/jarvis-backend/src/config.ts` | Add `slidingWindowSize`, `slidingWindowSummarizeThreshold` configs |

#### Files to Create
| File | Purpose |
|------|---------|
| `/root/jarvis-backend/src/ai/conversation-window.ts` | `summarizeOlderMessages()` function, uses Qwen to generate summary, stores via memoryBank |

---

## Question 5: Latency Tracing Architecture

### Recommendation: Lightweight Custom Spans (NOT OpenTelemetry)

**Confidence: HIGH** (OpenTelemetry is overkill for single-process monolith with 2 external services)

#### Why Not OpenTelemetry

OpenTelemetry is designed for distributed microservice architectures. JARVIS is a modular monolith -- everything runs in one Node.js process talking to two external services (XTTS, llama-server). Adding OTel would mean:
- 5+ new npm packages (`@opentelemetry/sdk-node`, `@opentelemetry/api`, etc.)
- A collector/exporter (Jaeger or console)
- No Socket.IO auto-instrumentation exists (manual spans anyway)
- Massive complexity for minimal additional benefit over custom timing

#### Custom Trace Points Design

Add lightweight timestamp tracking to the existing Socket.IO event flow:

```
t0: chat:send received (backend, chat.ts)
t1: LLM stream first token (backend, onTextDelta callback)
t2: First sentence detected (backend, SentenceAccumulator callback)
t3: First TTS synthesis complete (backend, synthesizeSentenceToBuffer return)
t4: First audio_chunk emitted (backend, socket.emit)
t5: First audio_chunk received (frontend, useChatSocket.ts)
t6: First audio plays (frontend, progressive-queue.ts source.start())
```

#### Backend Implementation

Add a `LatencyTrace` object to the per-request scope in `chat.ts`:

```typescript
interface LatencyTrace {
  sessionId: string;
  t0_received: number;           // Date.now() at chat:send handler entry
  t1_first_token?: number;       // First onTextDelta callback
  t2_first_sentence?: number;    // First SentenceAccumulator emit
  t3_first_tts_done?: number;    // First synthesizeSentenceToBuffer returns
  t4_first_chunk_sent?: number;  // First socket.emit('chat:audio_chunk')
  provider?: string;             // 'claude' | 'qwen'
  ttsEngine?: string;            // 'xtts' | 'piper' | 'cache'
  sentenceCount?: number;        // Total sentences synthesized
  totalTtsMs?: number;           // Cumulative TTS time
}
```

Trace points are recorded inside the existing callbacks:
- `t0`: Beginning of `handleSend()` (line 94)
- `t1`: First call to `onTextDelta` (line 274)
- `t2`: First call to `onSentence` callback (line 253)
- `t3`: After first `synthesizeSentenceToBuffer()` returns in `drainTtsQueue` (line 231)
- `t4`: After first `socket.emit('chat:audio_chunk')` (line 233)

At `onDone`, emit a new event:

```typescript
socket.emit('chat:latency_trace', { sessionId, trace });
```

Also log to console for backend-only monitoring:
```
[Latency] session=abc t0->t1: 450ms (routing+LLM start)
          t1->t2: 1200ms (first sentence accumulation)
          t2->t3: 3100ms (TTS synthesis, engine=xtts)
          t3->t4: 5ms (emit overhead)
          Total t0->t4: 4755ms
```

#### Frontend Implementation

The frontend adds two more timestamps and records them in the `onAudioChunk` and `playNextXttsChunk` handlers:

```
t5: First onAudioChunk handler fires (useChatSocket.ts, line 164)
t6: First AudioContext source.start() called (progressive-queue.ts, line ~207)
```

On receiving `chat:latency_trace`:
- Merge backend trace with frontend timestamps
- Log complete end-to-end latency to console
- Optionally display in a dev overlay or pipeline progress component

#### Correlation Key

The `sessionId` is the natural correlation key. Every event already carries `sessionId`. The trace is built up incrementally on the backend side and enriched with client-side timestamps when `chat:latency_trace` is received.

#### Files to Modify
| File | Change |
|------|--------|
| `/root/jarvis-backend/src/realtime/chat.ts` | Create LatencyTrace at handleSend entry, record timestamps at each stage, emit `chat:latency_trace` at onDone |
| `/root/jarvis-backend/src/ai/tts.ts` | Return timing metadata (engine used, synthesis duration) from `synthesizeSentenceToBuffer()` |
| `/root/jarvis-ui/src/hooks/useChatSocket.ts` | Record t5 at first onAudioChunk, listen for `chat:latency_trace`, merge timestamps |
| `/root/jarvis-ui/src/audio/progressive-queue.ts` | Record t6 at first `source.start()`, expose via callback or store |

#### Files to Create
| File | Purpose |
|------|---------|
| `/root/jarvis-backend/src/realtime/latency-trace.ts` | `LatencyTrace` type definition, `createTrace()`, `recordPoint()`, `formatTrace()` helpers |

---

## Question 6: Health Endpoint Aggregation

### Recommendation: Expand Existing `/api/health` with Parallel Component Checks

**Confidence: HIGH** (existing health endpoint is trivially simple -- 8 lines)

#### Current State

The existing health endpoint at `/root/jarvis-backend/src/api/health.ts` (lines 21-28) returns:
```json
{ "status": "ok", "timestamp": "...", "uptime": 12345, "version": "1.0.0" }
```

No component health checks. Just "I'm alive."

#### New Architecture

```
GET /api/health
    |
    v
  [1] Backend self-check (always passes if responding)
    |
  [2] Parallel component checks (Promise.allSettled, 5s overall timeout):
    |
    +-- TTS (XTTS): HTTP GET http://jarvis-tts:5050/health
    |   Parse: { status: 'ready', voice_ready: true, mode: 'finetuned' }
    |   Timeout: 3s
    |
    +-- TTS (Piper): HTTP GET http://jarvis-piper:5000/
    |   Check for 200 response
    |   Timeout: 2s
    |
    +-- LLM: HTTP GET http://192.168.1.50:8080/health
    |   (llama-server health endpoint)
    |   Timeout: 3s
    |
    +-- Proxmox API: HTTPS GET https://192.168.1.50:8006/api2/json/version
    |   With PVE API token auth
    |   Timeout: 5s
    |
    +-- SQLite: SELECT 1 (synchronous, via better-sqlite3)
    |   Wrapped in try/catch
    |
    v
  Aggregate results into response
```

#### Response Shape

```json
{
  "status": "degraded",
  "timestamp": "2026-01-27T12:00:00.000Z",
  "uptime": 12345.67,
  "version": "1.5.0",
  "components": {
    "backend":   { "status": "healthy" },
    "tts_xtts":  { "status": "healthy", "mode": "finetuned", "latency_ms": 45 },
    "tts_piper": { "status": "healthy", "latency_ms": 12 },
    "llm":       { "status": "healthy", "latency_ms": 89 },
    "proxmox":   { "status": "unhealthy", "error": "timeout", "latency_ms": 5000 },
    "database":  { "status": "healthy", "latency_ms": 1 }
  },
  "tts_fallback_active": false
}
```

**Status logic:**
- `"healthy"`: All components pass
- `"degraded"`: Non-critical component(s) failing (Proxmox API, one TTS engine)
- `"unhealthy"`: Critical component(s) failing (database, both TTS engines, LLM)

**Critical components**: backend, database, at least one TTS engine, LLM
**Non-critical components**: Proxmox API (monitoring-only), individual TTS engines (fallback covers)

#### Caching

Health check results should be cached for 30 seconds (matches the pattern in `tts.ts` where XTTS health is cached for 60s). This prevents the health endpoint from hammering component services under frequent polling.

```typescript
let cachedHealth: HealthResponse | null = null;
let lastHealthTime = 0;
const HEALTH_CACHE_TTL = 30_000;

healthRouter.get('/', async (_req, res) => {
  const now = Date.now();
  if (cachedHealth && now - lastHealthTime < HEALTH_CACHE_TTL) {
    res.json(cachedHealth);
    return;
  }
  // ... run checks
  cachedHealth = result;
  lastHealthTime = now;
  res.json(result);
});
```

#### Docker Healthcheck Compatibility

The existing Docker healthcheck (`wget --spider -q http://localhost:4000/api/health`) only checks for HTTP 200. The enhanced endpoint continues returning 200 for `degraded` status so Docker does not restart the container when Proxmox is temporarily unreachable. Only an exception during the endpoint handler itself would cause a non-200 response.

#### Files to Modify
| File | Change |
|------|--------|
| `/root/jarvis-backend/src/api/health.ts` | Complete rewrite -- add parallel component checks, status aggregation, response caching |
| `/root/jarvis-backend/src/config.ts` | Add health check endpoints for each component, cache TTL |

#### Files to Create
None. The health module stays in its existing file.

---

## Question 7: Web Worker Audio Decoding

### Recommendation: Defer -- Opus Encoding Eliminates the Primary Motivation

**Confidence: MEDIUM** (Opus reduces decode overhead 8x; Web Worker support in browsers is inconsistent)

#### The Math

Current (WAV): `decodeAudioData()` processes ~300KB-1.2MB per sentence. At 24kHz 16-bit mono, this is significant work for the main thread.

After Opus (Question 3): `decodeAudioData()` processes ~9KB per sentence. The Opus codec is hardware-accelerated in browsers. Decoding 9KB of Opus is trivial -- unlikely to cause measurable jank.

#### Recommendation: Build Opus First, Measure, Then Decide

1. **Phase 1**: Implement Opus encoding (Question 3). Deploy.
2. **Phase 2**: Measure main-thread impact of `decodeAudioData()` with Opus buffers. Use the latency trace (Question 5) to measure t5->t6 gap.
3. **Phase 3**: Only if t5->t6 consistently exceeds 5ms (indicating main-thread contention), implement Web Worker decoding.

#### If Workers Become Necessary

The approach would use `OffscreenAudioContext` where available (Chrome 74+), with fallback to main-thread decoding:

```
Main Thread                          Web Worker
-----------                          ----------
queueAudioChunk(chunk)
    |
    +--- worker.postMessage({cmd:'decode', buffer, index, sampleRate})
                                         |
                                         v
                                    OffscreenAudioContext (Chrome only)
                                    ctx.decodeAudioData(buffer)
                                         |
                                    Extract Float32Array from AudioBuffer
                                         |
    <--- worker.postMessage({cmd:'decoded', pcm, index, sampleRate, channels})
    |
    v
Create AudioBuffer from Float32Array
Play via existing AudioContext -> GainNode -> Analyser -> destination chain
```

**Browser compatibility issue**: `OffscreenAudioContext` does not exist in Firefox or Safari. The worker path would only benefit Chrome users. Firefox and Safari would fall back to the current main-thread path.

Given this limitation and the dramatic reduction from Opus encoding, **defer Web Worker implementation** to a future milestone (v1.6+) if measurements show it is needed.

#### Files to Modify (if implemented)
| File | Change |
|------|--------|
| `/root/jarvis-ui/src/audio/progressive-queue.ts` | Add worker dispatch + fallback, reconstruct AudioBuffer from transferred Float32Array |

#### Files to Create (if implemented)
| File | Purpose |
|------|---------|
| `/root/jarvis-ui/src/audio/decode-worker.ts` | Web Worker with OffscreenAudioContext for Opus decoding |

---

## Question 8: TTS Cache Pre-Warming

### Recommendation: Non-Blocking Startup Hook with Common JARVIS Phrases

**Confidence: HIGH** (straightforward implementation using existing cache infrastructure)

#### When It Triggers

Pre-warming runs **at backend startup**, after `server.listen()` succeeds. The existing `docker-compose.yml` already has `depends_on: jarvis-tts: condition: service_healthy`, so the TTS container is guaranteed healthy when the backend starts. The sequence:

```
Backend startup (/root/jarvis-backend/src/index.ts):
  [1] Database migrations (await runMigrations())
  [2] Memory cleanup service (startMemoryCleanup())
  [3] MCP tool initialization (getToolList())
  [4] Real-time emitter (startEmitter())
  [5] Monitor routes + service (setupMonitorRoutes(), startMonitor())
  [6] Terminal + Chat handlers
  [7] server.listen()
  [8] Startup event emitted
  [9] ** NEW: TTS cache pre-warm (fire-and-forget, non-blocking) **
```

Step 9 does NOT block the server. It runs in the background using `setImmediate()` or a simple `setTimeout(() => prewarmTtsCache(), 5000)` delay (5s gives XTTS time to fully warm up after health check passes).

#### What Gets Cached

Common JARVIS phrases that appear frequently. These are generated by analyzing the system prompt and common response patterns:

```typescript
const PREWARM_PHRASES = [
  // Greetings
  "Good morning, sir. All systems are operational.",
  "Good evening, sir. How may I assist you?",
  // Acknowledgments
  "Right away, sir.",
  "I'm on it.",
  "Understood.",
  "Consider it done.",
  // Status reports
  "All nodes are online and healthy.",
  "The cluster is operating normally.",
  "Analysis complete.",
  // Transitions
  "Let me check that for you.",
  "I'll run a diagnostic now.",
  "Here's what I found.",
  "Is there anything else you need?",
  // Common errors
  "I encountered an issue with that request.",
  "The service appears to be temporarily unavailable.",
  // Voice mode specific
  "I'll keep this brief.",
  "In summary.",
];
```

~15-20 phrases, synthesized **sequentially** (one at a time) to avoid overwhelming the TTS container at startup.

#### Implementation

The pre-warming function calls `synthesizeSentenceToBuffer()` for each phrase. This function already handles:
- LRU cache checking (PERF-05, line 289 of tts.ts)
- TTS synthesis
- Buffer collection
- Cache storage

So pre-warming simply calls the existing function for each phrase. The result is automatically cached.

```typescript
// tts-prewarm.ts
export async function prewarmTtsCache(): Promise<void> {
  console.log(`[TTS] Pre-warming cache with ${PREWARM_PHRASES.length} phrases...`);
  let cached = 0;
  for (const phrase of PREWARM_PHRASES) {
    const result = await synthesizeSentenceToBuffer(phrase);
    if (result) cached++;
    // Small delay between requests to avoid CPU spike
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[TTS] Cache pre-warm complete: ${cached}/${PREWARM_PHRASES.length} cached`);
}
```

#### Cache Size Increase

The current cache maximum is 50 entries (`SENTENCE_CACHE_MAX = 50` in `tts.ts` line 240). For v1.5:
- Increase to 200 entries
- Pre-warm fills 15-20 slots
- Remaining 180-185 slots fill organically during conversations

With Opus encoding, each cached entry shrinks from ~300KB (WAV) to ~9KB (Opus), so 200 entries = **~1.8MB** memory (vs ~60MB with WAV at the old size). Well within limits.

#### Files to Modify
| File | Change |
|------|--------|
| `/root/jarvis-backend/src/ai/tts.ts` | Increase `SENTENCE_CACHE_MAX` from 50 to 200, export `synthesizeSentenceToBuffer` if not already (it is exported) |
| `/root/jarvis-backend/src/index.ts` | Add non-blocking prewarm call after `server.listen()` |
| `/root/jarvis-backend/src/config.ts` | Add `ttsCacheSize: 200`, `ttsPrewarmEnabled: true` configs |

#### Files to Create
| File | Purpose |
|------|---------|
| `/root/jarvis-backend/src/ai/tts-prewarm.ts` | `PREWARM_PHRASES` array + `prewarmTtsCache()` async function |

---

## Recommended Build Order (Dependency-Based)

The v1.5 features have a clear dependency graph:

```
                    [Phase 1: Quick Wins]
                   /          |          \
          [Health EP]  [Cache Expand]  [SQLite WAL]
             |            |              [Sentence Tune]
             |            |
        [Phase 2: Piper TTS Fallback]
                   |
        [Phase 3: Parallel TTS + Opus Encoding]
                   |
        [Phase 4: Pre-warm Cache]
                   |
        [Phase 5: Latency Tracing]
                   |
        [Phase 6: Conversation Window]
                   |
        [Phase 7: Frontend (react-window, Web Worker if needed)]
```

### Phase Details

**Phase 1: Quick Wins** -- No new infrastructure, immediate measurable improvement
- SQLite WAL mode (single config line in db/index.ts)
- Increase TTS cache to 200 entries (one constant change in tts.ts)
- Tune sentence detection MIN_SENTENCE_LEN from 20 to 15 (one constant change)
- Health endpoint expansion (rewrite api/health.ts)
- TTS health check auto-restart (enhance tts.ts health checking)

**Phase 2: Piper TTS Fallback** -- New container + backend routing
- Deploy Piper container (docker-compose.yml)
- Add `synthesizePiper()` to tts.ts
- Implement timeout-based fallback in `synthesizeSentenceToBuffer()`
- Verify XTTS -> Piper failover works

**Phase 3: Parallel TTS + Opus** -- The big latency wins
- Create `opus-encoder.ts` module
- Add ffmpeg to backend Dockerfile
- Modify `synthesizeSentenceToBuffer()` to encode output to Opus
- Replace serial TTS queue with bounded parallel pool in `chat.ts`
- Update completion detection for parallel workers

**Phase 4: Pre-warm Cache** -- Depends on Opus (cache Opus, not WAV)
- Create `tts-prewarm.ts` with phrase list
- Hook into startup sequence in `index.ts`
- Test with Opus-encoded cache entries

**Phase 5: Latency Tracing** -- Best placed after main changes are in
- Create `latency-trace.ts` type + helpers
- Instrument `chat.ts` with trace points
- Add frontend timestamp recording
- Emit `chat:latency_trace` event

**Phase 6: Conversation Window** -- Independent of TTS changes
- Create `conversation-window.ts`
- Modify `chat.ts` history loading + onDone
- Test summarization via Qwen

**Phase 7: Frontend Optimizations** -- Depends on Opus being deployed
- Add `react-window` for chat history virtualization
- Measure audio decode jank post-Opus
- Web Worker only if measurements warrant it

### Ordering Rationale

1. **Quick wins first**: No dependencies, provide immediate improvement, validate the measurement baseline
2. **Piper before parallel TTS**: Fallback improves reliability. Without Piper, a stuck XTTS request blocks a worker slot for 20s. With Piper fallback at 3s, the worst case is 3s + 100ms
3. **Opus with parallel TTS**: These two features compound -- parallel TTS produces chunks faster, Opus makes those chunks 8x smaller to transfer
4. **Pre-warm after Opus**: Pre-warm should cache Opus-encoded audio (not WAV that would need re-encoding)
5. **Latency tracing after main changes**: Traces should measure the actual improved pipeline, not the baseline
6. **Conversation window late**: Independent of TTS pipeline, can be built in parallel by a different developer
7. **Web Worker last**: Opus encoding likely eliminates the need; measure before building

---

## New vs Modified Components Summary

### New Files (6)

| File | Purpose | Phase |
|------|---------|-------|
| `/root/jarvis-backend/src/ai/opus-encoder.ts` | WAV->Opus encoding via ffmpeg subprocess | 3 |
| `/root/jarvis-backend/src/ai/tts-prewarm.ts` | Cache pre-warming with common JARVIS phrases | 4 |
| `/root/jarvis-backend/src/ai/conversation-window.ts` | Sliding window + background summarization | 6 |
| `/root/jarvis-backend/src/realtime/latency-trace.ts` | LatencyTrace type + timing helpers | 5 |
| `/root/jarvis-ui/src/audio/decode-worker.ts` | Web Worker audio decode (conditional, Phase 7) | 7 |
| (none) | Piper uses official Docker image | 2 |

### Modified Files (10)

| File | Change | Phase |
|------|--------|-------|
| `/root/docker-compose.yml` | Add `jarvis-piper` service + `piper-data` volume | 2 |
| `/root/jarvis-backend/Dockerfile` | Add `ffmpeg` package | 3 |
| `/root/jarvis-backend/src/config.ts` | Piper endpoint, timeouts, TTS cache size, window settings, health config | 1-6 |
| `/root/jarvis-backend/src/ai/tts.ts` | Piper fallback, Opus encoding, cache expansion to 200, timing metadata | 1-4 |
| `/root/jarvis-backend/src/realtime/chat.ts` | Parallel TTS queue, latency trace, window management, completion detection | 3-6 |
| `/root/jarvis-backend/src/api/health.ts` | Component health aggregation with caching | 1 |
| `/root/jarvis-backend/src/index.ts` | Cache prewarm hook after startup | 4 |
| `/root/jarvis-backend/src/db/index.ts` | SQLite WAL mode (if not already set) | 1 |
| `/root/jarvis-ui/src/hooks/useChatSocket.ts` | Client-side timing for latency trace | 5 |
| `/root/jarvis-ui/src/audio/progressive-queue.ts` | Worker delegation (conditional, Phase 7) | 7 |

### Unchanged Files

| File | Why Unchanged |
|------|---------------|
| `/root/jarvis-backend/src/ai/loop.ts` | Agentic loop is TTS-agnostic |
| `/root/jarvis-backend/src/ai/providers/*.ts` | Provider interface unchanged |
| `/root/jarvis-backend/src/ai/sentence-stream.ts` | Sentence detection constants change only (MIN_SENTENCE_LEN) |
| `/root/jarvis-backend/src/ai/text-cleaner.ts` | Text cleaning logic unchanged |
| `/root/jarvis-backend/src/db/schema.ts` | No new tables needed |
| `/root/jarvis-backend/src/db/memories.ts` | Existing memory API sufficient for summaries |
| `/root/jarvis-backend/src/realtime/socket.ts` | Socket.IO namespace setup unchanged |
| `/root/jarvis-ui/src/stores/chat.ts` | Chat store unchanged (latency trace is read-only) |
| `/root/jarvis-ui/src/stores/voice.ts` | Voice store unchanged |
| `/root/jarvis-ui/src/hooks/useVoice.ts` | Monolithic playback hook unchanged |

---

## Sources

### HIGH Confidence (Direct Codebase Analysis)
- `/root/jarvis-backend/src/realtime/chat.ts` -- Serial TTS queue, sentence accumulator integration, voice pipeline flow
- `/root/jarvis-backend/src/ai/tts.ts` -- TTS provider abstraction, LRU cache, synthesize pipeline
- `/root/jarvis-backend/src/ai/sentence-stream.ts` -- Sentence boundary detection, MIN_SENTENCE_LEN constant
- `/root/jarvis-backend/src/config.ts` -- All current configuration values
- `/root/jarvis-backend/src/api/health.ts` -- Current trivial health endpoint
- `/root/jarvis-backend/src/index.ts` -- Startup sequence, service initialization order
- `/root/jarvis-backend/src/db/memories.ts` -- Memory tier system, session_summary category
- `/root/jarvis-backend/src/ai/memory-context.ts` -- Memory context injection into prompts
- `/root/jarvis-ui/src/audio/progressive-queue.ts` -- Frontend audio queue, decodeAudioData usage
- `/root/jarvis-ui/src/hooks/useChatSocket.ts` -- Socket.IO event handlers, progressive session management
- `/root/docker-compose.yml` -- Current container stack, networking, resource limits
- `/opt/jarvis-tts/app/server.py` -- XTTS API surface, health endpoint, synthesis endpoint
- `/opt/jarvis-tts/Dockerfile` -- XTTS container build, Python + PyTorch dependencies

### HIGH Confidence (Official Documentation)
- [Piper TTS GitHub](https://github.com/rhasspy/piper) -- HTTP server, voice models, Docker setup
- [rhasspy/wyoming-piper Docker](https://hub.docker.com/r/rhasspy/wyoming-piper) -- Official container image, port 5000 HTTP API
- [Piper HTTP API docs](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md) -- POST endpoint, JSON format, response format
- [MDN decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) -- Browser API for audio decoding
- [Chrome Opus in decodeAudioData](https://chromestatus.com/feature/5649634416394240) -- Chrome feature tracking for Opus support

### MEDIUM Confidence (Verified Research)
- [Inferless TTS Benchmark 2025](https://www.inferless.com/learn/comparing-different-text-to-speech---tts--models-part-2) -- Piper <1s vs XTTS higher latency on CPU
- [opus-stream-decoder npm](https://www.npmjs.com/package/opus-stream-decoder) -- WebAssembly Opus decoding option
- [prism-media](https://github.com/amishshah/prism-media) -- Node.js Opus encoding via native bindings
- ffmpeg WAV->Opus pipe support -- verified via ffmpeg documentation and community examples

### LOW Confidence (Needs Validation)
- OffscreenAudioContext browser support in Firefox/Safari -- requires runtime testing
- Piper HTTP API latency on Home node hardware -- needs benchmarking after deployment
- Opus encoding overhead per sentence in Node.js via ffmpeg spawn -- needs benchmarking

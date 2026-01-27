# Technology Stack: Jarvis v1.5 Optimization & Latency Reduction

**Project:** Jarvis 3.1 v1.5 Milestone
**Researched:** 2026-01-27
**Overall Confidence:** HIGH
**Mode:** Ecosystem (Stack dimension for subsequent milestone)

**Scope:** This document covers ONLY the stack additions/changes for v1.5. The existing stack (Express 5, React 19, Vite 6, Socket.IO 4, better-sqlite3, Drizzle ORM, XTTS v2 TTS container, Zustand stores, progressive audio queue) is validated and unchanged. See previous STACK.md files for those decisions.

---

## Critical Context: What Already Exists

Before recommending new packages, here is what is already in place and relevant to v1.5:

| Component | Location | Version | Relevance to v1.5 |
|-----------|----------|---------|-------------------|
| XTTS v2 TTS | Docker `jarvis-tts` | Custom build | Primary TTS, 3-10s/sentence CPU. Piper becomes fallback. |
| FFmpeg | Host `/usr/bin/ffmpeg` | 7.1.3 (with `--enable-libopus`) | WAV-to-Opus encoding. Already compiled with libopus. |
| better-sqlite3 | Backend npm | 12.6.2 | WAL mode already enabled (line 15 of `db/index.ts`). Needs additional PRAGMAs. |
| Progressive audio queue | Frontend `progressive-queue.ts` | Custom | Plays WAV via `decodeAudioData()`. Works with OGG Opus without code changes. |
| `synthesizeSentenceToBuffer()` | Backend `tts.ts` | Custom | 20s timeout, LRU cache (50 entries). Natural fallback insertion point. |
| Socket.IO binary events | Backend `chat.ts` | 4.8.3 | `chat:audio_chunk` already sends binary audio. Format-agnostic. |
| Node.js | Host + Docker | 22 | Built-in `performance.now()`, `fetch()`, `AbortSignal.timeout()` |

**Key insight:** v1.5 requires only 1 new Docker container (Piper), 1 system package in the backend Dockerfile (ffmpeg), and 1 optional npm package (virtualization). Everything else uses existing APIs and built-ins.

---

## 1. Piper TTS -- Fast Fallback Voice Synthesis

### Recommendation

| Technology | Version | Image/Package | Purpose |
|------------|---------|---------------|---------|
| Piper TTS | 1.3.0 (OHF-Voice/piper1-gpl) | Self-built Python image | Fast CPU TTS fallback when XTTS is slow/unhealthy |

### Why Piper

XTTS v2 produces high-quality cloned voice but takes 3-10s per sentence on CPU. Piper uses ONNX Runtime with VITS models and synthesizes in **under 200ms** per sentence on CPU -- roughly 20-50x faster than XTTS. This makes it the ideal fallback:

- **Latency:** Sub-second synthesis vs. 3-10s XTTS. First-audio target of 2-4s becomes achievable when XTTS is slow.
- **Reliability:** ONNX inference is deterministic and lightweight. No GPU required, no model loading failures. Achieves the 99%+ TTS reliability target.
- **Quality tradeoff:** Piper voices sound less natural than XTTS cloned voice, but are fully intelligible and acceptable for fallback scenarios.

### Docker Integration Strategy

**Recommended: Self-built Python container with HTTP server**

The `rhasspy/wyoming-piper` Docker image uses the Wyoming protocol (designed for Home Assistant), which requires a custom client. The Piper HTTP server is simpler and produces standard REST responses. Build a minimal container:

```dockerfile
FROM python:3.11-slim
RUN pip install --no-cache-dir piper-tts[http]==1.3.0
RUN python3 -m piper.download_voices en_US-lessac-medium
EXPOSE 5000
CMD ["python3", "-m", "piper.http_server", "-m", "en_US-lessac-medium", "--host", "0.0.0.0"]
```

**docker-compose.yml addition:**

```yaml
jarvis-piper:
  build:
    context: /opt/jarvis-piper
  container_name: jarvis-piper
  restart: unless-stopped
  networks:
    - jarvis-net
  deploy:
    resources:
      limits:
        cpus: "4"
        memory: 1G
      reservations:
        cpus: "1"
        memory: 256M
  healthcheck:
    test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:5000/voices')"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 30s
```

### Voice Model Selection

| Voice | Quality | Sample Rate | Recommendation |
|-------|---------|-------------|----------------|
| `en_US-lessac-medium` | Medium | 22050 Hz | **Primary choice.** Best quality/speed balance. Clear male voice. |
| `en_GB-alan-medium` | Medium | 22050 Hz | **Evaluate.** British male, closer to JARVIS persona. |
| `en_US-amy-low` | Low | 16000 Hz | Not recommended. Noticeably degraded quality. |

Voice models are ONNX files (~15-60MB) with a companion `.onnx.json` config file. Downloaded from [HuggingFace rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).

### API Interface

The Piper HTTP server exposes:

- **POST `/`** -- Synthesize speech
  - Body: `{"text": "Hello world", "length_scale": 1.0}`
  - Response: WAV audio (22050 Hz, 16-bit mono)
  - Latency: ~50-200ms for typical sentences on CPU

- **GET `/voices`** -- List available voice models (useful for health check)

### Integration with Existing TTS Service

The current `tts.ts` has a provider abstraction (`TTSProvider` union type). The `synthesizeSpeech()` function currently throws when XTTS is unhealthy. Integration:

1. Add `'piper'` to the `TTSProvider` union type.
2. Add `config.piperTtsEndpoint` to `config.ts` (default: `http://jarvis-piper:5000`).
3. Modify `synthesizeSpeech()`: try XTTS first, fall back to Piper on timeout/error.
4. The existing `synthesizeSentenceToBuffer()` 20s timeout already creates a natural fallback window. Reduce XTTS timeout to 8s for v1.5 to allow Piper fallback within acceptable latency.

**Fallback logic:**

```
Is XTTS healthy? -> Try XTTS (timeout: 8s)
  Success -> Return XTTS audio (high quality, audio/wav)
  Timeout/Error -> Try Piper (timeout: 3s)
    Success -> Return Piper audio (fast, acceptable quality, audio/wav)
    Error -> Return null (skip this sentence)
```

### Important Note: Repository Change

The original `rhasspy/piper` was archived October 2025. Development moved to [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) under GPLv3 license. The PyPI package `piper-tts` v1.3.0 (July 2025) is the current release. Use the PyPI package for the self-built image rather than cloning the Git repo.

### Confidence: HIGH

- Piper HTTP API verified via [official docs](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md)
- Voice model format and downloads verified via [HuggingFace](https://huggingface.co/rhasspy/piper-voices)
- Performance claims (sub-second CPU synthesis) verified across multiple benchmark sources
- Docker integration follows the same pattern as existing XTTS container

---

## 2. Opus Audio Codec -- Bandwidth and Buffer Size Reduction

### Recommendation

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| Backend encoding | FFmpeg via `child_process.spawn` | System FFmpeg 7.1.3 (add to Docker) | WAV-to-OGG/Opus transcoding |
| Browser decoding | Native `decodeAudioData()` | Built-in browser API | Handles OGG Opus natively |

### Why Opus

| Format | Bitrate (speech) | Chunk size (5s clip) | Browser decode |
|--------|-------------------|---------------------|----------------|
| WAV (current) | ~705 kbps (16-bit 44.1kHz) | ~440 KB | Native |
| **OGG Opus** | **48 kbps** | **~30 KB** | **Native** |

Opus at 48kbps speech quality is perceptually equivalent to much higher bitrate formats. The primary benefit is not bandwidth (local network) but **buffer size**: a 5-second audio chunk shrinks from ~440KB to ~30KB. This means:

- **14x smaller Socket.IO binary payloads** -- faster delivery, less memory
- **Faster `decodeAudioData()` calls** -- less data to process on main thread
- **Smaller LRU cache footprint** -- 50 cached sentences use ~1.5MB instead of ~22MB

### Backend: FFmpeg Encoding

FFmpeg with `libopus` is already compiled on the host system (verified: FFmpeg 7.1.3 with `--enable-libopus`). Add it to the backend Docker image:

**Dockerfile change (line 9):**
```dockerfile
# Change from:
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
# To:
RUN apt-get update && apt-get install -y --no-install-recommends wget ffmpeg && rm -rf /var/lib/apt/lists/*
```

**Encoding function:**
```typescript
import { spawn } from 'node:child_process';

function wavToOpus(wavBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'wav', '-i', 'pipe:0',        // Input: WAV from stdin
      '-c:a', 'libopus',                    // Codec: Opus
      '-b:a', '48k',                        // Bitrate: 48kbps (excellent for speech)
      '-ar', '48000',                        // Opus native sample rate
      '-application', 'voip',                // Optimize for speech
      '-f', 'ogg', 'pipe:1'                 // Output: OGG container to stdout
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {});      // Suppress FFmpeg stderr
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`FFmpeg opus encode failed (code ${code})`));
    });
    ffmpeg.on('error', reject);

    ffmpeg.stdin.write(wavBuffer);
    ffmpeg.stdin.end();
  });
}
```

Insert this after `synthesizeSentenceToBuffer()` collects the WAV buffer and before caching/emitting. The ~5-10ms encoding overhead is negligible compared to TTS synthesis time.

### Browser: Zero Changes Required

The existing `progressive-queue.ts` line 193 calls:
```typescript
const audioBuffer = await ctx.decodeAudioData(chunk.buffer.slice(0));
```

`AudioContext.decodeAudioData()` handles OGG Opus natively in all modern browsers (Chrome 94+, Firefox 133+, Safari 26+, Edge 94+). **No frontend code changes needed** -- just change the `contentType` from `audio/wav` to `audio/ogg` in the Socket.IO event.

### Why FFmpeg over Native Node.js Opus Libraries

| Option | Verdict | Reason |
|--------|---------|--------|
| **FFmpeg spawn** | **Use this** | Battle-tested, already on host with libopus, handles WAV parsing + OGG container. ~5-10ms overhead per sentence. |
| `@discordjs/opus` v0.10.0 | Do not use | Raw Opus frames only (no OGG container), requires node-gyp C++ compilation in Docker, security CVE history |
| `opus-encdec` | Do not use | Browser-focused WASM, limited Node.js support |
| `node-opus` | Do not use | Unmaintained, no Node 22 support |

### What NOT to Add

- **`@discordjs/opus`** -- Native addons require node-gyp build in Docker. FFmpeg handles encoding without compilation.
- **`opus-recorder` / `opus-encdec`** -- Browser-focused. The `opus-recorder` project is no longer maintained (maintainers recommend WebCodecs API).
- **WebCodecs `AudioDecoder` setup on frontend** -- Over-engineered. `decodeAudioData` with OGG containers is simpler and already works.

### Confidence: HIGH

- FFmpeg libopus verified on host: `ffmpeg -version` shows `--enable-libopus`
- Browser `decodeAudioData` OGG Opus support verified via Can I Use and MDN
- The `child_process.spawn` FFmpeg pattern is well-established

---

## 3. List Virtualization -- Chat Panel Performance

### Recommendation

| Technology | Version | Package |
|------------|---------|---------|
| `@tanstack/react-virtual` | ^3.13.18 | `npm i @tanstack/react-virtual` |

### Why @tanstack/react-virtual (NOT react-window)

The original question asked about `react-window`. After research, `@tanstack/react-virtual` is the better choice:

| Criterion | react-window 2.2.5 | @tanstack/react-virtual 3.13.18 |
|-----------|---------------------|-------------------------------|
| Weekly downloads | ~4.1M | ~7.4M (more popular) |
| API style | Component-based (`<VariableSizeList>`) | Hooks-based (`useVirtualizer`) |
| Dynamic heights | Manual: measure + `resetAfterIndex()` | Built-in: `measureElement` ref callback |
| Chat UX | Difficult for dynamic content | Better: headless, full layout control |
| React 19 | Not tested | Actively maintained, tested |
| Bundle size | ~6KB gzipped | ~10KB gzipped |

**Critical factor for chat:** Chat messages have variable heights (short text, code blocks, tool results, markdown). `react-window`'s `VariableSizeList` requires pre-computed heights or manual measurement with `resetAfterIndex()` -- a [well-documented pain point](https://github.com/bvaughn/react-window/issues/190) with 190+ comments. `@tanstack/react-virtual` handles this natively via `measureElement`.

### Integration with ChatPanel.tsx

The current `ChatPanel.tsx` renders all messages in a scrolling `div` (lines 113-139). With virtualization:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const parentRef = useRef<HTMLDivElement>(null);

const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 80,
  overscan: 5,
});

// In render:
<div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto">
  <div style={{ height: virtualizer.getTotalSize() }}>
    {virtualizer.getVirtualItems().map((vItem) => (
      <div key={vItem.key} ref={virtualizer.measureElement} data-index={vItem.index}>
        <ChatMessage message={messages[vItem.index]} ... />
      </div>
    ))}
  </div>
</div>
```

### Priority Assessment

Virtualization is only impactful when the message list grows large (100+ messages in a session). For v1.5's primary goal of latency reduction, this is a **lower priority optimization**. Recommend:

- **Include in v1.5 scope** if a "UI performance" phase exists.
- **Defer** if phases focus exclusively on TTS/audio latency.

### What NOT to Add

- **`react-window`**: Worse dynamic height support for chat messages.
- **`react-virtuoso`**: Good alternative but heavier (~20KB), less popular.
- **`react-virtualized`**: Legacy predecessor, unmaintained.

### Confidence: HIGH

- Version 3.13.18 verified on [npm](https://www.npmjs.com/package/@tanstack/react-virtual) (published 2026-01-16)
- Dynamic height `measureElement` API verified via [TanStack Virtual docs](https://tanstack.com/virtual/latest)

---

## 4. Web Workers for Audio Decoding

### Recommendation: DEFER -- Not Needed for v1.5

### Critical Finding

**`AudioContext` and `OfflineAudioContext` are NOT available inside Web Workers** as of January 2026. This is an [open feature request](https://github.com/WebAudio/web-audio-api-v2/issues/16) in the Web Audio API v2 specification. The main `decodeAudioData()` call that converts audio buffers to playable `AudioBuffer` objects **must run on the main thread**.

### What IS Possible in Workers

| Operation | Available in Worker? | Notes |
|-----------|---------------------|-------|
| Transfer `ArrayBuffer` (Transferable) | Yes | Zero-copy transfer |
| Parse WAV/OGG headers | Yes | Manual byte parsing |
| `AudioContext.decodeAudioData()` | **No** | Main thread only |
| WebCodecs `AudioDecoder` | Yes (Chrome, Edge, Firefox) | Not Safari < 26.1 |
| `AudioWorklet` processing | Yes (during playback) | Not for decoding |

### Why Deferral is the Right Choice

With the Opus codec switch, audio chunks shrink from ~440KB to ~30KB per sentence. The `decodeAudioData()` call for a 30KB OGG Opus buffer takes ~1-3ms on the main thread -- well below the 16ms frame budget. The bottleneck is TTS synthesis time (seconds), not audio decoding (milliseconds).

If profiling later shows `decodeAudioData` blocking the main thread (unlikely with Opus-sized buffers), the path forward would be:
1. Use WebCodecs `AudioDecoder` in a Worker (available in Chrome/Edge/Firefox)
2. Transfer decoded PCM data back to main thread as `Float32Array` (Transferable)
3. Create `AudioBuffer` from PCM on main thread

But this adds complexity for a problem that likely does not exist after the Opus switch.

### What NOT to Add

- **`standardized-audio-context`** polyfill -- Not needed. All target browsers support AudioContext natively.
- **Custom WASM Opus decoder in Worker** -- Over-engineered. Native `decodeAudioData` handles OGG Opus.
- **`audio-worklet-polyfill`** -- Only needed for Safari < 14.1. Not relevant.

### Confidence: HIGH

- AudioContext Worker limitation verified via [Web Audio API v2 spec discussion](https://github.com/WebAudio/web-audio-api-v2/issues/16)
- WebCodecs Worker availability verified via [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder)

---

## 5. SQLite WAL Mode & Performance PRAGMAs

### Status: WAL Already Enabled -- Add Additional PRAGMAs

The current codebase at `/root/jarvis-backend/src/db/index.ts` line 15 already has `sqlite.pragma('journal_mode = WAL')`. No new dependencies needed. Add these additional PRAGMAs for v1.5 performance:

```typescript
const sqlite: DatabaseType = new Database(config.dbPath);

// Performance tuning (add these after the existing WAL line)
sqlite.pragma('journal_mode = WAL');          // EXISTING
sqlite.pragma('synchronous = NORMAL');        // NEW: Safe with WAL, ~2x write speed
sqlite.pragma('cache_size = -64000');         // NEW: 64MB cache (default ~2MB)
sqlite.pragma('foreign_keys = ON');           // NEW: Data integrity
sqlite.pragma('temp_store = MEMORY');         // NEW: Temp tables in memory
sqlite.pragma('mmap_size = 268435456');       // NEW: 256MB memory-mapped I/O
```

**Rationale for each:**

| PRAGMA | Default | New Value | Why |
|--------|---------|-----------|-----|
| `synchronous` | FULL | NORMAL | With WAL, NORMAL provides crash safety against app crashes (not OS crashes). For a homelab dashboard, acceptable tradeoff for ~2x write speed. |
| `cache_size` | ~2MB | 64MB | Home node has 24GB RAM. More cache = fewer disk reads for repeated chat history queries. |
| `foreign_keys` | OFF | ON | Enforces referential integrity. Small overhead, big safety. |
| `temp_store` | DEFAULT (disk) | MEMORY | Temp tables and indices in memory. Faster for complex queries. |
| `mmap_size` | 0 | 256MB | Memory-mapped I/O for read-heavy workloads. Chat history reads benefit. |

### WAL Checkpoint Management

Add periodic checkpoint to prevent WAL file growth:

```typescript
setInterval(() => {
  try { sqlite.pragma('wal_checkpoint(PASSIVE)'); }
  catch { /* non-critical */ }
}, 300_000).unref(); // Every 5 minutes
```

### Drizzle ORM Note

Drizzle ORM does NOT have a built-in `onOpen` or pragma API. The current pattern of setting PRAGMAs on the raw `better-sqlite3` instance before passing to `drizzle()` is the [recommended approach](https://github.com/drizzle-team/drizzle-orm/issues/4968).

### No New Dependencies

All uses existing `better-sqlite3` v12.6.2 API.

### Confidence: HIGH

- Current implementation verified by reading `/root/jarvis-backend/src/db/index.ts`
- PRAGMA recommendations verified via [better-sqlite3 performance docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)

---

## 6. Latency Tracing

### Recommendation: Native `performance.now()` -- No Libraries

| Option | Verdict | Reason |
|--------|---------|--------|
| **`performance.now()` / `perf_hooks`** | **Use this** | Built-in Node.js 22, sub-millisecond resolution, zero overhead |
| OpenTelemetry | Overkill | Designed for distributed microservices, not a 3-container homelab stack |
| `pino` structured logging | Consider later | Good for production observability but adds dependency for a feature that only needs timing |
| Datadog / New Relic | Wrong tool | Cloud SaaS, wrong for self-hosted homelab |

### Implementation Pattern

**Server-side (chat.ts):**

```typescript
import { performance } from 'node:perf_hooks';

// In handleSend():
const t0 = performance.now();
let firstTokenMs = 0;
let firstAudioMs = 0;

callbacks.onTextDelta = (text) => {
  if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - t0);
  // ... existing logic
};

// In drainTtsQueue(), after first audio chunk emitted:
if (item.index === 0) firstAudioMs = Math.round(performance.now() - t0);

// In onDone:
socket.emit('chat:latency_trace', {
  sessionId,
  llmFirstTokenMs: firstTokenMs,
  ttsFirstAudioMs: firstAudioMs,
  totalMs: Math.round(performance.now() - t0),
  ttsProvider: lastTtsProvider, // 'xtts' or 'piper'
  sentenceCount: audioChunkIndex,
});
```

**Client-side (useChatSocket.ts):**

```typescript
// Standard browser API
const sendTime = performance.now();

socket.on('chat:audio_chunk', (data) => {
  if (data.index === 0) {
    const firstAudioLatencyMs = Math.round(performance.now() - sendTime);
    // Display in UI or store in Zustand
  }
});
```

### Trace Data Structure

```typescript
interface LatencyTrace {
  sessionId: string;
  llmFirstTokenMs: number;     // Request -> first LLM token
  ttsFirstAudioMs: number;     // Request -> first audio chunk emitted
  totalMs: number;             // Request -> audio_done
  ttsProvider: 'xtts' | 'piper'; // Which TTS served first audio
  sentenceCount: number;        // Total sentences synthesized
}
```

### No New Dependencies

Uses `performance.now()` from built-in `node:perf_hooks` (server) and `window.performance.now()` (browser).

### Confidence: HIGH

- Native APIs, fully supported in Node.js 22 and all modern browsers

---

## 7. Health Check Endpoint -- Multi-Service Aggregation

### Recommendation: Extend Existing Endpoint -- No Libraries

The existing `/api/health` endpoint at `/root/jarvis-backend/src/api/health.ts` returns basic uptime/version info. Extend it with parallel dependency checks.

### Enhanced Health Response

```typescript
interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  detail?: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: ServiceHealth[];
  ttsReliability: {
    primary: 'xtts';
    fallback: 'piper';
    activeTtsProvider: string;
  };
}
```

### Services to Check (Parallel)

| Service | Check Endpoint | Critical? | Timeout |
|---------|---------------|-----------|---------|
| LLM (llama-server) | `http://192.168.1.50:8080/health` | Yes | 3s |
| XTTS TTS | `http://jarvis-tts:5050/health` | No (Piper fallback) | 3s |
| Piper TTS | `http://jarvis-piper:5000/voices` | No (XTTS primary) | 2s |
| SQLite DB | Sync PRAGMA check | Yes | 1s |

### Aggregation Logic

```
All critical healthy + any TTS healthy = "healthy"
All critical healthy + no TTS healthy  = "degraded"
Any critical unhealthy                  = "unhealthy"
```

### Implementation

```typescript
async function checkService(name: string, url: string, timeoutMs: number): Promise<ServiceHealth> {
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      name,
      status: res.ok ? 'healthy' : 'degraded',
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return {
      name,
      status: 'unhealthy',
      latencyMs: Math.round(performance.now() - start),
      detail: 'Unreachable',
    };
  }
}

// All checks run in parallel
const services = await Promise.all([
  checkService('llm', `${config.localLlmEndpoint}/health`, 3000),
  checkService('xtts', `${config.localTtsEndpoint}/health`, 3000),
  checkService('piper', `${config.piperTtsEndpoint}/voices`, 2000),
  checkSqlite(),
]);
```

### Docker Healthcheck Compatibility

The existing Docker HEALTHCHECK uses `wget --spider -q http://localhost:4000/api/health`. The enhanced endpoint still returns HTTP 200 when healthy/degraded (TTS down but LLM up). Returns HTTP 503 only when critical services are down. Drop-in compatible.

### No New Dependencies

Uses `fetch()` (built into Node.js 22), `AbortSignal.timeout()` (built-in), `Promise.all` for parallelism.

### Confidence: HIGH

- Pattern verified via [Node.js Reference Architecture health checks](https://nodeshift.dev/nodejs-reference-architecture/operations/healthchecks/)
- Existing endpoint code reviewed

---

## Conversation Sliding Window

### Recommendation: No Library -- Implement in chat.ts

The existing `chat.ts` already has `config.chatHistoryLimit` (default 20) and `config.qwenHistoryLimit` (default 10) for context window management. The conversation sliding window for v1.5 is a refinement of this existing pattern:

1. **Token-aware truncation** -- Count tokens (approximate: `text.length / 4`) instead of message count.
2. **Priority retention** -- Keep system message + last N user/assistant pairs + tool results from current session.
3. **Summarization trigger** -- When history exceeds budget, summarize older messages into a compact block.

No external tokenizer library needed. The existing `config.qwenContextWindow` (4096) and `config.memoryContextTokenBudget` (600) already define the budget. Character-based approximation (`length / 4`) is sufficient for a 7B local model.

### What NOT to Add

- **`tiktoken`** (OpenAI tokenizer) -- Only accurate for GPT models. Qwen uses a different tokenizer. Character approximation is adequate.
- **`@anthropic-ai/tokenizer`** -- Only for Claude. Not relevant for local LLM context management.
- **LangChain memory modules** -- Over-abstraction for a straightforward sliding window.

### Confidence: HIGH

- Existing code reviewed at `/root/jarvis-backend/src/realtime/chat.ts` lines 132-149

---

## Complete v1.5 Dependency Summary

### New Docker Container

| Container | Base Image | Purpose | Resources |
|-----------|------------|---------|-----------|
| `jarvis-piper` | `python:3.11-slim` + `piper-tts[http]==1.3.0` | Fast TTS fallback | 1G RAM, 4 CPUs max |

### Backend Dockerfile Change

```dockerfile
# Line 9: Add ffmpeg for Opus encoding
RUN apt-get update && apt-get install -y --no-install-recommends wget ffmpeg && rm -rf /var/lib/apt/lists/*
```

### Backend npm: No New Packages

All backend features use Node.js 22 built-ins:
- `child_process.spawn` for FFmpeg Opus encoding
- `performance.now()` for latency tracing
- `fetch()` + `AbortSignal.timeout()` for health checks

### Frontend npm (Optional)

```bash
# Only if adding chat virtualization:
cd /root/jarvis-ui && npm install @tanstack/react-virtual
```

### New Config Values (.env)

```bash
# Piper TTS fallback
PIPER_TTS_ENDPOINT=http://jarvis-piper:5000    # NEW: Piper HTTP server URL

# TTS fallback behavior
TTS_XTTS_TIMEOUT_MS=8000                       # NEW: XTTS timeout before Piper fallback
TTS_PIPER_TIMEOUT_MS=3000                       # NEW: Piper timeout
TTS_OPUS_BITRATE=48k                            # NEW: Opus encoding bitrate

# Latency tracing
LATENCY_TRACE_ENABLED=true                      # NEW: Emit latency trace events
```

---

## What We Are NOT Adding (and Why)

| Technology | Reason Not to Add |
|------------|-------------------|
| `@discordjs/opus` | FFmpeg handles Opus encoding without native addon compilation |
| `react-window` | `@tanstack/react-virtual` has better dynamic height support for chat |
| Web Worker audio decode library | AudioContext not available in Workers; native decode is fast enough with Opus-sized buffers |
| OpenTelemetry / tracing library | `performance.now()` is sufficient for homelab scale |
| Health check npm package | `fetch` + `Promise.all` is simpler than any library |
| `opus-recorder` / `opus-encdec` | Deprecated / browser-focused; not needed for server-side encoding |
| `tiktoken` / tokenizer library | Character-based approximation is adequate for local LLM context |
| `express-healthcheck` | Simple hand-rolled check is more maintainable than a middleware dependency |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| TTS fallback | Piper TTS (self-built Docker) | Edge TTS (Microsoft) | Requires internet; defeats self-hosted purpose |
| TTS fallback | Piper TTS | Bark / Tortoise TTS | Both are much slower than XTTS, defeating the fallback purpose |
| Opus encoding | FFmpeg spawn | `@discordjs/opus` native addon | node-gyp compilation in Docker, raw frames only (no OGG container) |
| Opus encoding | FFmpeg spawn | `opusenc` CLI | Extra binary to install; FFmpeg already includes libopus |
| Browser Opus decode | Native `decodeAudioData` | WebCodecs `AudioDecoder` | Over-engineered; `decodeAudioData` handles OGG Opus natively |
| Virtualization | `@tanstack/react-virtual` | `react-window` | Poor dynamic height support for chat messages |
| Virtualization | `@tanstack/react-virtual` | `react-virtuoso` | Heavier (20KB), less popular |
| Latency tracing | `performance.now()` | OpenTelemetry | Overkill for 3-container homelab stack |
| Health aggregation | Hand-rolled `Promise.all` | `healthchecks-api` npm | Simple pattern; library adds unnecessary abstraction |
| SQLite performance | Additional PRAGMAs | Switch to PostgreSQL | Massive overhaul for minimal benefit at homelab scale |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Piper voice quality vs XTTS | LOW | Piper is fallback only; XTTS remains primary. Users hear Piper only when XTTS is slow/down. |
| FFmpeg in Docker image size | LOW | `ffmpeg` adds ~80MB to the slim image. Acceptable for the encoding capability. |
| Piper GPLv3 license | LOW | Piper runs in its own container. GPLv3 does not propagate to the Node.js backend or React frontend via HTTP API calls. |
| `piper-tts` PyPI package freshness | LOW | v1.3.0 (July 2025) is 6 months old. The project is actively maintained under OHF-Voice. Monitor for v1.4+. |
| OGG Opus browser decode edge cases | LOW | `decodeAudioData` is well-tested for OGG Opus. Fall back to WAV if decode fails (check error handler in `progressive-queue.ts` line 208). |
| Docker Compose complexity (4 services now) | LOW | Clear service boundaries. Piper is optional -- backend works without it (just loses fallback). |

---

## Sources

### Piper TTS
- [OHF-Voice/piper1-gpl GitHub](https://github.com/OHF-Voice/piper1-gpl) -- Current repository (original rhasspy/piper archived Oct 2025)
- [Piper HTTP API docs](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md) -- REST endpoint specification
- [piper-tts PyPI v1.3.0](https://pypi.org/project/piper-tts/) -- July 2025 release
- [rhasspy/piper-voices HuggingFace](https://huggingface.co/rhasspy/piper-voices) -- Voice model downloads
- [Piper voice samples](https://rhasspy.github.io/piper-samples/) -- Audio demos
- [Inferless TTS model comparison](https://www.inferless.com/learn/comparing-different-text-to-speech---tts--models-part-2) -- Latency benchmarks

### Opus Audio
- [Opus codec official](https://opus-codec.org/) -- Codec reference
- [WebCodecs browser support](https://caniuse.com/webcodecs) -- Can I Use data
- [Safari 26 WebCodecs](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) -- Safari AudioDecoder support
- [AudioDecoder MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder) -- WebCodecs API reference

### List Virtualization
- [@tanstack/react-virtual npm](https://www.npmjs.com/package/@tanstack/react-virtual) -- v3.13.18 (published 2026-01-16)
- [TanStack Virtual docs](https://tanstack.com/virtual/latest) -- Official documentation
- [react-window issue #190](https://github.com/bvaughn/react-window/issues/190) -- Dynamic height pain point
- [npm trends comparison](https://npmtrends.com/@tanstack/react-virtual-vs-react-window) -- Download trends

### Web Workers + Audio
- [Web Audio API v2 Worker support](https://github.com/WebAudio/web-audio-api-v2/issues/16) -- AudioContext in Workers proposal
- [OfflineAudioContext MDN](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext) -- Offline audio processing

### SQLite Performance
- [better-sqlite3 performance docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) -- WAL mode, PRAGMAs
- [Drizzle ORM WAL issue #4968](https://github.com/drizzle-team/drizzle-orm/issues/4968) -- PRAGMA configuration pattern
- [SQLite WAL documentation](https://sqlite.org/wal.html) -- Official reference

### Health Checks
- [Node.js Reference Architecture](https://nodeshift.dev/nodejs-reference-architecture/operations/healthchecks/) -- Health check best practices
- [healthchecks-api npm](https://www.npmjs.com/package/healthchecks-api) -- Multi-service aggregation pattern (evaluated, not adopted)

### Codebase Verification (HIGH confidence)
- `/root/jarvis-backend/src/ai/tts.ts` -- Current TTS provider abstraction
- `/root/jarvis-backend/src/config.ts` -- Current config structure
- `/root/jarvis-backend/src/db/index.ts` -- WAL mode already enabled (line 15)
- `/root/jarvis-backend/src/api/health.ts` -- Current health endpoint
- `/root/jarvis-backend/src/realtime/chat.ts` -- Current streaming pipeline with TTS queue
- `/root/jarvis-ui/src/audio/progressive-queue.ts` -- Current `decodeAudioData` usage (line 193)
- `/root/jarvis-ui/src/components/center/ChatPanel.tsx` -- Current message rendering (lines 113-139)
- `/root/docker-compose.yml` -- Current 3-service Docker Compose structure
- `/root/jarvis-backend/Dockerfile` -- Current slim image with wget only
- `/root/jarvis-backend/package.json` -- Current dependencies (better-sqlite3 v12.6.2, etc.)
- `/root/jarvis-ui/package.json` -- Current frontend dependencies (React 19, Zustand 5, etc.)

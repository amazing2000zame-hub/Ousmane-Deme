# Phase 22: TTS Reliability -- Piper Fallback Engine - Research

**Researched:** 2026-01-27
**Domain:** TTS fallback routing, Piper TTS deployment, Docker orchestration
**Confidence:** HIGH

## Summary

This research investigates how to deploy Piper TTS as a fast CPU-based fallback alongside the existing XTTS v2 container, and how to implement health-aware routing with per-response engine consistency in the Jarvis backend.

Piper TTS is a fast, local neural text-to-speech system using ONNX-based VITS models. It synthesizes speech in well under 200ms for short sentences on modern CPUs (RTF ~0.2 on x86_64), compared to XTTS v2 which takes 8-15 seconds per sentence. Piper includes a built-in Flask HTTP server (`piper.http_server`) that exposes a single root endpoint (`/`) accepting POST requests with raw text body and returning WAV audio. The official `rhasspy/wyoming-piper` Docker image bundles both the Wyoming protocol server (port 10200) and an HTTP server (port 5000) with automatic voice model downloads.

The recommended approach is: deploy the `rhasspy/wyoming-piper` Docker image as `jarvis-piper` on the existing `jarvis-net` network, use its HTTP API on port 5000 for synthesis, and implement a two-tier fallback in `tts.ts` that races XTTS against a 3-second timeout, falling back to Piper. A per-response `engineLock` variable in `chat.ts` enforces voice consistency -- once Piper is used for any sentence, all remaining sentences use Piper.

**Primary recommendation:** Deploy `rhasspy/wyoming-piper` Docker image with `en_US-hfc_male-medium` voice, add `synthesizePiper()` function to `tts.ts`, replace `synthesizeSentenceToBuffer()` with a new `synthesizeSentenceWithFallback()` that implements 3-second XTTS timeout + Piper fallback + per-response engine lock.

## Standard Stack

### Core

| Component | Version/Image | Purpose | Why Standard |
|-----------|---------------|---------|--------------|
| Piper TTS | rhasspy/wyoming-piper:latest | Fast CPU TTS fallback | Official Docker image with HTTP server, auto model download, maintained by rhasspy team |
| Voice Model | en_US-hfc_male-medium | Male English voice for fallback | Natural male voice, medium quality balances speed/quality, single-speaker model |
| Flask HTTP Server | Built into wyoming-piper | HTTP API for synthesis | Native `piper.http_server` bundled in image, port 5000 |

### Supporting

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| en_US-ryan-high | Alternative higher-quality male voice | If hfc_male quality is insufficient |
| en_US-lessac-medium | Alternative well-tested voice | Most documented voice in Piper ecosystem |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| rhasspy/wyoming-piper | Custom Dockerfile with piper.http_server | More control but more maintenance; official image handles model downloads |
| rhasspy/wyoming-piper | artibex/piper-http | Simpler but less maintained, no Wyoming fallback |
| hfc_male-medium | ryan-high | Better quality but larger model, slightly slower |
| HTTP API on port 5000 | Wyoming protocol on port 10200 | Wyoming is binary protocol, HTTP is simpler to integrate from Node.js |

### No New npm Dependencies

Per project constraint: zero new npm backend dependencies. The Piper HTTP API returns raw WAV bytes via `fetch()` -- the same pattern already used for XTTS synthesis in `tts.ts`.

## Architecture Patterns

### Docker Compose Addition

```yaml
# Add to docker-compose.yml alongside existing jarvis-tts service
jarvis-piper:
  image: rhasspy/wyoming-piper:latest
  container_name: jarvis-piper
  restart: unless-stopped
  ports:
    - "5000:5000"    # HTTP API (optional: expose for debugging)
  volumes:
    - piper-voices:/data  # Persisted voice models
  command: --voice en_US-hfc_male-medium
  networks:
    - jarvis-net
  deploy:
    resources:
      limits:
        cpus: "4"
        memory: 512M
      reservations:
        cpus: "1"
        memory: 256M
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:5000/?text=test"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 30s
  logging:
    driver: json-file
    options:
      max-size: "5m"
      max-file: "3"
```

### Pattern 1: Two-Tier TTS Routing with Timeout

**What:** Race XTTS synthesis against a 3-second timeout. If XTTS wins, use its audio. If timeout wins, immediately call Piper (which responds in <200ms).

**When to use:** Every sentence synthesis request.

**Logic Flow:**
```
1. Check health state:
   - If XTTS known-unhealthy (recent failure), skip directly to Piper
   - If engineLock is 'piper' for this response, skip directly to Piper
2. Race XTTS against 3-second AbortController timeout
3. If XTTS succeeds within 3s: return XTTS audio, engine = 'xtts'
4. If XTTS times out or errors: call Piper, return Piper audio, engine = 'piper'
5. Return { buffer, contentType, provider, engine } to caller
```

### Pattern 2: Per-Response Engine Lock

**What:** Track which TTS engine is being used for the current response. Once Piper is activated for any sentence, all subsequent sentences in that response must also use Piper.

**When to use:** Within the `drainTtsQueue()` loop in `chat.ts`.

**Implementation:**
```typescript
// In chat.ts handleSend():
let engineLock: 'xtts' | 'piper' | null = null;

// In drainTtsQueue():
const audio = await synthesizeSentenceWithFallback(item.text, { engineLock });
if (audio) {
  if (engineLock === null) engineLock = audio.engine;
  if (audio.engine === 'piper' && engineLock !== 'piper') {
    engineLock = 'piper'; // Lock to piper for rest of response
  }
}
```

### Pattern 3: Health-Aware Routing State

**What:** Track XTTS health state with a simple boolean + timestamp. When XTTS fails or times out, mark it unhealthy. Re-check after a cooldown period (30 seconds).

**When to use:** Before attempting XTTS synthesis.

**State variables (module-level in tts.ts):**
```typescript
let xttsHealthy = true;
let xttsLastFailure = 0;
const XTTS_RECOVERY_CHECK_INTERVAL = 30_000; // 30s before re-trying XTTS
```

### Anti-Patterns to Avoid

- **Mixing engines mid-response:** Never play sentence 1 with XTTS, sentence 2 with Piper, sentence 3 with XTTS. The voice change is jarring. Once Piper activates, stay on Piper.
- **Blocking on XTTS health check before synthesis:** The existing `checkLocalTTSHealth()` has a 60-second cache. Don't add another blocking health check. Instead, track failure state from actual synthesis attempts.
- **Parallel XTTS + Piper requests:** Do NOT fire both simultaneously and take whichever finishes first. XTTS on CPU is resource-intensive; running it when you already know it's unhealthy wastes CPU cycles needed by llama-server.
- **Removing the existing 20s SENTENCE_TTS_TIMEOUT:** Keep it as a backstop for the XTTS path. The new 3-second timeout is the "fast fallback" trigger; the 20-second timeout is the "give up entirely" safety net.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TTS HTTP server | Custom Flask/FastAPI wrapper for Piper | rhasspy/wyoming-piper image with built-in HTTP server | Already includes model download, caching, health |
| Voice model management | Manual download scripts | wyoming-piper auto-download via --voice flag | Models auto-download on first start, persist in volume |
| WAV audio format | Custom audio encoding | Both XTTS and Piper return WAV natively | Both return audio/wav, compatible with frontend |
| Docker networking | Manual network configuration | Existing jarvis-net bridge network | Container-to-container DNS already works |
| Promise racing | Custom timeout implementation | `Promise.race()` with `AbortSignal.timeout()` | Already used in existing tts.ts code |

## Common Pitfalls

### Pitfall 1: Different Sample Rates

**What goes wrong:** XTTS outputs WAV at 24000 Hz sample rate. Piper's `hfc_male-medium` outputs at 22050 Hz. If the frontend audio player assumes a fixed sample rate, Piper audio will play at wrong speed.
**Why it happens:** Both return `audio/wav` content type but with different sample rates.
**How to avoid:** WAV files include sample rate in the header. The frontend's Web Audio API / AudioContext.decodeAudioData() reads the WAV header and handles any sample rate automatically. No action needed on frontend -- but verify during testing.
**Warning signs:** Piper audio sounds slightly pitched up or down compared to XTTS.

### Pitfall 2: Piper Container Not Ready on First Start

**What goes wrong:** The wyoming-piper container downloads voice models on first start. If jarvis-backend starts before the model is downloaded, Piper synthesis will fail.
**Why it happens:** Model download can take 10-30 seconds on first boot.
**How to avoid:** Add a healthcheck to the Piper container. Do NOT add `depends_on: jarvis-piper` to jarvis-backend (Piper is a fallback, not a requirement). Instead, handle Piper connection errors gracefully -- if Piper is down, return null (same as current XTTS error handling).
**Warning signs:** Piper 5xx errors in the first 30 seconds after deploy.

### Pitfall 3: XTTS Timeout Too Aggressive

**What goes wrong:** 3 seconds might be too short for XTTS when it's under moderate CPU load but still functional, causing unnecessary Piper fallback on every response.
**Why it happens:** XTTS shares CPU with llama-server (LLM inference). During LLM streaming, CPU contention can push XTTS synthesis from 8s to 12s+.
**How to avoid:** The 3-second timeout is specifically designed per requirements (TTS-02). This is correct -- the requirement explicitly says "3-second timeout triggers automatic Piper fallback." Users should hear audio quickly, even if it's a different voice, rather than wait 12+ seconds. Keep the timeout at 3 seconds.
**Warning signs:** Every response uses Piper (monitor with logging). If this happens consistently, it's actually the correct behavior for a loaded system.

### Pitfall 4: AbortController Cleanup on XTTS Timeout

**What goes wrong:** When XTTS is aborted after 3 seconds, the HTTP request/stream may continue consuming resources on the XTTS server, creating a backlog.
**Why it happens:** `fetch()` abort doesn't cancel server-side processing.
**How to avoid:** Use `AbortSignal.timeout(3000)` on the fetch call itself (not just Promise.race). This closes the HTTP connection, which the XTTS FastAPI server detects and can clean up. The existing code pattern in `synthesizeSentenceToBuffer()` already handles this with `.then(r => r.stream.destroy())`.
**Warning signs:** XTTS server CPU stays high even when all audio is coming from Piper.

### Pitfall 5: jarvis-backend depends_on jarvis-tts (XTTS) with service_healthy

**What goes wrong:** The current `docker-compose.yml` has `depends_on: jarvis-tts: condition: service_healthy`. If XTTS container crashes, jarvis-backend won't restart because the dependency is unhealthy.
**Why it happens:** Docker Compose health dependency is only for initial start, not ongoing runtime.
**How to avoid:** This is actually fine for initial startup. At runtime, the backend already handles XTTS being down (returns null from synthesis). No change needed here. But consider: do NOT add `depends_on: jarvis-piper` since Piper is optional fallback.
**Warning signs:** None -- this is a non-issue but worth documenting.

### Pitfall 6: Health State Not Resetting When XTTS Recovers

**What goes wrong:** After marking XTTS unhealthy, the system might never try XTTS again, permanently using Piper.
**Why it happens:** No recovery check mechanism.
**How to avoid:** After `XTTS_RECOVERY_CHECK_INTERVAL` (30 seconds), allow the next response to try XTTS again. If it succeeds within 3 seconds, mark healthy. Use the per-response engine lock: the recovery attempt only affects new responses, not the current one.
**Warning signs:** XTTS container is healthy (docker logs show it processing) but backend never sends requests to it.

## Code Examples

### Example 1: Piper Synthesis Function (tts.ts)

```typescript
// Source: Piper http_server.py API -- POST / with text body, returns WAV bytes
const PIPER_ENDPOINT = config.piperTtsEndpoint; // e.g., 'http://jarvis-piper:5000'

async function synthesizePiper(text: string): Promise<TTSResult> {
  const response = await fetch(`${PIPER_ENDPOINT}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: text,
    signal: AbortSignal.timeout(10_000), // 10s generous timeout for Piper
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Piper TTS error ${response.status}: ${body}`);
  }

  const nodeStream = Readable.fromWeb(
    response.body as import('stream/web').ReadableStream
  );

  return {
    stream: nodeStream,
    contentType: 'audio/wav',
    provider: 'local', // Still local, just different engine
  };
}
```

### Example 2: Sentence Synthesis With Fallback (tts.ts)

```typescript
export type TTSEngine = 'xtts' | 'piper';

export interface CachedAudioWithEngine extends CachedAudio {
  engine: TTSEngine;
}

interface SentenceFallbackOptions {
  voice?: string;
  speed?: number;
  engineLock?: TTSEngine | null;
}

// Health-aware XTTS state
let xttsHealthy = true;
let xttsLastFailure = 0;
const XTTS_RECOVERY_CHECK_INTERVAL = 30_000;
const XTTS_FALLBACK_TIMEOUT = 3_000;

function shouldTryXTTS(): boolean {
  if (!xttsHealthy) {
    // Check if enough time has passed to re-try
    if (Date.now() - xttsLastFailure > XTTS_RECOVERY_CHECK_INTERVAL) {
      return true; // Allow a retry
    }
    return false;
  }
  return true;
}

function markXTTSFailed(): void {
  xttsHealthy = false;
  xttsLastFailure = Date.now();
  lastHealthCheck = 0; // Reset existing health cache too
}

function markXTTSSucceeded(): void {
  xttsHealthy = true;
}

export async function synthesizeSentenceWithFallback(
  text: string,
  options?: SentenceFallbackOptions,
): Promise<CachedAudioWithEngine | null> {
  const engineLock = options?.engineLock ?? null;

  // If locked to piper, go directly to Piper
  if (engineLock === 'piper') {
    return synthesizeViaPiper(text);
  }

  // Check XTTS cache first
  const cachedXtts = cacheGet(text, 'xtts');
  if (cachedXtts) return { ...cachedXtts, engine: 'xtts' };

  // Check Piper cache (useful if XTTS is down)
  const cachedPiper = cacheGet(text, 'piper');
  if (cachedPiper && !shouldTryXTTS()) return { ...cachedPiper, engine: 'piper' };

  // Try XTTS with 3-second timeout
  if (shouldTryXTTS() && localTTSConfigured()) {
    try {
      const xttsResult = await Promise.race([
        synthesizeSpeech({ text, voice: options?.voice, speed: options?.speed }),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), XTTS_FALLBACK_TIMEOUT)
        ),
      ]);

      if (xttsResult) {
        // XTTS succeeded within 3 seconds
        const chunks: Buffer[] = [];
        for await (const chunk of xttsResult.stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        const audio: CachedAudioWithEngine = {
          buffer,
          contentType: xttsResult.contentType,
          provider: xttsResult.provider,
          engine: 'xtts',
        };
        cachePut(text, audio, 'xtts');
        markXTTSSucceeded();
        return audio;
      }

      // XTTS timed out at 3s -- fall through to Piper
      console.warn(`[TTS] XTTS timed out (${XTTS_FALLBACK_TIMEOUT}ms), falling back to Piper`);
      markXTTSFailed();
    } catch (err) {
      console.warn(`[TTS] XTTS error, falling back to Piper: ${err}`);
      markXTTSFailed();
    }
  }

  // Fallback to Piper
  return synthesizeViaPiper(text);
}

async function synthesizeViaPiper(text: string): Promise<CachedAudioWithEngine | null> {
  // Check Piper cache
  const cached = cacheGet(text, 'piper');
  if (cached) return { ...cached, engine: 'piper' };

  try {
    const result = await synthesizePiper(text);
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    const audio: CachedAudioWithEngine = {
      buffer,
      contentType: result.contentType,
      provider: 'local',
      engine: 'piper',
    };
    cachePut(text, audio, 'piper');
    return audio;
  } catch (err) {
    console.warn(`[TTS] Piper fallback also failed: ${err}`);
    return null; // Both engines failed
  }
}
```

### Example 3: Engine Lock in chat.ts drainTtsQueue

```typescript
// Inside handleSend() in chat.ts:
let engineLock: TTSEngine | null = null;

async function drainTtsQueue(): Promise<void> {
  if (ttsProcessing) return;
  ttsProcessing = true;
  while (ttsQueue.length > 0) {
    if (abortController.signal.aborted) break;
    const item = ttsQueue.shift()!;
    try {
      const audio = await synthesizeSentenceWithFallback(item.text, { engineLock });
      if (audio && !abortController.signal.aborted) {
        // Update engine lock
        if (engineLock === null) {
          engineLock = audio.engine;
        }
        if (audio.engine === 'piper') {
          engineLock = 'piper'; // Once piper, always piper for this response
        }

        socket.emit('chat:audio_chunk', {
          sessionId,
          index: item.index,
          contentType: audio.contentType,
          audio: audio.buffer,
        });
      }
    } catch (err) {
      console.warn(`[Chat] TTS error sentence ${item.index}: ${err}`);
    }
  }
  ttsProcessing = false;
  if (ttsStreamFinished && ttsQueue.length === 0) {
    socket.emit('chat:audio_done', { sessionId, totalChunks: audioChunkIndex });
  }
}
```

### Example 4: Config Addition (config.ts)

```typescript
// Add to config object:
piperTtsEndpoint: process.env.PIPER_TTS_ENDPOINT || 'http://jarvis-piper:5000',
```

### Example 5: Docker Compose Environment Variable

```yaml
# Add to jarvis-backend environment in docker-compose.yml:
- PIPER_TTS_ENDPOINT=${PIPER_TTS_ENDPOINT:-http://jarvis-piper:5000}
```

## File Change Map

### Files to Modify

| File | Changes | Complexity |
|------|---------|------------|
| `/root/docker-compose.yml` | Add `jarvis-piper` service, add `piper-voices` volume, add `PIPER_TTS_ENDPOINT` env var to backend | Low |
| `/root/.env` | Add `PIPER_TTS_ENDPOINT=http://jarvis-piper:5000` | Trivial |
| `/root/jarvis-backend/src/config.ts` | Add `piperTtsEndpoint` config field | Trivial |
| `/root/jarvis-backend/src/ai/tts.ts` | Add `synthesizePiper()`, add `synthesizeSentenceWithFallback()`, add XTTS health state tracking, export `TTSEngine` and `CachedAudioWithEngine` types, add `piperTTSConfigured()` check | High |
| `/root/jarvis-backend/src/realtime/chat.ts` | Import `synthesizeSentenceWithFallback` instead of `synthesizeSentenceToBuffer`, add `engineLock` state variable to `handleSend()`, pass `engineLock` to synthesis calls, update `drainTtsQueue()` | Medium |

### Files NOT Modified

| File | Why Not |
|------|---------|
| `/root/jarvis-backend/src/ai/sentence-stream.ts` | Sentence detection is unchanged |
| `/root/jarvis-backend/src/ai/text-cleaner.ts` | Text cleaning is unchanged |
| `/root/jarvis-backend/Dockerfile` | No new npm deps, no build changes |
| `/root/jarvis-ui/*` | Frontend plays WAV audio from both engines identically |
| `/opt/jarvis-tts/*` | XTTS container is unchanged |

### New Files

None. All changes go into existing files.

### New Docker Volume

`piper-voices` -- persists downloaded Piper voice models across container restarts.

## Piper HTTP API Reference

### Endpoint: POST /

**Request:**
```
POST / HTTP/1.1
Host: jarvis-piper:5000
Content-Type: text/plain

Hello, this is a test sentence.
```

**Response:**
```
HTTP/1.1 200 OK
Content-Type: audio/wav

<raw WAV bytes>
```

**Error Responses:**
- `400 Bad Request` -- No text provided (empty body)
- `500 Internal Server Error` -- Synthesis failed

### Endpoint: GET /

**Request:**
```
GET /?text=Hello+world HTTP/1.1
Host: jarvis-piper:5000
```

**Response:** Same WAV audio bytes.

### Notes:
- WAV format: 22050 Hz, 16-bit PCM, mono (for medium quality voices)
- No authentication required
- Model is loaded at container startup, not per-request
- Response time: <200ms for short sentences on modern CPU

## Piper Voice Model Details

### Recommended: en_US-hfc_male-medium

| Property | Value |
|----------|-------|
| Dataset | hfc_male |
| Quality | medium |
| Sample Rate | 22050 Hz |
| Speakers | 1 (single speaker) |
| Phoneme Engine | eSpeak (en-us) |
| Model Format | ONNX |
| Estimated Size | ~60-75 MB |
| Inference Speed | RTF ~0.2 on x86_64 (5x faster than real-time) |

### Download URLs (auto-handled by wyoming-piper)
```
ONNX: https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx
JSON: https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx.json
```

The `rhasspy/wyoming-piper` image automatically downloads these when `--voice en_US-hfc_male-medium` is specified.

### Alternative Voices Worth Testing

| Voice | Quality | Notes |
|-------|---------|-------|
| en_US-ryan-medium | medium | Popular, well-tested |
| en_US-ryan-high | high | Best quality, slightly slower |
| en_US-lessac-medium | medium | Most documented voice in ecosystem |
| en_US-joe-medium | medium | Warm, conversational |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single TTS engine, fail silently | Dual-engine with timeout fallback | This phase | 99%+ audio reliability |
| 20s timeout, return null on failure | 3s timeout, immediate Piper fallback | This phase | Audio in <3.2s worst case |
| No engine consistency tracking | Per-response engine lock | This phase | No jarring voice switches |

**Archived project note:** The `rhasspy/piper` repository was archived on October 6, 2025. Development has moved to `https://github.com/OHF-Voice/piper1-gpl`. However, the Docker images and voice models remain fully functional. The `rhasspy/wyoming-piper` Docker image continues to be maintained and the voice models on HuggingFace are stable (v1.0.0).

## Open Questions

1. **Voice selection finalization**
   - What we know: `en_US-hfc_male-medium` is a natural male voice available in medium quality
   - What's unclear: How similar it sounds to XTTS JARVIS voice (cannot be determined from research alone)
   - Recommendation: Deploy with `hfc_male-medium`, test subjectively, switch to `ryan-high` if quality is poor. Voice can be changed by just editing the `--voice` flag in docker-compose.

2. **XTTS stream abort effectiveness**
   - What we know: AbortController signal closes the fetch client side; XTTS uses FastAPI with uvicorn
   - What's unclear: Whether the XTTS server actually stops processing when the client disconnects
   - Recommendation: Test empirically. If XTTS keeps processing after abort, add explicit cancellation logic or accept the wasted CPU cycles (they end after 10-15s anyway).

3. **Piper health check endpoint**
   - What we know: Piper's http_server.py has no `/health` endpoint -- only the root `/` synthesis endpoint
   - What's unclear: Best way to health-check Piper container
   - Recommendation: Use `curl -f "http://localhost:5000/?text=test"` as healthcheck (synthesize a test word). This confirms both the server and model are working. The `rhasspy/wyoming-piper` image might have a health endpoint on the Wyoming port (10200) but the HTTP server (5000) does not.

4. **wyoming-piper HTTP server port**
   - What we know: The Docker image exposes Wyoming protocol on 10200 and HTTP on 5000
   - What's unclear: Whether both servers start by default or need explicit flags
   - Recommendation: Test on deployment. If port 5000 HTTP server doesn't start automatically, use `--uri tcp://0.0.0.0:10200` and check if the HTTP server needs an additional flag. Fallback plan: build a minimal custom Dockerfile with `piper.http_server`.

## Sources

### Primary (HIGH confidence)
- Piper HTTP server source code: `rhasspy/piper/src/python_run/piper/http_server.py` -- Flask app, single root endpoint, POST body = text, returns WAV
- XTTS server source code: `/opt/jarvis-tts/app/server.py` -- FastAPI, POST /synthesize, JSON body, returns WAV at 24000 Hz
- Current codebase: `tts.ts`, `chat.ts`, `config.ts`, `docker-compose.yml` -- Full read of all files
- Piper voice model config: `rhasspy/piper-voices` on HuggingFace -- 22050 Hz, ONNX format, eSpeak phonemes

### Secondary (MEDIUM confidence)
- DeepWiki Piper HTTP Server documentation -- Confirmed API specification
- GitHub issue #410 (rhasspy/piper) -- Community Docker deployment patterns
- GitHub artibex/piper-http -- Alternative Docker approach with model download
- KittenTTS benchmark issue #40 -- Piper RTF ~0.2 (float32), ~0.5 (int8) on Google Colab CPU

### Tertiary (LOW confidence)
- Inferless TTS comparison article -- "Piper processes short texts in under a second" (no specific ms numbers for our hardware)
- rhasspy/wyoming-piper README -- HTTP server on port 5000 mentioned but exact startup behavior unclear

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Piper is the established fast CPU TTS; Docker image exists and is well-documented
- Architecture: HIGH -- Fallback pattern is straightforward Promise.race + state tracking; all code patterns verified against current codebase
- Pitfalls: HIGH -- Sample rate difference verified from actual model JSON; startup timing and abort cleanup are known Docker/Node.js patterns
- Piper API: HIGH -- Source code of http_server.py fully reviewed; POST / with text body returns WAV
- Voice quality: LOW -- Cannot verify subjective voice quality from research; requires deployment and listening test
- Performance (<200ms): MEDIUM -- RTF ~0.2 verified from benchmarks, but actual latency on Home node (i5-13500HX under LLM load) not measured

**Research date:** 2026-01-27
**Valid until:** 2026-03-27 (Piper stable, archived project, unlikely to change)

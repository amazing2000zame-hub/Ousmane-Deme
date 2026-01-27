# Phase 23: TTS Performance -- Parallel Synthesis & Opus Encoding - Research

**Researched:** 2026-01-27
**Domain:** Parallel TTS synthesis, disk-persistent audio caching, Opus encoding, gapless Web Audio playback
**Confidence:** HIGH

## Summary

This research investigates four interconnected domains needed to deliver Phase 23: (1) bounded parallel TTS synthesis with max 2 concurrent workers, (2) disk-persistent TTS cache with startup pre-warming, (3) optional Opus encoding via FFmpeg for 8-10x smaller audio payloads, and (4) eliminating inter-sentence gaps in frontend audio playback.

The current backend (`chat.ts`) processes TTS sentences serially via `drainTtsQueue()` -- a single `while` loop that synthesizes one sentence at a time. The core change is to refactor this into a parallel worker model where up to 2 sentences synthesize concurrently, while preserving playback order via the existing index-based system. The existing in-memory LRU cache (`sentenceCache` Map in `tts.ts`, 200 entries) is lost on every container restart; replacing it with a file-system-backed cache on the `jarvis-data` Docker volume enables persistence. Opus encoding via `child_process.spawn('ffmpeg')` can compress WAV audio 8-10x before Socket.IO emission, but requires installing `ffmpeg` in the backend container. For gapless playback, the frontend's `progressive-queue.ts` must switch from `onended` callback chaining to precise `AudioBufferSourceNode.start(when)` scheduling using the Web Audio clock.

**Primary recommendation:** Implement bounded parallelism with a 2-slot semaphore in `drainTtsQueue()`, add file-system disk cache under `/data/tts-cache/` with SHA-256 keyed filenames, install `ffmpeg` in the backend Dockerfile for optional WAV-to-Opus transcoding, and refactor `playNextXttsChunk()` to use clock-scheduled gapless playback.

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Node.js `child_process.spawn` | Node 22 built-in | FFmpeg process spawning for Opus encoding | Zero-dependency, already used pattern in Node.js ecosystem |
| FFmpeg `libopus` | 7.1.3 (host), needs install in container | WAV-to-Opus transcoding | Standard audio codec tool, already on host with `--enable-libopus` |
| Node.js `crypto.createHash` | Node 22 built-in | SHA-256 cache key generation | Built-in, no dependencies |
| Node.js `fs/promises` | Node 22 built-in | Disk cache file read/write | Built-in, no dependencies |
| Web Audio API `AudioBufferSourceNode.start(when)` | Browser built-in | Gapless playback scheduling | W3C standard, sub-sample precision |

### Supporting

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| Docker `cpuset` in compose | CPU core pinning for XTTS container | Isolate XTTS from llama-server cores |
| `Promise.allSettled` | Wait for parallel TTS workers | When draining parallel queue slots |
| `OGG Opus` container format | Opus audio packaging | Required container for Opus -- browsers need OGG container |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `child_process.spawn('ffmpeg')` | `fluent-ffmpeg` npm package | Would violate zero-new-dependencies constraint |
| File-system disk cache | SQLite BLOB cache | More complex, DB already handles other data, file-per-entry simpler for audio buffers |
| `AudioBufferSourceNode.start(when)` scheduling | Pre-concatenating all WAV buffers into one | Would defeat progressive playback -- must wait for all audio before playing |
| Docker `cpuset` | `taskset` inside container | `cpuset` is cleaner, works at compose level, no runtime overhead |

**Installation (backend Dockerfile change):**
```dockerfile
# Add ffmpeg to backend container (node:22-slim base)
RUN apt-get update && apt-get install -y --no-install-recommends wget ffmpeg && rm -rf /var/lib/apt/lists/*
```

**No new npm dependencies.** All functionality uses Node.js built-ins (`child_process`, `crypto`, `fs/promises`) and browser Web Audio API.

## Architecture Patterns

### Pattern 1: Bounded Parallel TTS with Semaphore

**What:** Replace the serial `while` loop in `drainTtsQueue()` with a bounded-concurrency worker pattern. Up to 2 sentences synthesize simultaneously. Results emit in original sentence order regardless of completion order.

**When to use:** Every voice-mode response with multiple sentences.

**Key insight:** The current code already assigns `index` values at sentence detection time (before TTS), and the frontend sorts by index. This means parallel synthesis already produces correct ordering -- the only change needed is launching 2 synthesis tasks instead of 1.

**Implementation approach:**
```typescript
// In chat.ts handleSend(), replace serial drainTtsQueue with parallel:
const MAX_PARALLEL_TTS = 2;
let activeWorkers = 0;

async function drainTtsQueue(): Promise<void> {
  // Launch up to MAX_PARALLEL_TTS concurrent synthesis tasks
  while (ttsQueue.length > 0 && activeWorkers < MAX_PARALLEL_TTS) {
    if (abortController.signal.aborted) break;
    const item = ttsQueue.shift()!;
    activeWorkers++;

    // Fire-and-forget -- does NOT block the while loop
    synthesizeAndEmit(item).finally(() => {
      activeWorkers--;
      // When a slot frees, try to fill it
      drainTtsQueue();
    });
  }
}

async function synthesizeAndEmit(item: { text: string; index: number }): Promise<void> {
  try {
    const audio = await synthesizeSentenceWithFallback(item.text, { engineLock });
    if (audio && !abortController.signal.aborted) {
      // Engine lock updates (same as current)
      if (engineLock === null) engineLock = audio.engine;
      if (audio.engine === 'piper') engineLock = 'piper';

      // Optional Opus encoding before emission
      const payload = opusEnabled
        ? await encodeToOpus(audio.buffer)
        : { buffer: audio.buffer, contentType: audio.contentType };

      socket.emit('chat:audio_chunk', {
        sessionId,
        index: item.index,
        contentType: payload.contentType,
        audio: payload.buffer,
      });
    }
  } catch (err) {
    console.warn(`[Chat] TTS error sentence ${item.index}: ${err}`);
  }
}
```

**Why max 2 workers:** The Home node has 20 threads. llama-server uses 16 threads. XTTS is limited to 14 Docker CPU cores. With XTTS unable to batch (`batch_size=1` is a known "wontfix"), the second worker typically hits Piper (fast, <200ms). Two workers mean: worker 1 does XTTS (or Piper if locked), worker 2 pre-fetches the next sentence via Piper while worker 1 is still synthesizing.

### Pattern 2: Disk-Persistent TTS Cache with Pre-Warming

**What:** Replace the in-memory-only `sentenceCache` Map with a two-tier cache: in-memory LRU (fast path) backed by file-system storage (survives restarts). Pre-warm common phrases at startup.

**When to use:** Every TTS synthesis call (check cache) and at backend startup (pre-warm).

**Cache directory structure:**
```
/data/tts-cache/
├── xtts/
│   ├── a1b2c3d4e5f6...sha256.wav     # SHA-256 of normalized text
│   └── ...
└── piper/
    ├── a1b2c3d4e5f6...sha256.wav
    └── ...
```

**Cache key generation:**
```typescript
import { createHash } from 'node:crypto';

function diskCacheKey(text: string, engine: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}
```

**Pre-warm phrases (startup):**
```typescript
const PREWARM_PHRASES = [
  'Certainly, sir.',
  'Right away.',
  'Systems nominal.',
  'All systems operational.',
  'Good morning, sir.',
  'Good evening, sir.',
  'At your service.',
  'I\'ll look into that right away.',
  'Done.',
  'Task complete.',
  'Understood.',
  'Processing your request.',
];
```

**Volume mount (docker-compose.yml):**
The existing `jarvis-data:/data` volume already mounts `/data` in the backend container. The cache directory `/data/tts-cache/` will persist across container restarts. Current data volume usage is ~4.5MB (SQLite DB only), and the disk has 61GB available. A full cache of 200 entries at ~100KB per WAV entry = ~20MB -- negligible.

### Pattern 3: Optional Opus Encoding via FFmpeg

**What:** When enabled via config flag, transcode WAV audio buffers to OGG Opus before Socket.IO emission. Reduces payload size 8-10x.

**When to use:** Only when `config.opusEnabled` is true (intended for remote/WAN access, not LAN).

**FFmpeg pipe pattern (zero temp files):**
```typescript
import { spawn } from 'node:child_process';

function encodeWavToOpus(wavBuffer: Buffer, bitrate: number = 32): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',         // Read WAV from stdin
      '-c:a', 'libopus',      // Opus codec
      '-b:a', `${bitrate}k`,  // Bitrate (32k excellent for speech)
      '-vbr', 'on',           // Variable bitrate (better quality/size)
      '-application', 'voip', // Optimize for speech
      '-f', 'ogg',            // OGG container (required for Opus)
      'pipe:1',               // Write to stdout
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ buffer: Buffer.concat(chunks), contentType: 'audio/ogg; codecs=opus' });
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on('error', reject);

    // Write WAV buffer to stdin and signal end
    ffmpeg.stdin.write(wavBuffer);
    ffmpeg.stdin.end();
  });
}
```

**Size comparison (verified from research):**

| Format | Bitrate | Size per 5s sentence | Compression |
|--------|---------|---------------------|-------------|
| WAV (22050 Hz, 16-bit, mono) | ~353 kbps | ~220 KB | 1x (baseline) |
| OGG Opus (32 kbps VBR, speech) | ~32 kbps | ~20 KB | ~11x smaller |
| OGG Opus (24 kbps VBR, speech) | ~24 kbps | ~15 KB | ~15x smaller |

At 32 kbps VBR with `-application voip`, Opus provides excellent speech quality at ~10x compression. This meets the 8-10x requirement.

### Pattern 4: Gapless Frontend Playback via Clock Scheduling

**What:** Replace `source.onended` callback chaining with precise `AudioBufferSourceNode.start(when)` scheduling to eliminate gaps between sentences.

**Why current approach has gaps:** The current `playNextXttsChunk()` uses `source.onended` to trigger the next chunk. This introduces a gap because:
1. The `onended` event fires asynchronously (event loop delay)
2. `ctx.decodeAudioData()` is async (takes time to decode the next buffer)
3. Creating and connecting a new `AudioBufferSourceNode` takes time

**Solution:** Pre-decode and schedule the next buffer to start at exactly `currentTime + previousBuffer.duration`:
```typescript
let nextStartTime = 0; // Tracks when the next chunk should begin

async function playNextXttsChunk(): Promise<void> {
  if (xttsQueue.length === 0) {
    isPlayingXtts = false;
    if (xttsStreamDone) finalize();
    return;
  }

  isPlayingXtts = true;
  const chunk = xttsQueue.shift()!;

  try {
    const { ctx, gainNode: gain } = getSharedAudioContext();
    gain.gain.value = useVoiceStore.getState().volume;

    const audioBuffer = await ctx.decodeAudioData(chunk.buffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);
    currentSource = source;

    useVoiceStore.getState().setAnalyserNode(analyser);

    // Schedule at precise time (gapless)
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextStartTime);
    nextStartTime = startAt + audioBuffer.duration;

    source.onended = () => {
      currentSource = null;
      playNextXttsChunk();
    };

    source.start(startAt);

    // Pre-decode next chunk while current is playing
    if (xttsQueue.length > 0) {
      prefetchNextChunk();
    }
  } catch (err) {
    console.warn('[ProgressiveAudio] Failed to play chunk:', err);
    currentSource = null;
    playNextXttsChunk();
  }
}
```

**Critical detail:** `nextStartTime` is initialized to `0` at session start. On the first chunk, `Math.max(now, 0)` means it plays immediately. Each subsequent chunk is scheduled to start exactly when the previous one ends. The Web Audio clock has sub-sample precision, so there is zero gap.

**Pre-decoding optimization:** While the current chunk plays, decode the next chunk's `ArrayBuffer` into an `AudioBuffer`. This eliminates the decode latency between chunks:
```typescript
let prefetchedBuffer: AudioBuffer | null = null;
let prefetchedIndex: number = -1;

async function prefetchNextChunk(): Promise<void> {
  if (xttsQueue.length === 0) return;
  const next = xttsQueue[0]; // Peek, don't shift
  if (next.index === prefetchedIndex) return; // Already prefetched

  try {
    const { ctx } = getSharedAudioContext();
    prefetchedBuffer = await ctx.decodeAudioData(next.buffer.slice(0));
    prefetchedIndex = next.index;
  } catch {
    prefetchedBuffer = null;
    prefetchedIndex = -1;
  }
}
```

### Pattern 5: CPU Affinity via Docker Compose `cpuset`

**What:** Pin XTTS and Piper containers to specific CPU cores, leaving other cores free for llama-server.

**CPU layout (Home node: 20 threads on i5-13500HX):**

| Service | Current Config | Proposed `cpuset` | Rationale |
|---------|---------------|-------------------|-----------|
| llama-server (systemd) | `-t 16` (any cores) | No change (uses OS scheduler) | LLM needs most threads; OS will schedule across available cores |
| jarvis-tts (XTTS) | `cpus: "14"` limit | `cpuset: "0-3"` (4 cores) | XTTS processes 1 request at a time; 4 dedicated cores prevent contention |
| jarvis-piper | `cpus: "4"` limit | `cpuset: "4-5"` (2 cores) | Piper is lightweight; 2 cores are plenty for <200ms synthesis |
| jarvis-backend | No limit | `cpuset: "6-9"` (4 cores) | Node.js event loop + FFmpeg child processes |

**Important:** `cpuset` pins to specific cores, while `cpus` is a proportional limit. Using `cpuset` ensures XTTS and llama-server don't fight for the same cores. However, llama-server is a systemd service (not Docker), so it uses the OS scheduler across all cores. The `cpuset` values above ensure that Docker containers have dedicated cores while llama-server can use any remaining CPU time.

**Docker Compose syntax:**
```yaml
jarvis-tts:
  # ... existing config ...
  cpuset: "0-3"
  deploy:
    resources:
      limits:
        cpus: "4"
        memory: 16G

jarvis-piper:
  # ... existing config ...
  cpuset: "4-5"
  deploy:
    resources:
      limits:
        cpus: "2"
        memory: 512M

jarvis-backend:
  # ... existing config ...
  cpuset: "6-9"
  deploy:
    resources:
      limits:
        cpus: "4"
        memory: 2G
```

### Anti-Patterns to Avoid

- **Spawning a new FFmpeg process per chunk without pooling:** Each `spawn()` has ~5-10ms overhead. For a 5-sentence response, this is negligible. But do NOT create persistent long-running FFmpeg processes -- the one-shot spawn-per-buffer pattern is simpler and safer.
- **Caching Opus-encoded audio on disk:** Cache the WAV on disk, encode to Opus on emission. WAV is the source format that both engines produce; Opus encoding is a transport optimization. If the Opus flag changes, cached WAV still works.
- **Using `setTimeout` for gapless scheduling:** JavaScript timers have 4-16ms minimum precision. Use `AudioBufferSourceNode.start(when)` with the AudioContext clock for sub-sample precision.
- **Pre-warming TTS cache with parallel requests at startup:** Pre-warm serially (one phrase at a time) to avoid overwhelming XTTS at startup when it is also loading its model.
- **Storing cache files with text as filename:** Text can contain special characters. Use SHA-256 hex digest as filename.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Opus audio encoding | Custom WASM Opus encoder in Node.js | `child_process.spawn('ffmpeg')` with `libopus` | FFmpeg is standard, handles all edge cases, zero npm deps |
| Disk cache eviction | Custom LRU eviction with file timestamps | Simple directory with periodic cleanup script | Audio files are small (~100KB each); disk is abundant (61GB free). Over-engineering eviction for 200 files is wasteful |
| Gapless audio playback | Custom silence-detection and trimming | `AudioBufferSourceNode.start(when)` scheduling | Web Audio clock has sub-sample precision; WAV has no encoder padding (unlike MP3) |
| Cache key hashing | Custom string normalization | `crypto.createHash('sha256')` | Built-in, collision-resistant, filesystem-safe output |
| Parallel concurrency control | Custom mutex/lock implementation | Simple counter with `activeWorkers` variable | Two workers is simple enough that a counter suffices; no need for semaphore library |
| Browser Opus decoding | WASM-based Opus decoder | `AudioContext.decodeAudioData()` | All modern browsers (Chrome, Firefox, Safari 18.4+) decode OGG Opus natively |

**Key insight:** The zero-new-dependencies constraint makes `child_process.spawn('ffmpeg')` the clear choice for Opus encoding. FFmpeg is a system-level tool installed via `apt-get`, not an npm package.

## Common Pitfalls

### Pitfall 1: Engine Lock Race Condition with Parallel Workers

**What goes wrong:** Two parallel workers complete simultaneously. Worker 1 returns XTTS audio, Worker 2 returns Piper audio. The `engineLock` variable could be set inconsistently.
**Why it happens:** JavaScript is single-threaded BUT `await` yields. With 2 concurrent `synthesizeAndEmit()` calls, the engine lock update between the two is interleaved.
**How to avoid:** The engine lock MUST be set from the first worker that completes, then respected by all subsequent workers. Since `synthesizeSentenceWithFallback()` already accepts `engineLock` as input, pass the current lock value at call time. The lock update happens synchronously after each `await`, which is safe because Node.js is single-threaded -- only one worker's post-await code runs at a time.
**Warning signs:** Mixed XTTS and Piper audio in the same response.

### Pitfall 2: FFmpeg Not Available in Container

**What goes wrong:** The `node:22-slim` base image does not include FFmpeg. `spawn('ffmpeg')` will fail with `ENOENT`.
**Why it happens:** Slim images strip non-essential packages.
**How to avoid:** Add `ffmpeg` to the Dockerfile's `apt-get install` line alongside `wget`. This adds ~80MB to the image (Debian's ffmpeg package with libopus support is already compiled with `--enable-libopus`).
**Warning signs:** Backend crashes or logs `Error: spawn ffmpeg ENOENT` when Opus encoding is enabled.

### Pitfall 3: Safari OGG Opus Compatibility

**What goes wrong:** `AudioContext.decodeAudioData()` fails on Safari versions before 18.4 when given OGG Opus data.
**Why it happens:** Safari only gained full OGG container support in Safari 18.4 (macOS Sequoia 15.4, iOS 18.4) released in 2025. Older Safari versions cannot decode OGG Opus.
**How to avoid:** Since Opus encoding is an optional config flag (`config.opusEnabled`), it defaults to OFF. Users on LAN (the primary use case) get WAV which works everywhere. When enabled for remote access, the user accepts the browser requirement. Additionally, the backend should include the content type in the `audio_chunk` event so the frontend can detect format.
**Warning signs:** Audio plays on Chrome/Firefox but fails silently on Safari.

### Pitfall 4: Disk Cache Unbounded Growth

**What goes wrong:** The disk cache grows indefinitely as new phrases are synthesized, eventually consuming significant disk space.
**Why it happens:** No eviction policy on disk cache.
**How to avoid:** Implement a simple max-entries limit (e.g., 500 files per engine). On write, if directory has more than 500 files, delete the oldest by mtime. At ~100KB per file, 500 files = ~50MB per engine = ~100MB total -- negligible on a 61GB-free disk.
**Warning signs:** `/data/tts-cache/` growing beyond expected size.

### Pitfall 5: Gapless Scheduling with Variable Decode Times

**What goes wrong:** If `decodeAudioData()` for the next chunk takes longer than the current chunk's playback duration, there's still a gap.
**Why it happens:** WAV decoding is fast (~1-5ms) but not instantaneous. If a chunk is very short (e.g., "Done." = ~0.5s), the gap between `onended` firing and the next chunk starting could be perceptible.
**How to avoid:** Pre-decode the next chunk while the current one plays. With the `prefetchNextChunk()` pattern, the decode happens during playback time, so when `onended` fires, the buffer is already ready and can be scheduled immediately. The `start(when)` scheduling handles the precise timing.
**Warning signs:** Audible clicks or gaps between very short sentences.

### Pitfall 6: Parallel TTS Overloading CPU During LLM Inference

**What goes wrong:** With 2 TTS workers running simultaneously, CPU usage spikes and llama-server inference slows down by more than 10%.
**Why it happens:** XTTS and llama-server compete for the same CPU cores. Even with `cpuset`, shared L3 cache and memory bandwidth can cause interference.
**How to avoid:** The bounded limit of 2 workers is specifically chosen to be conservative. In practice, with the engine lock pattern, the second worker typically uses Piper (which takes <200ms and minimal CPU). Monitor with the latency tracing added in Phase 24. If LLM degradation exceeds 10%, reduce to 1 parallel worker as a fallback.
**Warning signs:** `tokens/sec` drops below ~24 t/s (current baseline ~27-52 t/s) during TTS synthesis.

### Pitfall 7: Race Between `onended` and Clock Scheduling

**What goes wrong:** Using both `onended` callback AND `start(when)` scheduling can cause the next chunk to start before or after the scheduled time if there's a mismatch.
**Why it happens:** `onended` fires asynchronously; `start(when)` is precise. If `onended` triggers `playNextXttsChunk()` but the next chunk was already clock-scheduled, you get double-playback.
**How to avoid:** Use `onended` ONLY for queue management (check if more chunks need processing), NOT for scheduling the start time. The `start(when)` call determines when audio plays; `onended` determines when to kick off the next decode/schedule cycle.
**Warning signs:** Audio artifacts, double-played chunks, or chunks playing at wrong times.

## Code Examples

### Example 1: Disk Cache Module (`tts-cache.ts`)

```typescript
// Source: Node.js built-in fs/promises and crypto
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CACHE_BASE = '/data/tts-cache';
const MAX_ENTRIES_PER_ENGINE = 500;

export async function initDiskCache(): Promise<void> {
  await mkdir(join(CACHE_BASE, 'xtts'), { recursive: true });
  await mkdir(join(CACHE_BASE, 'piper'), { recursive: true });
}

function hashKey(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

function cachePath(text: string, engine: string): string {
  return join(CACHE_BASE, engine, `${hashKey(text)}.wav`);
}

export async function diskCacheGet(text: string, engine: string): Promise<Buffer | null> {
  try {
    return await readFile(cachePath(text, engine));
  } catch {
    return null; // Cache miss
  }
}

export async function diskCachePut(text: string, engine: string, buffer: Buffer): Promise<void> {
  const path = cachePath(text, engine);
  await writeFile(path, buffer);
  // Fire-and-forget eviction check
  evictOldEntries(engine).catch(() => {});
}

async function evictOldEntries(engine: string): Promise<void> {
  const dir = join(CACHE_BASE, engine);
  const entries = await readdir(dir);
  if (entries.length <= MAX_ENTRIES_PER_ENGINE) return;

  // Get file stats and sort by mtime (oldest first)
  const withStats = await Promise.all(
    entries.map(async (name) => {
      const filePath = join(dir, name);
      const s = await stat(filePath);
      return { filePath, mtime: s.mtimeMs };
    })
  );
  withStats.sort((a, b) => a.mtime - b.mtime);

  // Delete oldest entries beyond the limit
  const toDelete = withStats.slice(0, withStats.length - MAX_ENTRIES_PER_ENGINE);
  for (const entry of toDelete) {
    await unlink(entry.filePath).catch(() => {});
  }
}
```

### Example 2: Opus Encoding Helper (`opus-encode.ts`)

```typescript
// Source: Node.js child_process.spawn + system FFmpeg
import { spawn } from 'node:child_process';

const OPUS_BITRATE = 32; // kbps, excellent for speech

export function encodeWavToOpus(wavBuffer: Buffer): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', `${OPUS_BITRATE}k`,
      '-vbr', 'on',
      '-application', 'voip',
      '-f', 'ogg',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: 'audio/ogg; codecs=opus',
        });
      } else {
        reject(new Error(`FFmpeg Opus encoding failed (exit ${code})`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });

    // Write WAV buffer and signal end
    ffmpeg.stdin.write(wavBuffer);
    ffmpeg.stdin.end();
  });
}
```

### Example 3: Pre-Warm Cache at Startup

```typescript
// Source: Application pattern -- call from backend init
import { synthesizeSentenceWithFallback } from './tts.js';
import { diskCacheGet, diskCachePut, initDiskCache } from './tts-cache.js';

const PREWARM_PHRASES = [
  'Certainly, sir.',
  'Right away.',
  'Systems nominal.',
  'All systems operational.',
  'Good morning, sir.',
  'Good evening, sir.',
  'At your service.',
  'Understood.',
  'Done.',
  'Task complete.',
  'Processing your request.',
  'I\'ll look into that right away.',
];

export async function prewarmTtsCache(): Promise<void> {
  await initDiskCache();

  let warmed = 0;
  let skipped = 0;

  for (const phrase of PREWARM_PHRASES) {
    // Check disk cache first
    const cached = await diskCacheGet(phrase, 'xtts');
    if (cached) {
      skipped++;
      continue;
    }

    // Synthesize and cache (serial to avoid XTTS overload at startup)
    try {
      const audio = await synthesizeSentenceWithFallback(phrase);
      if (audio) {
        await diskCachePut(phrase, audio.engine, audio.buffer);
        warmed++;
      }
    } catch (err) {
      console.warn(`[TTS Cache] Pre-warm failed for "${phrase}": ${err}`);
    }
  }

  console.log(`[TTS Cache] Pre-warm complete: ${warmed} synthesized, ${skipped} already cached`);
}
```

### Example 4: Config Additions

```typescript
// Add to config.ts:
// Opus encoding (optional -- adds latency, only useful for remote/WAN access)
opusEnabled: process.env.OPUS_ENABLED === 'true',
opusBitrate: parseInt(process.env.OPUS_BITRATE || '32', 10), // kbps

// TTS cache
ttsCacheDir: process.env.TTS_CACHE_DIR || '/data/tts-cache',
ttsCacheMaxEntries: parseInt(process.env.TTS_CACHE_MAX || '500', 10),

// Parallel TTS
ttsMaxParallel: parseInt(process.env.TTS_MAX_PARALLEL || '2', 10),
```

## File Change Map

### Files to Modify

| File | Changes | Complexity |
|------|---------|------------|
| `/root/jarvis-backend/Dockerfile` | Add `ffmpeg` to `apt-get install` | Trivial |
| `/root/docker-compose.yml` | Add `cpuset` to XTTS/Piper/backend services, add `OPUS_ENABLED` env var, add `TTS_CACHE_DIR` env var | Low |
| `/root/.env` | Add `OPUS_ENABLED=false`, `OPUS_BITRATE=32`, `TTS_MAX_PARALLEL=2` | Trivial |
| `/root/jarvis-backend/src/config.ts` | Add `opusEnabled`, `opusBitrate`, `ttsCacheDir`, `ttsCacheMaxEntries`, `ttsMaxParallel` config fields | Low |
| `/root/jarvis-backend/src/ai/tts.ts` | Integrate disk cache (read/write) into `synthesizeSentenceWithFallback()` and `synthesizeViaPiper()`, integrate in-memory + disk two-tier cache | High |
| `/root/jarvis-backend/src/realtime/chat.ts` | Replace serial `drainTtsQueue` with bounded-parallel pattern, add optional Opus encoding before `socket.emit`, add audio_done tracking for parallel completion | High |
| `/root/jarvis-ui/src/audio/progressive-queue.ts` | Replace `onended` chaining with `start(when)` clock scheduling, add pre-decode buffer, reset `nextStartTime` on new session | High |

### New Files

| File | Purpose | Complexity |
|------|---------|------------|
| `/root/jarvis-backend/src/ai/tts-cache.ts` | Disk cache module (init, get, put, evict) | Medium |
| `/root/jarvis-backend/src/ai/opus-encode.ts` | FFmpeg Opus encoding helper | Low |

### Files NOT Modified

| File | Why Not |
|------|---------|
| `/root/jarvis-backend/src/ai/sentence-stream.ts` | Sentence detection is unchanged |
| `/root/jarvis-backend/src/ai/text-cleaner.ts` | Text cleaning is unchanged |
| `/root/jarvis-ui/src/hooks/useChatSocket.ts` | Socket event handling unchanged (same events, just potentially different contentType) |
| `/root/jarvis-ui/src/hooks/useVoice.ts` | Monolithic playback unchanged |
| `/root/jarvis-ui/src/stores/voice.ts` | Voice state unchanged |
| `/root/jarvis-ui/src/stores/chat.ts` | Chat state unchanged |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Serial sentence TTS (1 at a time) | Bounded parallel (2 concurrent) | This phase | 30-50% faster multi-sentence responses |
| In-memory-only cache (lost on restart) | Two-tier: memory + disk (survives restart) | This phase | Common phrases instant after first use |
| WAV-only audio transport | Optional Opus (8-10x smaller) | This phase | Remote users get ~10x smaller payloads |
| `onended` callback chaining | `start(when)` clock scheduling | This phase | Zero-gap seamless playback |
| No CPU affinity | `cpuset` core pinning | This phase | Reduced CPU contention, more predictable latency |

## Browser Compatibility Note (Opus)

| Browser | OGG Opus `decodeAudioData` | Notes |
|---------|---------------------------|-------|
| Chrome | Full support | All versions |
| Firefox | Full support | All versions |
| Safari 18.4+ | Full support | macOS Sequoia 15.4, iOS 18.4+ required |
| Safari < 18.4 | NOT supported | OGG container not decoded; use WAV fallback |
| Edge | Full support | Chromium-based |

Since Opus is behind a config flag (default OFF), this is only relevant when explicitly enabled. WAV works universally.

## Open Questions

1. **Optimal Opus bitrate for JARVIS voice quality**
   - What we know: 32 kbps VBR with `-application voip` is standard for speech; provides ~10x compression
   - What's unclear: Whether the JARVIS finetuned voice retains enough character at 32k vs 48k vs 64k
   - Recommendation: Default to 32 kbps, make configurable via `OPUS_BITRATE` env var. Test subjectively.

2. **CPU affinity interaction with llama-server**
   - What we know: llama-server runs as systemd service with `-t 16`, uses OS scheduler across all 20 cores
   - What's unclear: Whether pinning Docker containers to cores 0-9 and leaving 10-19 for llama-server would be more effective than the proposed layout
   - Recommendation: Start with the proposed layout (XTTS 0-3, Piper 4-5, backend 6-9). Monitor with Phase 24 latency tracing. Adjust if LLM degradation exceeds 10%.

3. **Pre-warm timing relative to XTTS readiness**
   - What we know: XTTS container has a 300-second `start_period` healthcheck. Backend depends on `jarvis-tts: condition: service_healthy`.
   - What's unclear: How long after backend startup is XTTS actually ready for synthesis vs just passing health check
   - Recommendation: Add a 10-second delay before pre-warming, or trigger pre-warm after the first successful XTTS synthesis call. Serial pre-warm (one phrase at a time) to avoid overwhelming XTTS.

4. **FFmpeg encoding latency for Opus**
   - What we know: FFmpeg Opus encoding is fast (much faster than real-time for CPU)
   - What's unclear: Exact per-sentence overhead on the Home node under load
   - Recommendation: Benchmark during implementation. Expected: ~10-30ms per sentence for Opus encoding. If >50ms, consider only encoding for remote clients. This is why the feature is behind a config flag.

5. **Disk cache format if Opus is enabled**
   - What we know: Cache should store WAV (source format), not Opus (transport format)
   - What's unclear: Whether to also cache Opus-encoded versions to avoid re-encoding cached audio
   - Recommendation: Cache WAV only. Opus encoding is ~10-30ms -- negligible compared to TTS synthesis (200ms-15s). Re-encoding cached WAV to Opus on each retrieval is cheaper than maintaining two cache formats.

## Sources

### Primary (HIGH confidence)
- Current codebase: `tts.ts` (627 lines), `chat.ts` (544 lines), `progressive-queue.ts` (226 lines), `config.ts`, `docker-compose.yml`, `Dockerfile`, `package.json` -- Full read of all files
- Node.js v22 documentation: `child_process.spawn()`, `fs/promises`, `crypto.createHash` -- built-in APIs
- FFmpeg 7.1.3 on host: verified `--enable-libopus` in build configuration
- Docker volume: `root_jarvis-data` mounted at `/data`, 61GB available disk
- CPU topology: 20 threads, i5-13500HX, llama-server uses `-t 16`
- MDN Web API: `AudioBufferSourceNode.start(when, offset, duration)` -- precise scheduling API

### Secondary (MEDIUM confidence)
- [MDN AudioBufferSourceNode.start()](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start) -- `when` parameter for precise scheduling
- [Web Audio API Book (Boris Smus)](https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch02.html) -- Gapless scheduling patterns
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/) -- `--cpuset-cpus` documentation
- [Docker Compose Deploy Spec](https://docs.docker.com/reference/compose-file/deploy/) -- `cpuset` in compose
- [Can I Use: Opus](https://caniuse.com/opus) -- Browser support matrix
- [WebKit Features in Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) -- OGG Opus support added
- [Opus Codec Comparison](https://opus-codec.org/comparison/) -- Quality vs bitrate benchmarks
- [FFmpeg Opus Guide (ScribbleGhost)](https://scribbleghost.net/2022/12/29/convert-audio-to-opus-with-ffmpeg/) -- Command-line syntax
- [Node.js child_process streams (2ality)](https://2ality.com/2018/05/child-process-streams.html) -- stdin/stdout piping patterns
- [Transloadit FFmpeg Streaming Guide](https://transloadit.com/devtips/stream-video-processing-with-node-js-and-ffmpeg/) -- pipe:0/pipe:1 pattern
- [opusenc man page](https://mf4.xiph.org/jenkins/view/opus/job/opus-tools/ws/man/opusenc.html) -- Opus encoding parameters

### Tertiary (LOW confidence)
- [Sounds Fun (Jake Archibald)](https://jakearchibald.com/2016/sounds-fun/) -- Gapless playback challenges in browsers (2016, possibly outdated)
- [Gapless playback W3C discussion](https://lists.w3.org/Archives/Public/www-archive/2014Oct/0007.html) -- Historical context on gapless challenges
- [Advanced Web Machinery: Persistent File Cache](https://advancedweb.hu/how-to-implement-a-persistent-file-based-cache-in-node-js/) -- General cache patterns
- [Docker CPU pinning notes (GitHub Gist)](https://gist.github.com/qlyoung/abd217f977399003ba0cc277feca2af9) -- taskset vs cpuset inside containers

## Metadata

**Confidence breakdown:**
- Parallel synthesis: HIGH -- Pattern is straightforward bounded concurrency; existing index-based ordering preserves playback order
- Disk cache: HIGH -- Node.js fs/promises is well-understood; Docker volume already exists and has 61GB free
- Opus encoding: HIGH -- FFmpeg with libopus verified on host (7.1.3); child_process.spawn pattern is established; compression ratios verified from Opus docs
- Gapless playback: HIGH -- `AudioBufferSourceNode.start(when)` is W3C-standardized with sub-sample precision; WAV has no encoder padding (unlike MP3)
- CPU affinity: MEDIUM -- Docker `cpuset` is documented but interaction with systemd llama-server is empirical; proposed layout is educated guess, needs validation
- Safari Opus support: MEDIUM -- Verified Safari 18.4+ supports OGG Opus, but `decodeAudioData` specifically not tested (only `<audio>` element confirmed)
- Pre-warm timing: LOW -- Exact XTTS readiness after container startup is empirical; needs testing

**Research date:** 2026-01-27
**Valid until:** 2026-03-27 (stable technologies, unlikely to change)

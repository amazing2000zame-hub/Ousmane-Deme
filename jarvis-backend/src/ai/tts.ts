/**
 * Text-to-Speech provider abstraction.
 *
 * Supports three backends:
 *  - **Local XTTS** (preferred): Zero-shot voice cloning using Coqui XTTS v2.
 *    Runs on-cluster with custom JARVIS voice from reference audio clips.
 *    No API costs. CPU inference (~10-30s per response).
 *  - **ElevenLabs**: Natural, expressive voices with fine-tuned stability
 *    and similarity controls. Requires API key.
 *  - **OpenAI** (fallback): tts-1 model with preset voices (onyx, fable, etc).
 *    Functional but less natural inflection.
 *
 * Provider selection priority: local > elevenlabs > openai
 */

import OpenAI from 'openai';
import { Readable } from 'node:stream';
import http from 'node:http';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TTSProvider = 'local' | 'elevenlabs' | 'openai';
export type TTSEngine = 'xtts' | 'piper';
export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

interface TTSOptions {
  text: string;
  voice?: string;
  speed?: number;
  provider?: TTSProvider;
}

interface TTSResult {
  stream: Readable;
  contentType: string;
  provider: TTSProvider;
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

/** Whether the local XTTS service is configured (endpoint set). */
function localTTSConfigured(): boolean {
  return !!config.localTtsEndpoint;
}

/** Check if local XTTS service is actually reachable. Cached for 60s. */
let localTTSHealthy = false;
let lastHealthCheck = 0;

async function checkLocalTTSHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck < 60_000) return localTTSHealthy;

  try {
    const res = await fetch(`${config.localTtsEndpoint}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json() as { status?: string; voice_ready?: boolean };
    localTTSHealthy = data.status === 'ready' && data.voice_ready === true;
  } catch {
    localTTSHealthy = false;
  }
  lastHealthCheck = now;
  return localTTSHealthy;
}

// ---------------------------------------------------------------------------
// XTTS health state for fallback routing (TTS-03)
// ---------------------------------------------------------------------------

let xttsHealthy = true;
let xttsLastFailure = 0;
const XTTS_RECOVERY_CHECK_INTERVAL = 30_000; // 30s before re-trying XTTS
const XTTS_FALLBACK_TIMEOUT = 3_000; // 3s timeout triggers Piper (TTS-02)

function shouldTryXTTS(): boolean {
  if (!xttsHealthy) {
    if (Date.now() - xttsLastFailure > XTTS_RECOVERY_CHECK_INTERVAL) {
      return true; // Allow a recovery retry
    }
    return false;
  }
  return true;
}

function markXTTSFailed(): void {
  xttsHealthy = false;
  xttsLastFailure = Date.now();
  lastHealthCheck = 0; // Reset existing health cache so next health check re-probes
}

function markXTTSSucceeded(): void {
  xttsHealthy = true;
}

export function getActiveProvider(): TTSProvider | null {
  if (localTTSConfigured()) return 'local';
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

/** Whether Piper TTS fallback is configured (endpoint set). */
function piperTTSConfigured(): boolean {
  return !!config.piperTtsEndpoint;
}

export function ttsAvailable(): boolean {
  return getActiveProvider() !== null || piperTTSConfigured();
}

// ---------------------------------------------------------------------------
// Local XTTS v2 (zero-shot voice cloning)
// ---------------------------------------------------------------------------

/** XTTS v2 has a hard limit of 400 tokens (~1400 chars). Truncate at sentence boundary. */
const XTTS_MAX_CHARS = 1200;

function truncateForXTTS(text: string): string {
  if (text.length <= XTTS_MAX_CHARS) return text;
  // Try to cut at last sentence boundary within limit
  const truncated = text.slice(0, XTTS_MAX_CHARS);
  const lastPeriod = truncated.lastIndexOf('. ');
  if (lastPeriod > XTTS_MAX_CHARS * 0.5) {
    return truncated.slice(0, lastPeriod + 1);
  }
  return truncated;
}

async function synthesizeLocal(options: TTSOptions): Promise<TTSResult> {
  const { text, speed } = options;
  const endpoint = config.localTtsEndpoint;

  const safeText = truncateForXTTS(text);
  const response = await fetch(`${endpoint}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: safeText,
      voice: 'jarvis',
      language: 'en',
      speed: speed ?? 1.0,
    }),
    signal: AbortSignal.timeout(120_000), // 2 min timeout for CPU inference
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Local XTTS error ${response.status}: ${body}`);
  }

  const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

  return {
    stream: nodeStream,
    contentType: response.headers.get('content-type') ?? 'audio/wav',
    provider: 'local',
  };
}

// ---------------------------------------------------------------------------
// Piper TTS (fast CPU fallback, <200ms)
// ---------------------------------------------------------------------------

async function synthesizePiper(text: string): Promise<TTSResult> {
  const endpoint = config.piperTtsEndpoint;

  const response = await fetch(`${endpoint}/`, {
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
    provider: 'local',
  };
}

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

async function synthesizeElevenLabs(options: TTSOptions): Promise<TTSResult> {
  const { text, speed } = options;
  const voiceId = config.elevenlabsVoiceId;
  const apiKey = process.env.ELEVENLABS_API_KEY!;

  const response = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: config.elevenlabsModel,
      voice_settings: {
        stability: config.elevenlabsStability,
        similarity_boost: config.elevenlabsSimilarity,
        style: config.elevenlabsStyle,
        use_speaker_boost: true,
      },
      ...(speed && speed !== 1.0 ? { speed } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ElevenLabs API error ${response.status}: ${body}`);
  }

  // Convert Web ReadableStream to Node Readable
  const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

  return {
    stream: nodeStream,
    contentType: 'audio/mpeg',
    provider: 'elevenlabs',
  };
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function synthesizeOpenAI(options: TTSOptions): Promise<TTSResult> {
  const { text, voice, speed } = options;
  const client = getOpenAIClient();

  const response = await client.audio.speech.create({
    model: config.ttsModel,
    voice: (voice ?? config.ttsVoice) as OpenAIVoice,
    speed: speed ?? config.ttsSpeed,
    input: text,
    response_format: 'mp3',
  });

  const nodeStream = response.body as unknown as Readable;

  return {
    stream: nodeStream,
    contentType: 'audio/mpeg',
    provider: 'openai',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synthesize speech from text. Hardcoded to local XTTS JARVIS voice.
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResult> {
  if (!localTTSConfigured()) {
    throw new Error('TTS unavailable: LOCAL_TTS_ENDPOINT not configured');
  }

  const healthy = await checkLocalTTSHealth();
  if (!healthy) {
    throw new Error('TTS unavailable: local XTTS service not healthy');
  }

  return synthesizeLocal(options);
}

// ---------------------------------------------------------------------------
// PERF-05: LRU sentence cache — common JARVIS phrases served instantly
// ---------------------------------------------------------------------------

interface CachedAudio {
  buffer: Buffer;
  contentType: string;
  provider: TTSProvider;
}

export interface CachedAudioWithEngine extends CachedAudio {
  engine: TTSEngine;
}

const SENTENCE_CACHE_MAX = 200;
const sentenceCache = new Map<string, CachedAudio>();

/** Normalize text for cache key (lowercase, trimmed, collapsed whitespace). */
function cacheKey(text: string, engine: string = 'xtts'): string {
  return `${engine}:${text.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function cachePut(text: string, audio: CachedAudio, engine: string = 'xtts'): void {
  const key = cacheKey(text, engine);
  // LRU eviction
  if (sentenceCache.size >= SENTENCE_CACHE_MAX) {
    const oldest = sentenceCache.keys().next().value!;
    sentenceCache.delete(oldest);
  }
  sentenceCache.set(key, audio);
}

function cacheGet(text: string, engine: string = 'xtts'): CachedAudio | undefined {
  const key = cacheKey(text, engine);
  const entry = sentenceCache.get(key);
  if (entry) {
    // Move to end (most recently used)
    sentenceCache.delete(key);
    sentenceCache.set(key, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// PERF-02: Synthesize to Buffer — used by streaming voice pipeline
// ---------------------------------------------------------------------------

/** Per-sentence TTS timeout — 20s for CPU-based XTTS inference.
 *  Typical synthesis: 8-15s per sentence. 20s covers slow cases without
 *  blocking the queue indefinitely when the server is unresponsive. */
const SENTENCE_TTS_TIMEOUT = 20_000;

/**
 * Synthesize a single sentence to a Buffer. Returns null on timeout or error.
 * Checks the LRU cache first (PERF-05).
 *
 * Uses a dedicated AbortController to properly cancel abandoned fetches,
 * preventing unhandled stream errors from crashing the process.
 */
export async function synthesizeSentenceToBuffer(
  text: string,
  options?: { voice?: string; speed?: number },
): Promise<CachedAudio | null> {
  // PERF-05: Check cache
  const cached = cacheGet(text, 'xtts');
  if (cached) return cached;

  // Bail early if no provider is available
  if (!ttsAvailable()) return null;

  // Race synthesis against timeout, with proper cleanup of the losing promise
  const synthesisPromise = synthesizeSpeech({ text, voice: options?.voice, speed: options?.speed });

  try {
    const result = await Promise.race([
      synthesisPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SENTENCE_TTS_TIMEOUT)),
    ]);

    if (!result) {
      // Timeout — destroy the stream when the synthesis eventually resolves
      // to prevent unhandled stream errors from the fetch abort timer
      synthesisPromise
        .then((r) => { r.stream.destroy(); })
        .catch(() => {}); // swallow rejection
      console.warn(`[TTS] Sentence synthesis timed out (${SENTENCE_TTS_TIMEOUT}ms): "${text.slice(0, 40)}..."`);
      // Reset health cache so next request re-checks
      lastHealthCheck = 0;
      return null;
    }

    // Collect stream into Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const audio: CachedAudio = {
      buffer,
      contentType: result.contentType,
      provider: result.provider,
    };

    // PERF-05: Cache for future use
    cachePut(text, audio, 'xtts');

    return audio;
  } catch (err) {
    // Also clean up in case of errors during stream consumption
    synthesisPromise
      .then((r) => { try { r.stream.destroy(); } catch {} })
      .catch(() => {});
    console.warn(`[TTS] Sentence synthesis failed: ${err instanceof Error ? err.message : err}`);
    // Reset health cache so next request re-checks (don't permanently mark healthy service as down)
    lastHealthCheck = 0;
    return null;
  }
}

// ---------------------------------------------------------------------------
// TTS-02/03/04: Sentence synthesis with Piper fallback
// ---------------------------------------------------------------------------

interface SentenceFallbackOptions {
  voice?: string;
  speed?: number;
  engineLock?: TTSEngine | null;
}

/**
 * Synthesize a sentence with automatic Piper fallback.
 *
 * Routing logic:
 * 1. If engineLock is 'piper', go directly to Piper (TTS-04: consistency)
 * 2. Check XTTS cache, then Piper cache
 * 3. If XTTS is healthy, race it against 3s timeout (TTS-02)
 * 4. If XTTS times out or errors, fall back to Piper (TTS-03)
 * 5. Track XTTS failures for health-aware routing
 */
export async function synthesizeSentenceWithFallback(
  text: string,
  options?: SentenceFallbackOptions,
): Promise<CachedAudioWithEngine | null> {
  const engineLock = options?.engineLock ?? null;

  // TTS-04: If locked to piper, go directly to Piper
  if (engineLock === 'piper') {
    return synthesizeViaPiper(text);
  }

  // Check XTTS cache first (free, instant)
  const cachedXtts = cacheGet(text, 'xtts');
  if (cachedXtts) return { ...cachedXtts, engine: 'xtts' as TTSEngine };

  // Check Piper cache if XTTS is known-unhealthy (skip waiting for XTTS)
  if (!shouldTryXTTS()) {
    const cachedPiper = cacheGet(text, 'piper');
    if (cachedPiper) return { ...cachedPiper, engine: 'piper' as TTSEngine };
    return synthesizeViaPiper(text);
  }

  // Try XTTS with 3-second timeout (TTS-02)
  if (localTTSConfigured()) {
    try {
      const synthesisPromise = synthesizeSpeech({
        text,
        voice: options?.voice,
        speed: options?.speed,
      });

      const xttsResult = await Promise.race([
        synthesisPromise,
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

      // XTTS timed out at 3s -- clean up the dangling promise and fall through to Piper
      synthesisPromise
        .then((r) => { try { r.stream.destroy(); } catch {} })
        .catch(() => {});
      console.warn(`[TTS] XTTS timed out (${XTTS_FALLBACK_TIMEOUT}ms), falling back to Piper`);
      markXTTSFailed();
    } catch (err) {
      console.warn(`[TTS] XTTS error, falling back to Piper: ${err instanceof Error ? err.message : err}`);
      markXTTSFailed();
    }
  }

  // Fallback to Piper
  return synthesizeViaPiper(text);
}

/**
 * Synthesize via Piper with cache check. Returns null if both engines fail.
 */
async function synthesizeViaPiper(text: string): Promise<CachedAudioWithEngine | null> {
  // Check Piper cache
  const cached = cacheGet(text, 'piper');
  if (cached) return { ...cached, engine: 'piper' as TTSEngine };

  if (!piperTTSConfigured()) {
    console.warn('[TTS] Piper not configured, cannot fallback');
    return null;
  }

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
    console.warn(`[TTS] Piper fallback also failed: ${err instanceof Error ? err.message : err}`);
    return null; // Both engines failed
  }
}

// ---------------------------------------------------------------------------
// PERF-06: TTS health check & container auto-restart
// ---------------------------------------------------------------------------

export async function checkTTSHealth(): Promise<{ healthy: boolean; responseMs: number; endpoint: string }> {
  const endpoint = config.localTtsEndpoint;
  const start = Date.now();
  try {
    const healthy = await checkLocalTTSHealth();
    const responseMs = Date.now() - start;
    if (!healthy) {
      // Fire-and-forget restart attempt
      restartTTSContainer().catch(() => {});
    }
    return { healthy, responseMs, endpoint };
  } catch {
    const responseMs = Date.now() - start;
    restartTTSContainer().catch(() => {});
    return { healthy: false, responseMs, endpoint };
  }
}

let lastRestartAttempt = 0;
const RESTART_COOLDOWN = 5 * 60 * 1000; // 5 minutes

export async function restartTTSContainer(): Promise<boolean> {
  const now = Date.now();
  if (now - lastRestartAttempt < RESTART_COOLDOWN) {
    console.log('[TTS] Restart skipped — cooldown active');
    return false;
  }
  lastRestartAttempt = now;

  console.log('[TTS] Attempting container restart via Docker API...');

  return new Promise<boolean>((resolve) => {
    const req = http.request(
      {
        socketPath: '/var/run/docker.sock',
        path: '/v1.45/containers/jarvis-tts/restart?t=10',
        method: 'POST',
        timeout: 30_000,
      },
      (res) => {
        const success = res.statusCode === 204;
        console.log(`[TTS] Restart ${success ? 'succeeded' : 'failed'} (HTTP ${res.statusCode})`);
        res.resume(); // drain response
        resolve(success);
      },
    );

    req.on('error', (err) => {
      console.warn(`[TTS] Restart error: ${err.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.warn('[TTS] Restart timed out (30s)');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimate TTS cost for a given text.
 * - Local XTTS: $0.00 (runs on cluster hardware)
 * - OpenAI: $0.015 per 1,000 characters (tts-1)
 * - ElevenLabs: ~$0.30 per 1,000 characters (starter plan, varies by tier)
 */
export function estimateTTSCost(text: string, provider?: TTSProvider): number {
  const p = provider ?? getActiveProvider() ?? 'openai';
  if (p === 'local') return 0;
  const chars = text.length;
  if (p === 'elevenlabs') {
    return (chars / 1000) * 0.30;
  }
  return (chars / 1000) * 0.015;
}

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
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TTSProvider = 'local' | 'elevenlabs' | 'openai';
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

export function getActiveProvider(): TTSProvider | null {
  if (localTTSConfigured()) return 'local';
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function ttsAvailable(): boolean {
  return getActiveProvider() !== null;
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
 * Synthesize speech from text. Automatically selects the best available provider.
 * Priority: local XTTS > ElevenLabs > OpenAI.
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResult> {
  const requestedProvider = options.provider ?? getActiveProvider();

  if (!requestedProvider) {
    throw new Error('TTS unavailable: no provider configured (LOCAL_TTS_ENDPOINT, ELEVENLABS_API_KEY, or OPENAI_API_KEY)');
  }

  // Local XTTS v2 — preferred (free, custom JARVIS voice)
  if (requestedProvider === 'local' && localTTSConfigured()) {
    const healthy = await checkLocalTTSHealth();
    if (healthy) {
      return synthesizeLocal(options);
    }
    // Fall through to cloud providers if local is down
    console.warn('[TTS] Local XTTS service unhealthy, falling back to cloud provider');
  }

  if (requestedProvider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
    return synthesizeElevenLabs(options);
  }

  if (requestedProvider === 'openai' && process.env.OPENAI_API_KEY) {
    return synthesizeOpenAI(options);
  }

  // Fallback: try whatever is available (skip local if already failed)
  if (process.env.ELEVENLABS_API_KEY) return synthesizeElevenLabs(options);
  if (process.env.OPENAI_API_KEY) return synthesizeOpenAI(options);

  throw new Error('TTS unavailable: no provider configured');
}

// ---------------------------------------------------------------------------
// PERF-05: LRU sentence cache — common JARVIS phrases served instantly
// ---------------------------------------------------------------------------

interface CachedAudio {
  buffer: Buffer;
  contentType: string;
  provider: TTSProvider;
}

const SENTENCE_CACHE_MAX = 50;
const sentenceCache = new Map<string, CachedAudio>();

/** Normalize text for cache key (lowercase, trimmed, collapsed whitespace). */
function cacheKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cachePut(text: string, audio: CachedAudio): void {
  const key = cacheKey(text);
  // LRU eviction
  if (sentenceCache.size >= SENTENCE_CACHE_MAX) {
    const oldest = sentenceCache.keys().next().value!;
    sentenceCache.delete(oldest);
  }
  sentenceCache.set(key, audio);
}

function cacheGet(text: string): CachedAudio | undefined {
  const key = cacheKey(text);
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

/** Per-sentence TTS timeout — 45s to accommodate CPU-based XTTS inference. */
const SENTENCE_TTS_TIMEOUT = 45_000;

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
  const cached = cacheGet(text);
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
    cachePut(text, audio);

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

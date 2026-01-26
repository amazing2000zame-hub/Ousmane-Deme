/**
 * Text-to-Speech provider abstraction.
 *
 * Supports two backends:
 *  - **ElevenLabs** (preferred): Natural, expressive voices with fine-tuned
 *    stability and similarity controls. Deep British male voices like "Daniel"
 *    deliver a convincing JARVIS tone.
 *  - **OpenAI** (fallback): tts-1 model with preset voices (onyx, fable, etc).
 *    Functional but less natural inflection.
 *
 * Provider selection: ElevenLabs is used when ELEVENLABS_API_KEY is set,
 * otherwise falls back to OpenAI if OPENAI_API_KEY is set.
 */

import OpenAI from 'openai';
import { Readable } from 'node:stream';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TTSProvider = 'elevenlabs' | 'openai';
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

export function getActiveProvider(): TTSProvider | null {
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function ttsAvailable(): boolean {
  return getActiveProvider() !== null;
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
 * ElevenLabs is preferred when configured, OpenAI as fallback.
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResult> {
  const requestedProvider = options.provider ?? getActiveProvider();

  if (!requestedProvider) {
    throw new Error('TTS unavailable: no API key configured (ELEVENLABS_API_KEY or OPENAI_API_KEY)');
  }

  if (requestedProvider === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
    return synthesizeElevenLabs(options);
  }

  if (requestedProvider === 'openai' && process.env.OPENAI_API_KEY) {
    return synthesizeOpenAI(options);
  }

  // Fallback: try whatever is available
  const fallback = getActiveProvider();
  if (!fallback) {
    throw new Error('TTS unavailable: no API key configured');
  }

  return fallback === 'elevenlabs'
    ? synthesizeElevenLabs(options)
    : synthesizeOpenAI(options);
}

/**
 * Estimate TTS cost for a given text.
 * - OpenAI: $0.015 per 1,000 characters (tts-1)
 * - ElevenLabs: ~$0.30 per 1,000 characters (starter plan, varies by tier)
 */
export function estimateTTSCost(text: string, provider?: TTSProvider): number {
  const p = provider ?? getActiveProvider() ?? 'openai';
  const chars = text.length;
  if (p === 'elevenlabs') {
    return (chars / 1000) * 0.30;
  }
  return (chars / 1000) * 0.015;
}

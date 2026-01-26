/**
 * Text-to-Speech provider using OpenAI TTS API.
 *
 * Returns audio as a Node.js Readable stream (audio/mpeg) for direct
 * piping to HTTP responses. Uses the tts-1 model with configurable
 * voice and speed settings.
 *
 * Default voice: "onyx" — deep, authoritative, closest to JARVIS tone.
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import type { Readable } from 'node:stream';

export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

interface TTSOptions {
  text: string;
  voice?: TTSVoice;
  speed?: number; // 0.25 to 4.0
}

interface TTSResult {
  stream: Readable;
  contentType: string;
}

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.ANTHROPIC_API_KEY ? undefined : process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Check if TTS is available (OpenAI API key configured).
 */
export function ttsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Generate speech audio from text using OpenAI TTS API.
 * Returns a readable stream of audio/mpeg data.
 */
export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResult> {
  const { text, voice, speed } = options;

  if (!ttsAvailable()) {
    throw new Error('TTS unavailable: OPENAI_API_KEY not configured');
  }

  const client = getClient();
  const response = await client.audio.speech.create({
    model: config.ttsModel,
    voice: voice ?? config.ttsVoice as TTSVoice,
    speed: speed ?? config.ttsSpeed,
    input: text,
    response_format: 'mp3',
  });

  // OpenAI SDK returns a Response object; convert body to Node stream
  const nodeStream = response.body as unknown as Readable;

  return {
    stream: nodeStream,
    contentType: 'audio/mpeg',
  };
}

/**
 * Estimate TTS cost for a given text.
 * OpenAI TTS pricing: $0.015 per 1,000 characters (tts-1).
 */
export function estimateTTSCost(text: string): number {
  const chars = text.length;
  return (chars / 1000) * 0.015;
}

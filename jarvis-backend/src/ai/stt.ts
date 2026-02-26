/**
 * Speech-to-Text client for Jarvis Whisper service.
 *
 * Sends audio to the jarvis-whisper container and returns transcripts.
 */

import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptionResult {
  transcript: string;
  language: string;
  languageProbability: number;
  durationSeconds: number;
  processingTimeSeconds: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    noSpeechProb: number;
  }>;
}

// ---------------------------------------------------------------------------
// Health tracking
// ---------------------------------------------------------------------------

let whisperHealthy = true;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60_000; // 1 minute cache

/**
 * Check if Whisper STT service is available.
 */
export async function checkWhisperHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return whisperHealthy;
  }

  try {
    const res = await fetch(`${config.whisperEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { status?: string; model_loaded?: boolean };
    whisperHealthy = data.status === 'ready' && data.model_loaded === true;
  } catch {
    whisperHealthy = false;
  }

  lastHealthCheck = now;
  return whisperHealthy;
}

/**
 * Check if Whisper is configured.
 */
export function whisperConfigured(): boolean {
  return !!config.whisperEndpoint;
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * Transcribe audio buffer to text.
 *
 * @param audio - Audio buffer (WAV format preferred, 16kHz mono)
 * @param options - Optional transcription options
 * @returns Transcription result with text and metadata
 */
export async function transcribeAudio(
  audio: Buffer,
  options?: {
    language?: string;
    filename?: string;
  }
): Promise<TranscriptionResult> {
  if (!whisperConfigured()) {
    throw new Error('Whisper STT not configured (WHISPER_ENDPOINT not set)');
  }

  const healthy = await checkWhisperHealth();
  if (!healthy) {
    throw new Error('Whisper STT service not available');
  }

  // Build multipart form data using native FormData (compatible with fetch)
  // Use Uint8Array copy to avoid issues with Node.js pooled Buffer.buffer
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
    options?.filename || 'audio.wav',
  );

  if (options?.language) {
    form.append('language', options.language);
  }

  const response = await fetch(`${config.whisperEndpoint}/transcribe`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000), // 30s timeout for transcription
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Whisper transcription failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    transcript: string;
    language: string;
    language_probability: number;
    duration_seconds: number;
    processing_time_seconds: number;
    segments?: Array<{
      start: number;
      end: number;
      text: string;
      no_speech_prob: number;
    }>;
  };

  return {
    transcript: data.transcript,
    language: data.language,
    languageProbability: data.language_probability,
    durationSeconds: data.duration_seconds,
    processingTimeSeconds: data.processing_time_seconds,
    segments: data.segments?.map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
      noSpeechProb: seg.no_speech_prob,
    })),
  };
}

/**
 * Transcribe raw audio bytes (simpler endpoint for streaming).
 *
 * @param audio - Raw audio bytes (16kHz, 16-bit, mono WAV)
 * @returns Just the transcript text
 */
export async function transcribeRaw(audio: Buffer): Promise<string> {
  if (!whisperConfigured()) {
    throw new Error('Whisper STT not configured');
  }

  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
    'audio.wav',
  );

  const response = await fetch(`${config.whisperEndpoint}/transcribe/raw`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Whisper transcription failed: ${response.status}`);
  }

  const data = (await response.json()) as { transcript: string };
  return data.transcript;
}

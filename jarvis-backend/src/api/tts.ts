/**
 * TTS REST endpoint.
 *
 * POST /api/tts — accepts { text, voice?, speed? } and streams back audio/mpeg.
 * Requires JWT authentication. Returns 503 if no TTS provider is configured.
 * Automatically uses ElevenLabs when available, falls back to OpenAI.
 */

import { Router } from 'express';
import { synthesizeSpeech, ttsAvailable, estimateTTSCost, getActiveProvider } from '../ai/tts.js';
import type { TTSProvider } from '../ai/tts.js';

export const ttsRouter = Router();

/** POST /api/tts — synthesize text to speech audio */
ttsRouter.post('/', async (req, res) => {
  try {
    if (!ttsAvailable()) {
      res.status(503).json({
        error: 'TTS unavailable',
        message: 'No TTS API key configured (ELEVENLABS_API_KEY or OPENAI_API_KEY). Use browser speech synthesis as fallback.',
        fallback: 'browser',
      });
      return;
    }

    const { text, voice, speed, provider } = req.body as {
      text?: string;
      voice?: string;
      speed?: number;
      provider?: TTSProvider;
    };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Missing or empty "text" field' });
      return;
    }

    // Cap text length to prevent abuse
    if (text.length > 10_000) {
      res.status(400).json({ error: 'Text too long (max 10,000 characters)' });
      return;
    }

    const result = await synthesizeSpeech({
      text: text.trim(),
      voice,
      speed,
      provider,
    });

    res.set('Content-Type', result.contentType);
    res.set('X-TTS-Provider', result.provider);
    res.set('X-TTS-Cost', estimateTTSCost(text, result.provider).toFixed(6));
    result.stream.pipe(res);
  } catch (err) {
    console.error('[TTS] Synthesis error:', err);
    res.status(500).json({
      error: 'TTS synthesis failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/** GET /api/tts/status — check TTS availability and active provider */
ttsRouter.get('/status', (_req, res) => {
  const provider = getActiveProvider();
  res.json({
    available: ttsAvailable(),
    provider: provider ?? 'none',
    fallback: 'browser',
  });
});

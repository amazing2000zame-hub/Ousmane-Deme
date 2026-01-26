/**
 * TTS REST endpoint.
 *
 * POST /api/tts — accepts { text, voice?, speed? } and streams back audio/mpeg.
 * Requires JWT authentication. Returns 503 if OpenAI TTS is not configured.
 */

import { Router } from 'express';
import { synthesizeSpeech, ttsAvailable, estimateTTSCost } from '../ai/tts.js';
import type { TTSVoice } from '../ai/tts.js';

export const ttsRouter = Router();

/** POST /api/tts — synthesize text to speech audio */
ttsRouter.post('/', async (req, res) => {
  try {
    if (!ttsAvailable()) {
      res.status(503).json({
        error: 'TTS unavailable',
        message: 'OpenAI API key not configured. Use browser speech synthesis as fallback.',
        fallback: 'browser',
      });
      return;
    }

    const { text, voice, speed } = req.body as {
      text?: string;
      voice?: TTSVoice;
      speed?: number;
    };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Missing or empty "text" field' });
      return;
    }

    // Cap text length to prevent abuse (10,000 chars ~ $0.15)
    if (text.length > 10_000) {
      res.status(400).json({ error: 'Text too long (max 10,000 characters)' });
      return;
    }

    const result = await synthesizeSpeech({
      text: text.trim(),
      voice,
      speed,
    });

    res.set('Content-Type', result.contentType);
    res.set('X-TTS-Cost', estimateTTSCost(text).toFixed(6));
    result.stream.pipe(res);
  } catch (err) {
    console.error('[TTS] Synthesis error:', err);
    res.status(500).json({
      error: 'TTS synthesis failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/** GET /api/tts/status — check TTS availability */
ttsRouter.get('/status', (_req, res) => {
  res.json({
    available: ttsAvailable(),
    provider: ttsAvailable() ? 'openai' : 'none',
    fallback: 'browser',
  });
});

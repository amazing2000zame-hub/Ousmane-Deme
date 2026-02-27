/**
 * REST /api/chat endpoint for non-streaming chat with full MCP tool pipeline.
 *
 * Phase 39: Provides a REST interface to the same LLM+MCP pipeline that
 * Socket.IO uses, enabling the Telegram bot and other API callers to
 * leverage all 33+ MCP tools without needing WebSocket connections.
 *
 * Authentication: X-API-Key header checked against JARVIS_API_KEY env var.
 *
 * Endpoints:
 *  - POST /api/chat          — Send a message, get full response
 *  - POST /api/chat/confirm  — Confirm/deny a RED/ORANGE-tier tool action
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { processChat, processConfirm } from '../ai/chat-pipeline.js';

export const chatApiRouter = Router();

/**
 * API key middleware for /api/chat routes.
 * Checks X-API-Key header against JARVIS_API_KEY env var.
 */
function apiKeyAuth(req: Request, res: Response, next: Function): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!config.jarvisApiKey) {
    res.status(503).json({ error: 'API key not configured on server' });
    return;
  }

  if (!apiKey || apiKey !== config.jarvisApiKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  next();
}

// Apply API key auth to all routes in this router
chatApiRouter.use(apiKeyAuth);

/**
 * POST /api/chat
 *
 * Request:  { message: string, sessionId?: string, source?: 'telegram'|'api' }
 * Response: { response: string, sessionId: string, provider: string, toolsUsed: string[], usage: object, cost: number }
 *
 * If a RED/ORANGE-tier tool needs confirmation, the response includes a
 * `confirmationNeeded` field. The caller should POST to /api/chat/confirm.
 */
chatApiRouter.post('/', async (req: Request, res: Response) => {
  const { message, sessionId, source } = req.body as {
    message?: string;
    sessionId?: string;
    source?: string;
  };

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    console.log(`[ChatAPI] Request from ${source || 'api'}: "${message.substring(0, 80)}..."`);

    const result = await processChat({
      message,
      sessionId,
      source: (source as 'telegram' | 'api') || 'api',
    });

    res.json(result);
  } catch (err) {
    console.error('[ChatAPI] Error:', err instanceof Error ? err.message : err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Chat processing failed',
    });
  }
});

/**
 * POST /api/chat/confirm
 *
 * Request:  { sessionId: string, toolUseId: string, confirmed: boolean }
 * Response: { response: string, toolsUsed: string[] }
 */
chatApiRouter.post('/confirm', async (req: Request, res: Response) => {
  const { sessionId, toolUseId, confirmed } = req.body as {
    sessionId?: string;
    toolUseId?: string;
    confirmed?: boolean;
  };

  if (!sessionId || !toolUseId || typeof confirmed !== 'boolean') {
    res.status(400).json({
      error: 'sessionId, toolUseId, and confirmed (boolean) are required',
    });
    return;
  }

  try {
    const result = await processConfirm({ sessionId, toolUseId, confirmed });
    res.json(result);
  } catch (err) {
    console.error('[ChatAPI] Confirm error:', err instanceof Error ? err.message : err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Confirmation processing failed',
    });
  }
});

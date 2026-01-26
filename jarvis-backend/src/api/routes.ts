import { Router } from 'express';
import type { Request, Response } from 'express';
import { healthRouter } from './health.js';
import { authMiddleware, handleLogin } from '../auth/jwt.js';
import { memoryStore } from '../db/memory.js';

const router = Router();

// Public routes (no auth required)
router.use('/api/health', healthRouter);
router.post('/api/auth/login', handleLogin);

// Auth middleware for all other /api/* routes
router.use('/api', authMiddleware);

// ---------------------------------------------------------------------------
// Memory API -- events, preferences (all protected by auth middleware above)
// ---------------------------------------------------------------------------

// GET /api/memory/events?limit=50&type=alert&node=Home&since=2026-01-01
router.get('/api/memory/events', (req: Request, res: Response) => {
  const { limit, type, node, since } = req.query;

  let results;
  if (since && typeof since === 'string') {
    results = memoryStore.getEventsSince(since);
  } else if (type && typeof type === 'string') {
    results = memoryStore.getEventsByType(
      type as 'alert' | 'action' | 'status' | 'metric',
      limit ? parseInt(limit as string, 10) : 20,
    );
  } else if (node && typeof node === 'string') {
    results = memoryStore.getEventsByNode(node, limit ? parseInt(limit as string, 10) : 20);
  } else {
    results = memoryStore.getRecentEvents(limit ? parseInt(limit as string, 10) : 50);
  }

  res.json({ events: results });
});

// GET /api/memory/events/unresolved
router.get('/api/memory/events/unresolved', (_req: Request, res: Response) => {
  const results = memoryStore.getUnresolved();
  res.json({ events: results });
});

// POST /api/memory/events
router.post('/api/memory/events', (req: Request, res: Response) => {
  const { type, severity, source, node, summary, details } = req.body as {
    type?: string;
    severity?: string;
    source?: string;
    node?: string;
    summary?: string;
    details?: string;
  };

  if (!type || !source || !summary) {
    res.status(400).json({ error: 'type, source, and summary are required' });
    return;
  }

  const event = memoryStore.saveEvent({
    type: type as 'alert' | 'action' | 'status' | 'metric',
    severity: (severity as 'info' | 'warning' | 'error' | 'critical') ?? 'info',
    source: source as 'monitor' | 'user' | 'jarvis' | 'system',
    node: node ?? null,
    summary,
    details: details ?? null,
  });

  res.status(201).json({ event });
});

// GET /api/memory/preferences
router.get('/api/memory/preferences', (_req: Request, res: Response) => {
  const prefs = memoryStore.getAllPreferences();
  res.json({ preferences: prefs });
});

// PUT /api/memory/preferences/:key
router.put('/api/memory/preferences/:key', (req: Request, res: Response) => {
  const key = req.params.key as string;
  const { value } = req.body as { value?: string };

  if (!key || value === undefined || value === null) {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }

  const pref = memoryStore.setPreference(key, String(value));
  res.json({ preference: pref });
});

// Protected routes will be added here by later plans
// e.g., router.use('/api/cluster', clusterRouter);

export { router };

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Namespace } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { healthRouter } from './health.js';
import { chatApiRouter } from './chat-api.js';
import { cameraRouter } from './camera.js';
import { authMiddleware, handleLogin } from '../auth/jwt.js';
import { memoryStore } from '../db/memory.js';
import { executeTool, getToolList } from '../mcp/server.js';
import { emitNodesNow, emitStorageNow } from '../realtime/emitter.js';
import { getMonitorStatus } from '../monitor/index.js';

const router = Router();

// Public routes (no auth required)
router.use('/api/health', healthRouter);
router.post('/api/auth/login', handleLogin);

// Chat API (API key auth, not JWT -- used by Telegram bot and external callers)
router.use('/api/chat', chatApiRouter);

// Public image routes (browser <img> tags don't send auth headers)
// These proxy to Frigate which is already on internal network only
router.get('/api/events/:eventId/thumbnail', async (req, res) => {
  const { getEventThumbnail } = await import('../clients/frigate.js');
  try {
    const buffer = await getEventThumbnail(req.params.eventId);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache thumbnails for 1 hour
    res.send(buffer);
  } catch (err) {
    console.error(`[Camera API] Failed to get thumbnail:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch thumbnail' });
  }
});

router.get('/api/events/:eventId/snapshot', async (req, res) => {
  const { getEventSnapshot } = await import('../clients/frigate.js');
  try {
    const buffer = await getEventSnapshot(req.params.eventId);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (err) {
    console.error(`[Camera API] Failed to get snapshot:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

router.get('/api/cameras/:camera/snapshot', async (req, res) => {
  const { getCameras, getLatestSnapshot } = await import('../clients/frigate.js');
  try {
    const cameras = await getCameras();
    if (!cameras.includes(req.params.camera)) {
      res.status(404).json({ error: `Camera '${req.params.camera}' not found` });
      return;
    }
    const buffer = await getLatestSnapshot(req.params.camera);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(buffer);
  } catch (err) {
    console.error(`[Camera API] Failed to get camera snapshot:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

// Auth middleware for all other /api/* routes
router.use('/api', authMiddleware);

// Camera API routes (proxies Frigate endpoints - protected routes like /events list)
router.use('/api', cameraRouter);

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

// ---------------------------------------------------------------------------
// Tools API -- execute MCP tools from the dashboard (all protected by auth)
// ---------------------------------------------------------------------------

// GET /api/tools -- list all registered tools with their safety tiers
router.get('/api/tools', (_req: Request, res: Response) => {
  const tools = getToolList();
  res.json({ tools });
});

// POST /api/tools/execute -- execute an MCP tool with safety enforcement
router.post('/api/tools/execute', async (req: Request, res: Response) => {
  const { tool, args, confirmed } = req.body as {
    tool?: string;
    args?: Record<string, unknown>;
    confirmed?: boolean;
  };

  if (!tool || typeof tool !== 'string') {
    res.status(400).json({ success: false, error: 'tool name is required' });
    return;
  }

  const toolArgs = args ?? {};
  if (confirmed) {
    toolArgs.confirmed = true;
  }

  const result = await executeTool(tool, toolArgs, 'api');

  // If blocked by safety tier, return 403
  if (result.blocked) {
    const statusCode = result.reason?.includes('not found') ? 404 : 403;
    res.status(statusCode).json({
      success: false,
      error: result.reason ?? 'Tool execution blocked',
      tier: result.tier,
      blocked: true,
    });
    return;
  }

  // If execution error (not blocked, but handler threw)
  if (result.isError) {
    res.status(500).json({
      success: false,
      error: result.content?.[0]?.text ?? 'Tool execution failed',
      tier: result.tier,
    });
    return;
  }

  // Success -- immediately emit updated data to connected clients
  // Determine affected resource type from tool name
  const storageTools = ['get_storage', 'get_backups'];
  const isStorageTool = storageTools.includes(tool);

  try {
    if (isStorageTool) {
      await emitStorageNow();
    } else {
      await emitNodesNow();
    }
  } catch (emitErr) {
    // Log but don't fail the request -- the tool execution succeeded
    console.warn('[Routes] Failed to emit after tool execution:', emitErr instanceof Error ? emitErr.message : emitErr);
  }

  res.json({
    success: true,
    result: result.content,
    tier: result.tier,
  });
});

export { router };

// ---------------------------------------------------------------------------
// Monitor API -- kill switch, autonomy level, action history
// Wired via dependency injection (eventsNs passed in, no circular imports)
// ---------------------------------------------------------------------------

export function setupMonitorRoutes(routerInstance: Router, eventsNs: Namespace): void {
  // GET /api/monitor/status -- aggregated monitor status
  routerInstance.get('/api/monitor/status', (_req: Request, res: Response) => {
    const status = getMonitorStatus();
    res.json(status);
  });

  // PUT /api/monitor/killswitch -- toggle kill switch
  routerInstance.put('/api/monitor/killswitch', (req: Request, res: Response) => {
    const { active } = req.body as { active: boolean };
    memoryStore.setPreference('autonomy.killSwitch', String(active));

    memoryStore.saveEvent({
      type: 'status',
      severity: active ? 'warning' : 'info',
      source: 'user',
      summary: active
        ? 'KILL SWITCH ACTIVATED -- autonomous actions disabled'
        : 'Kill switch deactivated -- autonomous actions re-enabled',
    });

    eventsNs.emit('event', {
      id: randomUUID(),
      type: 'status',
      severity: active ? 'warning' : 'info',
      title: active ? 'KILL SWITCH ACTIVATED' : 'Kill switch deactivated',
      message: active
        ? 'All autonomous actions disabled by operator'
        : 'Autonomous actions re-enabled',
      source: 'user',
      timestamp: new Date().toISOString(),
    });

    res.json({ killSwitch: active });
  });

  // GET /api/monitor/actions -- autonomy action audit log
  routerInstance.get('/api/monitor/actions', (req: Request, res: Response) => {
    const { limit } = req.query;
    const actions = memoryStore.getAutonomyActions(
      limit ? parseInt(limit as string, 10) : 50,
    );
    res.json({ actions });
  });

  // PUT /api/monitor/autonomy-level -- set autonomy level (0-4)
  routerInstance.put('/api/monitor/autonomy-level', (req: Request, res: Response) => {
    const { level } = req.body as { level: number };
    if (typeof level !== 'number' || level < 0 || level > 4) {
      res.status(400).json({ error: 'Level must be 0-4' });
      return;
    }
    memoryStore.setPreference('autonomy.level', String(level));
    res.json({ autonomyLevel: level });
  });

  // POST /api/monitor/test-alert -- emit a test alert notification (Phase 29 testing)
  routerInstance.post('/api/monitor/test-alert', (req: Request, res: Response) => {
    const { camera = 'front_door' } = req.body as { camera?: string };
    const testId = `test-${Date.now()}`;

    const notification = {
      id: testId,
      type: 'unknown_person' as const,
      camera,
      timestamp: Date.now() / 1000,
      thumbnailUrl: `/api/events/${testId}/thumbnail`,
      snapshotUrl: `/api/events/${testId}/snapshot`,
      message: `Unknown person detected at ${camera.replace(/_/g, ' ')}`,
    };

    console.log(`[Alert Monitor] TEST alert emitted for ${camera}`);
    eventsNs.emit('alert:notification', notification);

    res.json({ success: true, notification });
  });
}

/**
 * Camera API proxy routes for Frigate NVR.
 *
 * Proxies snapshot, thumbnail, and event endpoints from Frigate,
 * providing a unified API for the Jarvis dashboard camera view.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getCameras,
  getLatestSnapshot,
  getEventSnapshot,
  getEventThumbnail,
  getEvents,
  getFaceLibrary,
  getFaceConfig,
  addFaceFromEvent,
  deleteFace,
} from '../clients/frigate.js';

export const cameraRouter = Router();

/**
 * GET /api/cameras
 * Returns list of enabled camera names from Frigate.
 */
cameraRouter.get('/cameras', async (_req: Request, res: Response) => {
  try {
    const cameras = await getCameras();
    res.json({ cameras });
  } catch (err) {
    console.error('[Camera API] Failed to get cameras:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch camera list' });
  }
});

/**
 * GET /api/cameras/:camera/snapshot
 * Proxies latest snapshot from a camera.
 * Returns JPEG image with no-cache headers.
 */
cameraRouter.get('/cameras/:camera/snapshot', async (req: Request, res: Response) => {
  const camera = req.params.camera as string;

  try {
    const cameras = await getCameras();
    if (!cameras.includes(camera)) {
      res.status(404).json({ error: `Camera '${camera}' not found` });
      return;
    }

    const buffer = await getLatestSnapshot(camera);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.send(buffer);
  } catch (err) {
    console.error(`[Camera API] Failed to get snapshot for ${camera}:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

/**
 * GET /api/events/:eventId/thumbnail
 * Proxies event thumbnail from Frigate.
 * Returns JPEG image.
 */
cameraRouter.get('/events/:eventId/thumbnail', async (req: Request, res: Response) => {
  const eventId = req.params.eventId as string;

  try {
    const buffer = await getEventThumbnail(eventId);
    res.set('Content-Type', 'image/jpeg');
    res.send(buffer);
  } catch (err) {
    console.error(`[Camera API] Failed to get thumbnail for event ${eventId}:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch event thumbnail' });
  }
});

/**
 * GET /api/events/:eventId/snapshot
 * Proxies full event snapshot from Frigate.
 * Returns JPEG image.
 */
cameraRouter.get('/events/:eventId/snapshot', async (req: Request, res: Response) => {
  const eventId = req.params.eventId as string;

  try {
    const buffer = await getEventSnapshot(eventId);
    res.set('Content-Type', 'image/jpeg');
    res.send(buffer);
  } catch (err) {
    console.error(`[Camera API] Failed to get snapshot for event ${eventId}:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch event snapshot' });
  }
});

/**
 * GET /api/events
 * Proxies Frigate events list with query parameters.
 * Supported params: camera, label, limit, after, before, has_snapshot
 */
cameraRouter.get('/events', async (req: Request, res: Response) => {
  const { camera, label, limit, after, before, has_snapshot } = req.query;

  try {
    const options: {
      camera?: string;
      label?: string;
      limit?: number;
      after?: number;
      before?: number;
      has_snapshot?: boolean;
    } = {};

    if (typeof camera === 'string') options.camera = camera;
    if (typeof label === 'string') options.label = label;
    if (typeof limit === 'string') options.limit = parseInt(limit, 10);
    if (typeof after === 'string') options.after = parseInt(after, 10);
    if (typeof before === 'string') options.before = parseInt(before, 10);
    if (typeof has_snapshot === 'string') options.has_snapshot = has_snapshot === 'true' || has_snapshot === '1';

    const events = await getEvents(options);
    res.json(events);
  } catch (err) {
    console.error('[Camera API] Failed to get events:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ------------------------------------------------------------------ Face Library

/**
 * GET /api/faces
 * Returns face library with names and image counts.
 */
cameraRouter.get('/faces', async (_req: Request, res: Response) => {
  try {
    const faces = await getFaceLibrary();
    const faceConfig = await getFaceConfig();
    res.json({
      faces,
      config: faceConfig,
      names: Object.keys(faces),
      total: Object.keys(faces).length,
    });
  } catch (err) {
    console.error('[Camera API] Failed to get face library:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to fetch face library' });
  }
});

/**
 * POST /api/faces/:name/add
 * Add a face from an event to a person's library.
 * Body: { eventId: string }
 */
cameraRouter.post('/faces/:name/add', async (req: Request, res: Response) => {
  const name = req.params.name as string;
  const { eventId } = req.body as { eventId?: string };

  if (!eventId) {
    res.status(400).json({ error: 'eventId is required' });
    return;
  }

  try {
    const result = await addFaceFromEvent(name, eventId);
    if (result.success) {
      console.log(`[Face Library] Added face to ${name} from event ${eventId}`);
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('[Camera API] Failed to add face:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to add face' });
  }
});

/**
 * DELETE /api/faces/:name
 * Delete a person from the face library.
 */
cameraRouter.delete('/faces/:name', async (req: Request, res: Response) => {
  const name = req.params.name as string;

  try {
    const result = await deleteFace(name);
    if (result.success) {
      console.log(`[Face Library] Deleted ${name} from face library`);
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error('[Camera API] Failed to delete face:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to delete face' });
  }
});

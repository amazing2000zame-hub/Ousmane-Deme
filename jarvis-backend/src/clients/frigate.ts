/**
 * Frigate NVR REST API client for AI object detection and camera management.
 *
 * Connects to Frigate instance at http://192.168.1.61:5000
 * Provides access to events, snapshots, recordings, and camera status.
 */

import { config } from '../config.js';

export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  /** Face recognition: null, string (legacy), or [name, confidence] array */
  sub_label: string | [string, number] | null;
  zones: string[];
  score: number;
  top_score: number;
  start_time: number;
  end_time: number | null;
  has_clip: boolean;
  has_snapshot: boolean;
  thumbnail: string;
}

/** Parsed face recognition result */
export interface ParsedFaceLabel {
  name: string | null;
  confidence: number | null;
}

export interface FrigateCamera {
  name: string;
  enabled: boolean;
  detect: {
    enabled: boolean;
    width: number;
    height: number;
    fps: number;
  };
  record: {
    enabled: boolean;
  };
  snapshots: {
    enabled: boolean;
  };
}

export interface FrigateStats {
  detection_fps: number;
  detectors: Record<string, {
    pid: number;
    inference_speed: number;
    detection_start: number;
  }>;
  cameras: Record<string, {
    camera_fps: number;
    process_fps: number;
    skipped_fps: number;
    detection_fps: number;
    capture_pid: number;
    process_pid: number;
    pid: number;
  }>;
}

const TIMEOUT_MS = 15_000;

/**
 * GET a Frigate API endpoint.
 */
async function frigateGet<T>(path: string): Promise<T> {
  const url = `${config.frigateUrl}/api${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`Frigate GET ${path} failed: ${res.status} ${res.statusText} -- ${body}`);
    }

    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Frigate GET ${path} timed out after ${TIMEOUT_MS}ms`);
    }
    if (err instanceof Error && err.message.startsWith('Frigate')) {
      throw err;
    }
    throw new Error(
      `Frigate GET ${path} network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET a Frigate endpoint returning binary data (e.g., snapshots).
 */
async function frigateGetBinary(path: string): Promise<Buffer> {
  const url = `${config.frigateUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Frigate GET ${path} failed: ${res.status} ${res.statusText}`);
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Frigate GET ${path} timed out after ${TIMEOUT_MS}ms`);
    }
    if (err instanceof Error && err.message.startsWith('Frigate')) {
      throw err;
    }
    throw new Error(
      `Frigate GET ${path} network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ Events

/**
 * Get recent events from Frigate NVR.
 *
 * @param options - Filter options
 * @param options.camera - Filter by camera name
 * @param options.label - Filter by object label (person, car, package, etc.)
 * @param options.limit - Max number of results (default: 20)
 * @param options.after - Only events after this timestamp
 * @param options.before - Only events before this timestamp
 */
export async function getEvents(options?: {
  camera?: string;
  label?: string;
  limit?: number;
  after?: number;
  before?: number;
  has_clip?: boolean;
  has_snapshot?: boolean;
}): Promise<FrigateEvent[]> {
  const params = new URLSearchParams();
  if (options?.camera) params.set('camera', options.camera);
  if (options?.label) params.set('label', options.label);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.after) params.set('after', String(options.after));
  if (options?.before) params.set('before', String(options.before));
  if (options?.has_clip !== undefined) params.set('has_clip', String(options.has_clip ? 1 : 0));
  if (options?.has_snapshot !== undefined) params.set('has_snapshot', String(options.has_snapshot ? 1 : 0));

  const query = params.toString();
  return frigateGet<FrigateEvent[]>(`/events${query ? `?${query}` : ''}`);
}

/**
 * Get a specific event by ID.
 */
export async function getEvent(eventId: string): Promise<FrigateEvent> {
  return frigateGet<FrigateEvent>(`/events/${encodeURIComponent(eventId)}`);
}

/**
 * Get event summary (counts by label and camera).
 */
export async function getEventSummary(): Promise<{
  [camera: string]: {
    [label: string]: number;
  };
}> {
  return frigateGet<{ [camera: string]: { [label: string]: number } }>('/events/summary');
}

// ------------------------------------------------------------------ Snapshots

/**
 * Get the latest snapshot from a camera.
 * Returns raw image data (JPEG).
 */
export async function getLatestSnapshot(camera: string): Promise<Buffer> {
  return frigateGetBinary(`/api/${encodeURIComponent(camera)}/latest.jpg`);
}

/**
 * Get snapshot for a specific event.
 * Returns raw image data (JPEG).
 */
export async function getEventSnapshot(eventId: string): Promise<Buffer> {
  return frigateGetBinary(`/api/events/${encodeURIComponent(eventId)}/snapshot.jpg`);
}

/**
 * Get event thumbnail (smaller than snapshot).
 * Returns raw image data (JPEG).
 */
export async function getEventThumbnail(eventId: string): Promise<Buffer> {
  return frigateGetBinary(`/api/events/${encodeURIComponent(eventId)}/thumbnail.jpg`);
}

// ------------------------------------------------------------------ Config & Status

/**
 * Get Frigate configuration.
 */
export async function getConfig(): Promise<{
  cameras: Record<string, FrigateCamera>;
  [key: string]: unknown;
}> {
  return frigateGet<{ cameras: Record<string, FrigateCamera> }>('/config');
}

/**
 * Get Frigate stats (fps, detection speeds, etc.).
 */
export async function getStats(): Promise<FrigateStats> {
  return frigateGet<FrigateStats>('/stats');
}

/**
 * Get Frigate version.
 */
export async function getVersion(): Promise<string> {
  return frigateGet<string>('/version');
}

/**
 * Get list of enabled cameras.
 */
export async function getCameras(): Promise<string[]> {
  const config = await getConfig();
  return Object.entries(config.cameras)
    .filter(([_, cam]) => cam.enabled)
    .map(([name]) => name);
}

// ------------------------------------------------------------------ Convenience methods

/**
 * Get recent detections of a specific object type.
 */
export async function getRecentDetections(
  objectType: 'person' | 'car' | 'package' | 'dog' | 'cat',
  limit = 10,
): Promise<FrigateEvent[]> {
  return getEvents({ label: objectType, limit, has_snapshot: true });
}

/**
 * Check if a specific object type was detected recently (within last N minutes).
 */
export async function wasDetectedRecently(
  objectType: 'person' | 'car' | 'package' | 'dog' | 'cat',
  withinMinutes = 30,
): Promise<{
  detected: boolean;
  count: number;
  mostRecent: FrigateEvent | null;
}> {
  const after = Math.floor(Date.now() / 1000) - withinMinutes * 60;
  const events = await getEvents({ label: objectType, after, limit: 10 });
  return {
    detected: events.length > 0,
    count: events.length,
    mostRecent: events[0] ?? null,
  };
}

/**
 * Check if any cars are currently detected (for "who's home" feature).
 */
export async function checkForCars(withinMinutes = 15): Promise<{
  carsDetected: boolean;
  cameras: string[];
  count: number;
}> {
  const detection = await wasDetectedRecently('car', withinMinutes);
  const cameras = detection.detected
    ? [...new Set([detection.mostRecent!.camera])]
    : [];

  // Get all recent car events to find all cameras
  if (detection.detected) {
    const after = Math.floor(Date.now() / 1000) - withinMinutes * 60;
    const events = await getEvents({ label: 'car', after, limit: 20 });
    const uniqueCameras = [...new Set(events.map((e) => e.camera))];
    return {
      carsDetected: true,
      cameras: uniqueCameras,
      count: events.length,
    };
  }

  return {
    carsDetected: false,
    cameras: [],
    count: 0,
  };
}

/**
 * Check if Frigate is reachable.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await getVersion();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ Face Recognition

/**
 * Parse face recognition sub_label into structured format.
 * Frigate returns sub_label as:
 *   - null (no face detected)
 *   - string (legacy format, just name)
 *   - [name, confidence] array (face recognition with confidence)
 */
export function parseFaceSubLabel(
  subLabel: string | [string, number] | null,
): ParsedFaceLabel {
  if (subLabel === null) {
    return { name: null, confidence: null };
  }
  if (typeof subLabel === 'string') {
    return { name: subLabel, confidence: null };
  }
  if (Array.isArray(subLabel) && subLabel.length >= 2) {
    return { name: subLabel[0], confidence: subLabel[1] };
  }
  return { name: null, confidence: null };
}

/**
 * Get list of known faces from Frigate face library.
 * Returns names of all enrolled faces.
 */
export async function getFaceLibrary(): Promise<string[]> {
  try {
    // Frigate 0.16+ face library API endpoint
    return await frigateGet<string[]>('/face_recognition/labels');
  } catch {
    // Fallback: return empty if face recognition not enabled or endpoint unavailable
    return [];
  }
}

/**
 * Get recent events with recognized faces.
 * Returns only person events that have face recognition data.
 */
export async function getRecentFaceEvents(options?: {
  camera?: string;
  limit?: number;
  after?: number;
}): Promise<Array<FrigateEvent & { face: { name: string; confidence: number } }>> {
  const events = await getEvents({
    label: 'person',
    limit: options?.limit ?? 20,
    camera: options?.camera,
    after: options?.after,
    has_snapshot: true,
  });

  return events
    .filter((e) => e.sub_label !== null)
    .map((e) => {
      const parsed = parseFaceSubLabel(e.sub_label);
      return {
        ...e,
        face: {
          name: parsed.name ?? 'unknown',
          confidence: parsed.confidence ?? 0,
        },
      };
    });
}

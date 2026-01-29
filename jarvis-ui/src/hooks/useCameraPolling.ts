import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/auth';
import { useCameraStore } from '../stores/camera';

const BASE_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://192.168.1.50:4000';
const POLL_INTERVAL_MS = 10_000; // 10 seconds

/**
 * Hook that fetches camera list and polls snapshots every 10 seconds.
 * Manages blob URL lifecycle to prevent memory leaks.
 *
 * Call once at the component level where camera view is rendered.
 */
export function useCameraPolling(): void {
  const token = useAuthStore((s) => s.token);
  const cameras = useCameraStore((s) => s.cameras);
  const setCameras = useCameraStore((s) => s.setCameras);
  const setSnapshot = useCameraStore((s) => s.setSnapshot);
  const setLoading = useCameraStore((s) => s.setLoading);
  const setError = useCameraStore((s) => s.setError);
  const cleanup = useCameraStore((s) => s.cleanup);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch camera list
  const fetchCameras = useCallback(async () => {
    if (!token) return;

    try {
      const res = await fetch(`${BASE_URL}/api/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch cameras: ${res.status}`);
      }
      const data = (await res.json()) as { cameras: string[] };
      setCameras(data.cameras);
      setError(null);
    } catch (err) {
      console.error('[Camera] Failed to fetch camera list:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch cameras');
    }
  }, [token, setCameras, setError]);

  // Fetch snapshot for a single camera
  const fetchSnapshot = useCallback(async (camera: string, signal: AbortSignal) => {
    if (!token) return;

    try {
      const res = await fetch(`${BASE_URL}/api/cameras/${encodeURIComponent(camera)}/snapshot`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch snapshot for ${camera}: ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setSnapshot(camera, blobUrl);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // Ignore abort errors
      }
      console.error(`[Camera] Failed to fetch snapshot for ${camera}:`, err);
    }
  }, [token, setSnapshot]);

  // Fetch all snapshots
  const fetchAllSnapshots = useCallback(async () => {
    if (!token || cameras.length === 0) return;

    // Cancel any pending requests
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    try {
      await Promise.all(cameras.map((camera) => fetchSnapshot(camera, signal)));
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to fetch snapshots');
    } finally {
      setLoading(false);
    }
  }, [token, cameras, fetchSnapshot, setLoading, setError]);

  // Initial fetch of camera list
  useEffect(() => {
    if (token) {
      fetchCameras();
    }
    return () => {
      // Cleanup on unmount
      abortRef.current?.abort();
      cleanup();
    };
  }, [token, fetchCameras, cleanup]);

  // Start polling when cameras are available
  useEffect(() => {
    if (!token || cameras.length === 0) {
      return;
    }

    // Fetch immediately
    fetchAllSnapshots();

    // Set up polling interval
    intervalRef.current = setInterval(fetchAllSnapshots, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [token, cameras, fetchAllSnapshots]);
}

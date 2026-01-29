import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Camera State Store
// ---------------------------------------------------------------------------

export interface CameraSnapshot {
  camera: string;
  /** Blob URL for the snapshot image */
  blobUrl: string;
  /** Timestamp when snapshot was fetched */
  timestamp: number;
}

interface CameraState {
  /** List of available camera names */
  cameras: string[];
  /** Current snapshots keyed by camera name */
  snapshots: Record<string, CameraSnapshot>;
  /** Currently selected camera for modal view */
  selectedCamera: string | null;
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Last update timestamp */
  lastUpdate: number;

  // Actions
  setCameras: (cameras: string[]) => void;
  setSnapshot: (camera: string, blobUrl: string) => void;
  setSelectedCamera: (camera: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Clean up blob URLs to prevent memory leaks */
  cleanup: () => void;
}

export const useCameraStore = create<CameraState>()(
  devtools(
    (set, get) => ({
      cameras: [],
      snapshots: {},
      selectedCamera: null,
      loading: false,
      error: null,
      lastUpdate: 0,

      setCameras: (cameras) => {
        set({ cameras, lastUpdate: Date.now() }, false, 'camera/setCameras');
      },

      setSnapshot: (camera, blobUrl) => {
        const { snapshots } = get();
        // Revoke old blob URL if it exists to prevent memory leak
        const existing = snapshots[camera];
        if (existing?.blobUrl && existing.blobUrl !== blobUrl) {
          URL.revokeObjectURL(existing.blobUrl);
        }
        set(
          {
            snapshots: {
              ...snapshots,
              [camera]: { camera, blobUrl, timestamp: Date.now() },
            },
            lastUpdate: Date.now(),
          },
          false,
          'camera/setSnapshot',
        );
      },

      setSelectedCamera: (camera) => {
        set({ selectedCamera: camera }, false, 'camera/setSelectedCamera');
      },

      setLoading: (loading) => {
        set({ loading }, false, 'camera/setLoading');
      },

      setError: (error) => {
        set({ error }, false, 'camera/setError');
      },

      cleanup: () => {
        const { snapshots } = get();
        Object.values(snapshots).forEach((snap) => {
          if (snap.blobUrl) {
            URL.revokeObjectURL(snap.blobUrl);
          }
        });
        set({ snapshots: {} }, false, 'camera/cleanup');
      },
    }),
    { name: 'camera-store' },
  ),
);

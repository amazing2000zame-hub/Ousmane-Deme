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

export interface FrigateEvent {
  id: string;
  camera: string;
  label: string;
  sub_label: string | [string, number] | null;
  start_time: number;
  end_time: number | null;
  has_snapshot: boolean;
  has_clip: boolean;
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
  /** Camera for live stream modal */
  liveCamera: string | null;
  /** Whether live stream modal is open */
  liveModalOpen: boolean;

  // Actions
  setCameras: (cameras: string[]) => void;
  setSnapshot: (camera: string, blobUrl: string) => void;
  setSelectedCamera: (camera: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Open live stream modal for a camera */
  openLiveModal: (camera: string) => void;
  /** Close live stream modal */
  closeLiveModal: () => void;
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
      liveCamera: null,
      liveModalOpen: false,

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

      openLiveModal: (camera) => {
        set({ liveCamera: camera, liveModalOpen: true }, false, 'camera/openLiveModal');
      },

      closeLiveModal: () => {
        set({ liveCamera: null, liveModalOpen: false }, false, 'camera/closeLiveModal');
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

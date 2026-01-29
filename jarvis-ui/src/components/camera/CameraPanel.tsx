import { useCameraPolling } from '../../hooks/useCameraPolling';
import { useCameraStore } from '../../stores/camera';
import { CameraCard } from './CameraCard';
import { CameraModal } from './CameraModal';
import { EventList } from './EventList';
import { LiveStreamModal } from './LiveStreamModal';

/**
 * Camera panel displaying a 2-column grid of camera snapshots with live buttons.
 * Snapshots auto-refresh every 10 seconds.
 * Shows recent detection events below the camera grid.
 * Clicking a camera opens a modal with the full-size snapshot.
 * Clicking Live opens MSE stream modal.
 */
export function CameraPanel() {
  // Start polling for camera snapshots
  useCameraPolling();

  const cameras = useCameraStore((s) => s.cameras);
  const snapshots = useCameraStore((s) => s.snapshots);
  const loading = useCameraStore((s) => s.loading);
  const error = useCameraStore((s) => s.error);
  const setSelectedCamera = useCameraStore((s) => s.setSelectedCamera);
  const liveCamera = useCameraStore((s) => s.liveCamera);
  const liveModalOpen = useCameraStore((s) => s.liveModalOpen);
  const openLiveModal = useCameraStore((s) => s.openLiveModal);
  const closeLiveModal = useCameraStore((s) => s.closeLiveModal);

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
      {/* Header with status */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-display text-jarvis-amber text-xs tracking-wider uppercase">
            SECURITY CAMERAS
          </span>
          <span className="text-[9px] text-jarvis-text-muted">
            ({cameras.length} online)
          </span>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-jarvis-cyan rounded-full animate-pulse" />
            <span className="text-[9px] text-jarvis-cyan font-display tracking-wider">
              UPDATING
            </span>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-jarvis-red/10 border border-jarvis-red/30 rounded-lg p-2">
          <span className="text-xs text-jarvis-red">{error}</span>
        </div>
      )}

      {/* Camera grid */}
      {cameras.length === 0 && !loading && !error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="font-display text-jarvis-text-dim text-sm tracking-wider">
              No cameras available
            </span>
            <p className="text-xs text-jarvis-text-muted mt-1">
              Frigate NVR may be offline
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 shrink-0">
          {cameras.map((camera) => {
            const snapshot = snapshots[camera];
            return (
              <div key={camera} className="relative">
                <CameraCard
                  camera={camera}
                  snapshotUrl={snapshot?.blobUrl ?? null}
                  timestamp={snapshot?.timestamp ?? null}
                  onClick={() => setSelectedCamera(camera)}
                />
                {/* Live button overlay */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openLiveModal(camera);
                  }}
                  className="absolute top-2 right-2 px-2 py-0.5 text-[9px] font-display uppercase tracking-wider bg-jarvis-red/80 text-white rounded hover:bg-jarvis-red transition-colors z-10"
                  title="Open live stream"
                >
                  Live
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent Events section */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-px bg-jarvis-amber/10" />
          <span className="text-[10px] font-display text-jarvis-text-muted uppercase tracking-wider">
            Recent Events
          </span>
          <div className="flex-1 h-px bg-jarvis-amber/10" />
        </div>

        <EventList maxEvents={10} pollInterval={10000} />
      </div>

      {/* Auto-refresh indicator */}
      <div className="flex items-center justify-center gap-1 shrink-0 pt-1 border-t border-jarvis-amber/10">
        <div className="w-1 h-1 bg-jarvis-amber/50 rounded-full" />
        <span className="text-[8px] text-jarvis-text-muted font-display tracking-wider">
          AUTO-REFRESH: 10s
        </span>
      </div>

      {/* Full-size snapshot modal */}
      <CameraModal />

      {/* Live stream modal */}
      {liveModalOpen && liveCamera && (
        <LiveStreamModal camera={liveCamera} onClose={closeLiveModal} />
      )}
    </div>
  );
}

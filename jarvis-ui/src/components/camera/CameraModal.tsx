import { useEffect, useCallback } from 'react';
import { useCameraStore } from '../../stores/camera';

/**
 * Full-size camera snapshot modal.
 * Closes via X button, backdrop click, or Escape key.
 */
export function CameraModal() {
  const selectedCamera = useCameraStore((s) => s.selectedCamera);
  const snapshots = useCameraStore((s) => s.snapshots);
  const setSelectedCamera = useCameraStore((s) => s.setSelectedCamera);

  const snapshot = selectedCamera ? snapshots[selectedCamera] : null;
  const isOpen = selectedCamera !== null && snapshot !== null;

  // Format camera name for display
  const displayName = selectedCamera
    ? selectedCamera.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

  const handleClose = useCallback(() => {
    setSelectedCamera(null);
  }, [setSelectedCamera]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} camera full view`}
    >
      {/* Modal content - prevent click propagation */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute -top-10 right-0 p-2 text-jarvis-amber hover:text-jarvis-amber-bright transition-colors focus:outline-none focus:ring-2 focus:ring-jarvis-amber/50 rounded"
          aria-label="Close modal"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Camera name header */}
        <div className="absolute -top-10 left-0 flex items-center gap-2">
          <span className="font-display text-jarvis-amber text-sm tracking-wider uppercase">
            {displayName}
          </span>
          {snapshot?.timestamp && (
            <span className="text-xs text-jarvis-text-muted">
              {new Date(snapshot.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Snapshot image */}
        <img
          src={snapshot?.blobUrl}
          alt={`${displayName} camera full view`}
          className="rounded-lg border-2 border-jarvis-amber/30 shadow-2xl shadow-jarvis-amber/10 max-w-full max-h-[85vh] object-contain"
        />

        {/* Corner decoration - JARVIS style */}
        <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-jarvis-amber/50 rounded-tl-lg pointer-events-none" />
        <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-jarvis-amber/50 rounded-tr-lg pointer-events-none" />
        <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-jarvis-amber/50 rounded-bl-lg pointer-events-none" />
        <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-jarvis-amber/50 rounded-br-lg pointer-events-none" />
      </div>
    </div>
  );
}

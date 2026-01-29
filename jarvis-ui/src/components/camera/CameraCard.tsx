import { memo } from 'react';

interface CameraCardProps {
  camera: string;
  snapshotUrl: string | null;
  timestamp: number | null;
  onClick: () => void;
}

/**
 * Individual camera snapshot card with name overlay and hover state.
 * Clicking opens the modal with full-size snapshot.
 */
export const CameraCard = memo(function CameraCard({
  camera,
  snapshotUrl,
  timestamp,
  onClick,
}: CameraCardProps) {
  // Format camera name for display (replace underscores with spaces, title case)
  const displayName = camera
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-video bg-jarvis-bg-panel rounded-lg overflow-hidden border border-jarvis-amber/10 hover:border-jarvis-amber/30 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-jarvis-amber/50"
    >
      {/* Snapshot image */}
      {snapshotUrl ? (
        <img
          src={snapshotUrl}
          alt={`${displayName} camera`}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-jarvis-text-muted text-xs font-display tracking-wider animate-pulse">
            LOADING...
          </div>
        </div>
      )}

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />

      {/* Camera name overlay */}
      <div className="absolute inset-x-0 bottom-0 p-2">
        <span className="font-display text-xs text-jarvis-amber tracking-wider uppercase">
          {displayName}
        </span>
        {timestamp && (
          <span className="ml-2 text-[9px] text-jarvis-text-muted">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Hover effect - subtle amber glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-jarvis-amber/5 transition-opacity duration-200 pointer-events-none" />

      {/* Focus indicator - expand icon hint */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-jarvis-amber"
        >
          <polyline points="15,3 21,3 21,9" />
          <polyline points="9,21 3,21 3,15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </div>
    </button>
  );
});

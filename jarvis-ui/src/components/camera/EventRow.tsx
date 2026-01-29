import { memo, useState } from 'react';
import type { FrigateEvent } from '../../stores/camera';

interface EventRowProps {
  event: FrigateEvent;
}

function parseFaceLabel(
  subLabel: FrigateEvent['sub_label']
): { name: string | null; confidence: number | null } {
  if (!subLabel) return { name: null, confidence: null };
  if (typeof subLabel === 'string') return { name: subLabel, confidence: null };
  if (Array.isArray(subLabel) && subLabel.length >= 2) {
    return { name: subLabel[0], confidence: subLabel[1] };
  }
  return { name: null, confidence: null };
}

/**
 * Single event row displaying thumbnail, object type badge, and face label.
 * Recognized faces show in green, unknown persons show in gray.
 */
export const EventRow = memo(function EventRow({ event }: EventRowProps) {
  const [imgError, setImgError] = useState(false);
  const face = parseFaceLabel(event.sub_label);

  // Format time: "2:45 PM"
  const time = new Date(event.start_time * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  // Format camera name
  const camera = event.camera
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Face label display
  const faceLabel =
    event.label === 'person' && face.name
      ? face.name
      : event.label === 'person'
        ? 'Unknown'
        : null;

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-jarvis-amber/5 last:border-0">
      {/* Thumbnail */}
      <div className="w-16 h-10 flex-shrink-0 rounded overflow-hidden bg-jarvis-bg-hover">
        {event.has_snapshot && !imgError ? (
          <img
            src={`/api/events/${event.id}/thumbnail`}
            alt={`${event.label} detection`}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[8px] text-jarvis-text-dim">
            No image
          </div>
        )}
      </div>

      {/* Event info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {/* Object type badge */}
          <span
            className={`text-[9px] font-display uppercase tracking-wider px-1 py-0.5 rounded ${
              event.label === 'person'
                ? 'bg-jarvis-cyan/20 text-jarvis-cyan'
                : event.label === 'car'
                  ? 'bg-jarvis-orange/20 text-jarvis-orange'
                  : 'bg-jarvis-amber/20 text-jarvis-amber'
            }`}
          >
            {event.label}
          </span>

          {/* Face label if person */}
          {faceLabel && (
            <span
              className={`text-[9px] font-display tracking-wider ${
                faceLabel === 'Unknown'
                  ? 'text-jarvis-text-dim'
                  : 'text-jarvis-green'
              }`}
            >
              {faceLabel}
              {face.confidence && face.confidence > 0 && (
                <span className="text-jarvis-text-muted ml-0.5">
                  ({Math.round(face.confidence * 100)}%)
                </span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-jarvis-text-dim truncate">
            {camera}
          </span>
          <span className="text-[10px] text-jarvis-text-muted">{time}</span>
        </div>
      </div>
    </div>
  );
});

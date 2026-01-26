import { useRef, useEffect } from 'react';
import { useClusterStore } from '../../stores/cluster';
import { GlowBorder } from '../shared/GlowBorder';
import type { JarvisEvent } from '../../types/events';

/** Format ISO timestamp to HH:MM:SS */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return '--:--:--';
  }
}

/** Severity color mapping */
const SEVERITY_COLORS: Record<JarvisEvent['severity'], string> = {
  info: 'text-jarvis-cyan',
  warning: 'text-jarvis-orange',
  error: 'text-jarvis-red',
  critical: 'text-jarvis-red font-bold',
};

/** Severity icon character */
const SEVERITY_ICONS: Record<JarvisEvent['severity'], string> = {
  info: '\u25CB',      // circle outline
  warning: '\u25B3',   // triangle
  error: '\u25CF',     // filled circle
  critical: '\u25C6',  // diamond
};

function EventRow({ event }: { event: JarvisEvent }) {
  const isHighSeverity = event.severity === 'error' || event.severity === 'critical';
  const colorClass = SEVERITY_COLORS[event.severity];
  const icon = SEVERITY_ICONS[event.severity];

  const content = (
    <div className="flex items-start gap-2 px-2 py-1.5 hover:bg-jarvis-bg-hover transition-colors rounded-sm">
      {/* Timestamp */}
      <span className="text-[10px] font-mono text-jarvis-text-muted whitespace-nowrap pt-0.5">
        {formatTime(event.timestamp)}
      </span>

      {/* Severity icon */}
      <span className={`text-xs ${colorClass} pt-0.5`}>{icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${colorClass} truncate`}>{event.title}</span>
          {event.node && (
            <span className="text-[9px] text-jarvis-text-muted font-mono">[{event.node}]</span>
          )}
        </div>
        <p className="text-[10px] text-jarvis-text-dim leading-tight truncate">
          {event.message}
        </p>
      </div>
    </div>
  );

  if (isHighSeverity) {
    return (
      <GlowBorder color="red" intensity="low" active>
        {content}
      </GlowBorder>
    );
  }

  return content;
}

export function ActivityFeed() {
  const events = useClusterStore((s) => s.events);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new events arrive (newest first)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events.length]);

  return (
    <div ref={containerRef} className="overflow-y-auto max-h-full">
      {events.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-xs text-jarvis-text-dim animate-pulse font-mono">
            No activity yet. Monitoring cluster...
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

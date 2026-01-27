import { memo, useRef, useEffect, useState, useMemo } from 'react';
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

/** Source badge labels and colors for visual distinction */
const SOURCE_BADGES: Record<string, { label: string; color: string }> = {
  monitor: { label: 'AUTO', color: 'text-jarvis-cyan' },
  jarvis: { label: 'AI', color: 'text-jarvis-amber' },
  user: { label: 'USER', color: 'text-jarvis-text-muted' },
  system: { label: 'SYS', color: 'text-jarvis-text-dim' },
};

/** Remediation sequence left border colors based on event title keywords */
function getRemediationBorderClass(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('escalation') || t.includes('failed')) return 'border-l-2 border-l-jarvis-red';
  if (t.includes('verified') || t.includes('resolved')) return 'border-l-2 border-l-jarvis-green';
  if (t.includes('remediating') || t.includes('acting') || t.includes('restarting')) return 'border-l-2 border-l-jarvis-cyan';
  if (t.includes('detected') || t.includes('crashed') || t.includes('unreachable')) return 'border-l-2 border-l-jarvis-orange';
  return '';
}

/** Feed filter mode */
type FilterMode = 'ALL' | 'AUTO' | 'ALERTS';

/** PERF-27: Memoized — new events render only new rows, not all existing ones. */
const EventRow = memo(function EventRow({ event }: { event: JarvisEvent }) {
  const isHighSeverity = event.severity === 'error' || event.severity === 'critical';
  const colorClass = SEVERITY_COLORS[event.severity];
  const icon = SEVERITY_ICONS[event.severity];

  const sourceBadge = event.source ? SOURCE_BADGES[event.source] : null;
  const remediationBorder = event.source === 'monitor' ? getRemediationBorderClass(event.title) : '';

  const content = (
    <div className={`flex items-start gap-2 px-2 py-1.5 hover:bg-jarvis-bg-hover transition-colors rounded-sm ${remediationBorder}`}>
      {/* Timestamp */}
      <span className="text-[10px] font-mono text-jarvis-text-muted whitespace-nowrap pt-0.5">
        {formatTime(event.timestamp)}
      </span>

      {/* Severity icon */}
      <span className={`text-xs ${colorClass} pt-0.5`}>{icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Source badge */}
          {sourceBadge && (
            <span className={`text-[8px] font-mono ${sourceBadge.color} border border-current/30 px-1 rounded-sm leading-tight`}>
              {sourceBadge.label}
            </span>
          )}
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
});

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: 'ALL', label: 'ALL' },
  { key: 'AUTO', label: 'AUTO' },
  { key: 'ALERTS', label: 'ALERTS' },
];

export function ActivityFeed() {
  const events = useClusterStore((s) => s.events);
  const containerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterMode>('ALL');

  // Filter events based on active filter mode
  const filteredEvents = useMemo(() => {
    switch (filter) {
      case 'AUTO':
        return events.filter((e) => e.source === 'monitor');
      case 'ALERTS':
        return events.filter((e) => e.severity === 'error' || e.severity === 'critical');
      default:
        return events;
    }
  }, [events, filter]);

  // Auto-scroll to top when new events arrive (newest first)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events.length]);

  return (
    <div className="flex flex-col max-h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-jarvis-amber/10 shrink-0">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`
              px-1.5 py-0.5 text-[9px] font-mono tracking-wider rounded
              transition-all duration-200
              ${filter === key
                ? 'bg-jarvis-amber/20 text-jarvis-amber border border-jarvis-amber/30'
                : 'text-jarvis-text-dim hover:text-jarvis-amber-dim border border-transparent'}
            `}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[9px] font-mono text-jarvis-text-dim">
          {filteredEvents.length}/{events.length}
        </span>
      </div>

      {/* Event list */}
      <div ref={containerRef} className="overflow-y-auto flex-1">
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-xs text-jarvis-text-dim animate-pulse font-mono">
              {events.length === 0
                ? 'No activity yet. Monitoring cluster...'
                : `No ${filter === 'AUTO' ? 'autonomous' : 'alert'} events`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filteredEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

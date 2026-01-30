import { useState } from 'react';

interface ToolStatusCardProps {
  name: string;
  status: string;
  result?: string;
  isError?: boolean;
}

const STATUS_CONFIG: Record<string, { color: string; pulse: boolean; label: string }> = {
  executing: { color: 'bg-jarvis-amber', pulse: true, label: 'Executing...' },
  done: { color: 'bg-green-400', pulse: false, label: 'Complete' },
  error: { color: 'bg-red-400', pulse: false, label: 'Failed' },
  confirmed: { color: 'bg-green-400', pulse: false, label: 'Authorized' },
  denied: { color: 'bg-jarvis-text-muted', pulse: false, label: 'Denied' },
};

/**
 * Compact tool execution status indicator.
 * Renders inline within a message: status dot + tool name + status text.
 * Optionally shows an expandable result preview for completed tools.
 */
export function ToolStatusCard({ name, status, result, isError }: ToolStatusCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[status] ?? { color: 'bg-jarvis-text-muted', pulse: false, label: status };

  const dotClass = `inline-block w-1.5 h-1.5 rounded-full ${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''}`;

  const statusTextColor =
    status === 'error' || status === 'denied'
      ? 'text-red-400'
      : status === 'done' || status === 'confirmed'
        ? 'text-green-400'
        : 'text-jarvis-amber';

  const hasPreview = result && status === 'done' && !isError;

  return (
    <div className="my-1 bg-jarvis-bg-card/30 border border-jarvis-amber/5 rounded px-2 py-1 overflow-hidden">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={dotClass} />
        <span className="text-[10px] font-mono text-jarvis-text-dim truncate max-w-[140px]">
          {name}
        </span>
        <span className={`text-[10px] font-mono ${statusTextColor}`}>{cfg.label}</span>
        {hasPreview && (
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="ml-auto text-[9px] font-mono text-jarvis-amber-dim hover:text-jarvis-amber transition-colors"
          >
            {expanded ? 'collapse' : 'expand'}
          </button>
        )}
      </div>
      {hasPreview && !expanded && (
        <p className="text-[10px] font-mono text-jarvis-text-muted mt-0.5 truncate">
          {result.slice(0, 80)}{result.length > 80 ? '...' : ''}
        </p>
      )}
      {hasPreview && expanded && (
        <pre className="text-[10px] font-mono text-jarvis-text-muted mt-1 whitespace-pre-wrap break-all max-w-full max-h-40 overflow-y-auto overflow-x-auto">
          {result}
        </pre>
      )}
    </div>
  );
}

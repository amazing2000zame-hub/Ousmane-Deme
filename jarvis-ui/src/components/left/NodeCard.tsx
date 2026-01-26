import { useState } from 'react';
import type { NodeData } from '../../types/cluster';
import { StatusDot } from '../shared/StatusDot';
import { UsageBar } from '../shared/UsageBar';
import { NodeDetail } from './NodeDetail';
import { formatUptime, formatPercent } from '../../utils/format';

interface NodeCardProps {
  node: NodeData;
}

function getPrimaryTemp(temps: Record<string, number>): number | null {
  const entries = Object.values(temps);
  if (entries.length === 0) return null;
  return entries[0];
}

function getTempColor(temp: number): string {
  if (temp > 80) return 'text-jarvis-red';
  if (temp > 65) return 'text-jarvis-orange';
  return 'text-jarvis-green';
}

export function NodeCard({ node }: NodeCardProps) {
  const [expanded, setExpanded] = useState(false);

  const cpuPercent = formatPercent(node.cpu);
  const cpuColor = node.cpu >= 0.9 ? 'text-jarvis-red' : node.cpu >= 0.7 ? 'text-jarvis-orange' : 'text-jarvis-green';
  const memFraction = node.maxmem > 0 ? node.mem / node.maxmem : 0;
  const uptimeStr = formatUptime(node.uptime);
  const primaryTemp = getPrimaryTemp(node.temperatures);

  return (
    <div
      className={
        'bg-jarvis-bg-card border border-jarvis-amber/10 rounded px-3 py-2 cursor-pointer transition-colors hover:bg-jarvis-bg-hover ' +
        (expanded ? 'ring-1 ring-jarvis-amber/20' : '')
      }
      onClick={() => setExpanded((prev) => !prev)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((prev) => !prev);
        }
      }}
    >
      {/* Compact view */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot
            status={node.status === 'online' ? 'online' : 'offline'}
            size="sm"
            pulse={node.status === 'online'}
          />
          <span className="font-body font-semibold text-sm text-jarvis-text">
            {node.node}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {primaryTemp !== null && (
            <span className={'text-xs font-mono ' + getTempColor(primaryTemp)}>
              {primaryTemp + '\u00B0C'}
            </span>
          )}
          <span className={'text-sm font-mono ' + cpuColor}>
            {cpuPercent}
          </span>
        </div>
      </div>

      {/* Usage bars */}
      <div className="mt-1.5 space-y-1">
        <UsageBar value={node.cpu} label="CPU" showPercent />
        <UsageBar value={memFraction} label="RAM" showPercent />
      </div>

      {/* Uptime */}
      <div className="mt-1 text-right">
        <span className="text-[10px] font-mono text-jarvis-text-dim">
          {'up ' + uptimeStr}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && <NodeDetail node={node} />}
    </div>
  );
}

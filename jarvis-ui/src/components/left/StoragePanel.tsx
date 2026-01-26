import { useClusterStore } from '../../stores/cluster';
import { PanelFrame } from '../layout/PanelFrame';
import { StalenessWarning } from '../shared/StalenessWarning';
import { StatusDot } from '../shared/StatusDot';
import { UsageBar } from '../shared/UsageBar';

/** Format bytes to human-readable GB/TB string */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const tb = bytes / (1024 ** 4);
  if (tb >= 1) return `${tb.toFixed(1)} TB`;
  const gb = bytes / (1024 ** 3);
  return `${gb.toFixed(1)} GB`;
}

/** Map storage status to StatusDot status */
function toStatusDotStatus(status: string): 'online' | 'offline' | 'warning' | 'unknown' {
  switch (status) {
    case 'active':
      return 'online';
    case 'inactive':
      return 'offline';
    default:
      return 'unknown';
  }
}

export function StoragePanel() {
  const storage = useClusterStore((s) => s.storage);

  return (
    <PanelFrame title="STORAGE">
      <StalenessWarning dataKey="storage" maxAgeMs={60000} />
      {storage.length === 0 ? (
        <p className="text-xs text-jarvis-text-dim px-2 py-3 text-center">
          Awaiting storage data...
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {storage.map((pool) => {
            const usage = pool.total > 0 ? pool.used / pool.total : 0;

            return (
              <div
                key={`${pool.node}-${pool.storage}`}
                className="px-2 py-1.5 bg-jarvis-bg-card rounded-sm border border-jarvis-amber/5"
              >
                {/* Header row: status + name + type + node */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={toStatusDotStatus(pool.status)} size="sm" />
                    <span className="text-xs text-jarvis-text font-mono">{pool.storage}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-jarvis-bg-hover text-jarvis-text-muted uppercase">
                      {pool.type}
                    </span>
                  </div>
                  <span className="text-[10px] text-jarvis-text-dim">{pool.node}</span>
                </div>

                {/* Usage bar */}
                <UsageBar
                  value={usage}
                  showPercent
                  thresholds={{ warn: 0.7, critical: 0.9 }}
                />

                {/* Capacity text */}
                <div className="text-[10px] text-jarvis-text-dim mt-0.5 font-mono text-right">
                  {formatBytes(pool.used)} / {formatBytes(pool.total)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PanelFrame>
  );
}

import type { NodeData } from '../../types/cluster';
import { UsageBar } from '../shared/UsageBar';
import { formatBytes, formatUptimeLong } from '../../utils/format';

interface NodeDetailProps {
  node: NodeData;
}

export function NodeDetail({ node }: NodeDetailProps) {
  const memUsed = formatBytes(node.mem);
  const memTotal = formatBytes(node.maxmem);
  const memFraction = node.maxmem > 0 ? node.mem / node.maxmem : 0;

  const diskUsed = formatBytes(node.disk);
  const diskTotal = formatBytes(node.maxdisk);
  const diskFraction = node.maxdisk > 0 ? node.disk / node.maxdisk : 0;

  const uptimeStr = formatUptimeLong(node.uptime);

  const temps = Object.entries(node.temperatures);

  return (
    <div className="mt-2 pt-2 border-t border-jarvis-amber/10 space-y-3">
      {/* CPU */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-display text-jarvis-amber-dim uppercase tracking-wider">
            CPU
          </span>
          <span className="text-xs font-mono text-jarvis-text">
            {Math.round(node.cpu * 100) + '% (' + node.maxcpu + ' cores)'}
          </span>
        </div>
        <UsageBar value={node.cpu} />
      </div>

      {/* RAM */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-display text-jarvis-amber-dim uppercase tracking-wider">
            MEMORY
          </span>
          <span className="text-xs font-mono text-jarvis-text">
            {memUsed + ' / ' + memTotal}
          </span>
        </div>
        <UsageBar value={memFraction} />
      </div>

      {/* Disk */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-display text-jarvis-amber-dim uppercase tracking-wider">
            DISK
          </span>
          <span className="text-xs font-mono text-jarvis-text">
            {diskUsed + ' / ' + diskTotal}
          </span>
        </div>
        <UsageBar value={diskFraction} />
      </div>

      {/* Uptime */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-display text-jarvis-amber-dim uppercase tracking-wider">
          UPTIME
        </span>
        <span className="text-xs font-mono text-jarvis-text">
          {uptimeStr}
        </span>
      </div>

      {/* Temperatures */}
      {temps.length > 0 && (
        <div>
          <span className="text-[10px] font-display text-jarvis-amber-dim uppercase tracking-wider block mb-1">
            TEMPERATURES
          </span>
          <div className="grid grid-cols-2 gap-1">
            {temps.map(([zone, temp]) => (
              <div key={zone} className="flex items-center justify-between px-2 py-0.5 bg-jarvis-bg-card rounded">
                <span className="text-[10px] font-mono text-jarvis-text-dim truncate mr-1">
                  {zone}
                </span>
                <span className={
                  'text-[10px] font-mono ' +
                  (temp > 80 ? 'text-jarvis-red' : temp > 65 ? 'text-jarvis-orange' : 'text-jarvis-green')
                }>
                  {temp + '\u00B0C'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

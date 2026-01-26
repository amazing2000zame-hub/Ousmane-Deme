import { useMemo } from 'react';
import { useClusterStore } from '../../stores/cluster';
import { PanelFrame } from '../layout/PanelFrame';
import { StalenessWarning } from '../shared/StalenessWarning';
import { VMCard } from './VMCard';

/** Sort order: running first, then paused, then stopped; within each group by VMID ascending */
const STATUS_ORDER: Record<string, number> = {
  running: 0,
  paused: 1,
  stopped: 2,
};

export function VMList() {
  const vms = useClusterStore((s) => s.vms);

  const sorted = useMemo(
    () =>
      [...vms].sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 3;
        const sb = STATUS_ORDER[b.status] ?? 3;
        if (sa !== sb) return sa - sb;
        return a.vmid - b.vmid;
      }),
    [vms],
  );

  return (
    <PanelFrame title={`VMS & CONTAINERS (${vms.length})`}>
      <StalenessWarning dataKey="vms" maxAgeMs={30000} />
      {sorted.length === 0 ? (
        <p className="text-xs text-jarvis-text-dim px-2 py-3 text-center">
          Awaiting VM data...
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {sorted.map((vm) => (
            <VMCard key={`${vm.node}-${vm.vmid}`} vm={vm} />
          ))}
        </div>
      )}
    </PanelFrame>
  );
}

import { useClusterStore } from '../../stores/cluster';
import { PanelFrame } from '../layout/PanelFrame';
import { StalenessWarning } from '../shared/StalenessWarning';
import { NodeCard } from './NodeCard';

export function NodeGrid() {
  const nodes = useClusterStore((s) => s.nodes);

  return (
    <PanelFrame title="CLUSTER NODES">
      <StalenessWarning dataKey="nodes" maxAgeMs={30000} />

      {nodes.length === 0 ? (
        <div className="py-4 text-center">
          <span className="text-sm font-mono text-jarvis-text-dim">
            Awaiting cluster data...
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      )}
    </PanelFrame>
  );
}

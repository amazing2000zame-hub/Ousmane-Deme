/** Dropdown to pick an SSH target node from the cluster */

interface ClusterNode {
  name: string;
  ip: string;
}

const CLUSTER_NODES: ClusterNode[] = [
  { name: 'Home', ip: '192.168.1.50' },
  { name: 'pve', ip: '192.168.1.74' },
  { name: 'agent1', ip: '192.168.1.61' },
  { name: 'agent', ip: '192.168.1.62' },
];

interface NodeSelectorProps {
  selectedNode: string | null;
  onSelect: (nodeName: string) => void;
  disabled?: boolean;
}

export default function NodeSelector({
  selectedNode,
  onSelect,
  disabled = false,
}: NodeSelectorProps) {
  return (
    <select
      value={selectedNode ?? ''}
      onChange={(e) => {
        if (e.target.value) {
          onSelect(e.target.value);
        }
      }}
      disabled={disabled}
      className={[
        'bg-jarvis-bg-card border border-jarvis-amber/30 rounded px-2 py-1',
        'font-mono text-sm outline-none cursor-pointer',
        'focus:border-jarvis-amber/60 transition-colors',
        selectedNode
          ? 'text-jarvis-amber'
          : 'text-jarvis-text-dim',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <option value="" className="bg-jarvis-bg-card text-jarvis-text-dim">
        Select node...
      </option>
      {CLUSTER_NODES.map((node) => (
        <option
          key={node.name}
          value={node.name}
          className="bg-jarvis-bg-card text-jarvis-text"
        >
          {node.name} ({node.ip})
        </option>
      ))}
    </select>
  );
}

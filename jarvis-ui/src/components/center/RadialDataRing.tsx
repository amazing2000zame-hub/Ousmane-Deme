import { memo } from 'react';
import { useClusterStore } from '../../stores/cluster';
import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';

/**
 * PERF-19: SVG filter definition hoisted outside render — created once, reused.
 */
const ARC_GLOW_FILTER = (
  <defs>
    <filter id="arc-glow">
      <feGaussianBlur stdDeviation="2" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
);

/** Fixed node order matching cluster layout */
const NODE_POSITIONS = [
  { name: 'Home', startAngle: -45, endAngle: 45 },
  { name: 'pve', startAngle: 45, endAngle: 135 },
  { name: 'agent1', startAngle: 135, endAngle: 225 },
  { name: 'agent', startAngle: 225, endAngle: 315 },
];

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToXY(cx, cy, r, endDeg);
  const end = polarToXY(cx, cy, r, startDeg);
  const sweep = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${sweep} 0 ${end.x} ${end.y}`;
}

/** CPU usage to color */
function cpuColor(cpu: number): string {
  if (cpu > 0.8) return 'var(--color-jarvis-red)';
  if (cpu > 0.5) return 'var(--color-jarvis-orange)';
  return 'var(--color-jarvis-amber)';
}

/**
 * SVG radial data ring showing node CPU/status arcs around the globe.
 * Each of 4 cluster nodes occupies a 90deg arc segment with a gap.
 */
export const RadialDataRing = memo(function RadialDataRing({ radius = 130, size = 300 }: { radius?: number; size?: number }) {
  const nodes = useClusterStore((s) => s.nodes);
  const visualMode = useUIStore((s) => s.visualMode);
  const modeConfig = VISUAL_MODES[visualMode];

  if (visualMode === 'minimal') return null;

  const cx = size / 2;
  const cy = size / 2;
  const gap = 4; // degrees gap between arcs

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="absolute pointer-events-none"
      style={{
        width: size,
        height: size,
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      {/* PERF-19: Glow filter hoisted — static defs never recreated */}
      {modeConfig.glowEffects && ARC_GLOW_FILTER}

      {NODE_POSITIONS.map(({ name, startAngle, endAngle }) => {
        const nodeData = nodes.find(
          (n) => n.node?.toLowerCase() === name.toLowerCase(),
        );
        const isOnline = nodeData?.status === 'online';
        const cpu = nodeData?.cpu ?? 0;

        // Arc with gap
        const arcStart = startAngle + gap;
        const arcEnd = endAngle - gap;
        const arcSpan = arcEnd - arcStart;
        const cpuEnd = arcStart + arcSpan * cpu;

        // Label position at arc midpoint
        const midAngle = (arcStart + arcEnd) / 2;
        const labelPos = polarToXY(cx, cy, radius + 16, midAngle);
        const statusPos = polarToXY(cx, cy, radius - 12, midAngle);

        return (
          <g key={name} filter={modeConfig.glowEffects ? 'url(#arc-glow)' : undefined}>
            {/* Background track */}
            <path
              d={describeArc(cx, cy, radius, arcStart, arcEnd)}
              fill="none"
              stroke="var(--color-jarvis-amber)"
              strokeWidth={3}
              strokeOpacity={0.1}
              strokeLinecap="round"
            />

            {/* CPU fill arc */}
            {cpu > 0.01 && (
              <path
                d={describeArc(cx, cy, radius, arcStart, cpuEnd)}
                fill="none"
                stroke={cpuColor(cpu)}
                strokeWidth={3}
                strokeLinecap="round"
                strokeOpacity={0.8}
              />
            )}

            {/* Node label */}
            <text
              x={labelPos.x}
              y={labelPos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="font-display"
              fill="var(--color-jarvis-amber-dim)"
              fontSize="8"
              letterSpacing="0.12em"
            >
              {name.toUpperCase()}
            </text>

            {/* Status dot */}
            <circle
              cx={statusPos.x}
              cy={statusPos.y}
              r={2.5}
              fill={isOnline ? 'var(--color-jarvis-green)' : 'var(--color-jarvis-red)'}
              opacity={isOnline ? 1 : 0.5}
            />

            {/* CPU percentage */}
            <text
              x={statusPos.x}
              y={statusPos.y + 10}
              textAnchor="middle"
              dominantBaseline="central"
              className="font-mono"
              fill="var(--color-jarvis-text-dim)"
              fontSize="7"
            >
              {nodeData ? `${Math.round(cpu * 100)}%` : '--'}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

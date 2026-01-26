import { useClusterStore } from '../../stores/cluster';
import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';

const STATUS_COLORS: Record<string, string> = {
  running: 'var(--color-jarvis-green)',
  stopped: 'var(--color-jarvis-text-muted)',
  paused: 'var(--color-jarvis-orange)',
};

/**
 * Small dots orbiting the globe representing VMs/containers.
 * Each marker orbits at a different speed and tilt.
 * Max 8 markers to avoid visual clutter.
 */
export function OrbitalMarkers({ orbitRadius = 120 }: { orbitRadius?: number }) {
  const vms = useClusterStore((s) => s.vms);
  const visualMode = useUIStore((s) => s.visualMode);
  const modeConfig = VISUAL_MODES[visualMode];

  // Prioritize running VMs, cap at 8
  const sorted = [...vms]
    .sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      return a.vmid - b.vmid;
    })
    .slice(0, 8);

  if (sorted.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {sorted.map((vm, i) => {
        const color = STATUS_COLORS[vm.status] ?? STATUS_COLORS.stopped;
        const duration = 15 + i * 2.5; // 15s to 32.5s
        const tilt = -10 + i * 7;      // slight tilt variation
        const delay = -(i * 3);        // offset start positions

        return (
          <div
            key={vm.vmid}
            className="absolute"
            style={{
              left: '50%',
              top: '50%',
              width: 0,
              height: 0,
              transform: `rotateX(${tilt}deg)`,
              transformStyle: 'preserve-3d',
            }}
          >
            <div
              title={`${vm.name} (${vm.status})`}
              style={{
                width: vm.status === 'running' ? 5 : 4,
                height: vm.status === 'running' ? 5 : 4,
                borderRadius: '50%',
                backgroundColor: color,
                boxShadow: vm.status === 'running' && modeConfig.glowEffects
                  ? `0 0 6px ${color}`
                  : 'none',
                ['--orbit-radius' as string]: `${orbitRadius}px`,
                animation: modeConfig.ambientAnimations
                  ? `orbit ${duration}s linear infinite`
                  : 'none',
                animationDelay: `${delay}s`,
                // Static position if not animating
                ...(!modeConfig.ambientAnimations
                  ? { transform: `rotate(${i * 45}deg) translateX(${orbitRadius}px) rotate(-${i * 45}deg)` }
                  : {}),
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

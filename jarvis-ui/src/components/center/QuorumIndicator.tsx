import { useClusterStore } from '../../stores/cluster';
import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';

/**
 * Centered overlay inside the globe displaying quorum status.
 * Pulsing glow when healthy, red when lost.
 */
export function QuorumIndicator() {
  const quorum = useClusterStore((s) => s.quorum);
  const visualMode = useUIStore((s) => s.visualMode);
  const modeConfig = VISUAL_MODES[visualMode];

  const quorate = quorum?.quorate ?? false;
  const votes = quorum ? `${quorum.nodes}/${quorum.expected}` : '---';
  const statusText = quorum ? (quorate ? 'QUORATE' : 'LOST') : 'OFFLINE';

  const glowColor = quorate
    ? 'var(--color-jarvis-amber)'
    : 'var(--color-jarvis-red)';

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"
      style={{
        textShadow: modeConfig.glowEffects
          ? `0 0 10px ${glowColor}`
          : 'none',
      }}
    >
      <span
        className="font-display text-2xl tracking-wider"
        style={{ color: glowColor }}
      >
        {votes}
      </span>
      <span
        className="font-display text-[9px] tracking-[0.25em] uppercase mt-1"
        style={{
          color: glowColor,
          opacity: 0.7,
          animation: quorate && modeConfig.ambientAnimations
            ? 'pulse-glow 2s ease-in-out infinite'
            : 'none',
        }}
      >
        {statusText}
      </span>
    </div>
  );
}

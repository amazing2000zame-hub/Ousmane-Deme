import { useUIStore } from '../stores/ui';
import { VISUAL_MODES } from '../theme/modes';

/**
 * Small heartbeat/pulse indicator showing the system is alive.
 * A diamond shape that pulses (scale + opacity) continuously.
 * Used in the TopBar next to connection status.
 *
 * Only renders when ambientAnimations is enabled.
 * GPU-composited: uses only transform and opacity.
 */
export function DataPulse() {
  const visualMode = useUIStore((s) => s.visualMode);
  const enabled = VISUAL_MODES[visualMode].ambientAnimations;

  if (!enabled) return null;

  return (
    <span
      className="inline-block"
      style={{
        width: '6px',
        height: '6px',
        backgroundColor: 'var(--color-jarvis-amber)',
        transform: 'rotate(45deg)',
        willChange: 'transform, opacity',
        animation: 'dataPulseHeart 2s ease-in-out infinite',
      }}
    />
  );
}

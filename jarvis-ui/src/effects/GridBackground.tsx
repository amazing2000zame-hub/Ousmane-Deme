import { useUIStore } from '../stores/ui';
import { VISUAL_MODES } from '../theme/modes';

/**
 * Subtle shifting grid pattern background covering the viewport.
 * Grid lines are drawn via CSS linear-gradient at very low opacity.
 * A slow drift animation (transform: translate) creates a living feel.
 *
 * Only renders when ambientAnimations is enabled in the current visual mode.
 * GPU-composited: uses only transform for animation.
 */
export function GridBackground() {
  const visualMode = useUIStore((s) => s.visualMode);
  const enabled = VISUAL_MODES[visualMode].ambientAnimations;

  if (!enabled) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: -1,
        backgroundImage: `
          linear-gradient(to right, color-mix(in srgb, var(--color-jarvis-amber) 3%, transparent) 1px, transparent 1px),
          linear-gradient(to bottom, color-mix(in srgb, var(--color-jarvis-amber) 3%, transparent) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        willChange: 'transform',
        animation: 'gridDrift 60s linear infinite',
      }}
    />
  );
}

import { useUIStore } from '../stores/ui';
import { VISUAL_MODES } from '../theme/modes';

interface ScanLinesProps {
  /** Override opacity for the static lines (default 0.15) */
  staticOpacity?: number;
  /** Override opacity for the moving sweep line (default 0.08) */
  sweepOpacity?: number;
  /** If true, render relative to parent (position: absolute) instead of fixed */
  local?: boolean;
}

/**
 * CRT scan line overlay effect with two layers:
 * 1. Static horizontal lines (repeating-linear-gradient)
 * 2. Moving sweep line (translateY animation, GPU-composited)
 *
 * Only renders when the current visual mode has scanLines enabled.
 * Uses ONLY transform and opacity for animation -- no layout-triggering properties.
 */
export function ScanLines({
  staticOpacity = 0.15,
  sweepOpacity = 0.08,
  local = false,
}: ScanLinesProps) {
  const visualMode = useUIStore((s) => s.visualMode);
  const enabled = VISUAL_MODES[visualMode].scanLines;

  if (!enabled) return null;

  const positionClass = local ? 'absolute' : 'fixed';

  return (
    <>
      {/* Static scan lines */}
      <div
        className={`${positionClass} inset-0 pointer-events-none`}
        style={{
          background: `repeating-linear-gradient(
            to bottom,
            transparent 0px,
            transparent 2px,
            rgba(0, 0, 0, ${staticOpacity}) 2px,
            rgba(0, 0, 0, ${staticOpacity}) 4px
          )`,
          zIndex: local ? 10 : 40,
        }}
      />

      {/* Moving scan line sweep -- GPU-composited via transform */}
      <div
        className={`${positionClass} left-0 right-0 pointer-events-none`}
        style={{
          height: '4px',
          top: 0,
          background: `linear-gradient(
            to bottom,
            transparent,
            rgba(255, 184, 0, ${sweepOpacity}),
            transparent
          )`,
          zIndex: local ? 11 : 41,
          willChange: 'transform',
          animation: 'scanSweep 8s linear infinite',
        }}
      />
    </>
  );
}

import type { ReactNode } from 'react';
import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';

interface GlowBorderProps {
  children: ReactNode;
  color?: 'amber' | 'cyan' | 'green' | 'red';
  intensity?: 'low' | 'medium' | 'high';
  active?: boolean;
  className?: string;
}

/** Primary glow uses CSS vars so it follows the active color theme */
const PRIMARY_GLOW = {
  low: 'var(--shadow-jarvis-glow-xs)',
  medium: 'var(--shadow-jarvis-glow-sm)',
  high: 'var(--shadow-jarvis-glow)',
} as const;

/** PERF-026: Semantic color glows use CSS var tokens (standardized intensities) */
const GLOW_MAP = {
  amber: PRIMARY_GLOW,
  cyan: {
    low: 'var(--shadow-jarvis-glow-cyan-xs)',
    medium: 'var(--shadow-jarvis-glow-cyan-sm)',
    high: 'var(--shadow-jarvis-glow-cyan)',
  },
  green: {
    low: 'var(--shadow-jarvis-glow-green-xs)',
    medium: 'var(--shadow-jarvis-glow-green-sm)',
    high: 'var(--shadow-jarvis-glow-green)',
  },
  red: {
    low: 'var(--shadow-jarvis-glow-red-xs)',
    medium: 'var(--shadow-jarvis-glow-red-sm)',
    high: 'var(--shadow-jarvis-glow-red)',
  },
} as const;

/**
 * Decorative glow border wrapper.
 * Respects visual mode -- only renders glow when glowEffects is enabled.
 * When active, applies a colored box-shadow glow effect around the children.
 * High intensity adds a pulse animation to the glow.
 */
export function GlowBorder({
  children,
  color = 'amber',
  intensity = 'low',
  active = true,
  className = '',
}: GlowBorderProps) {
  const visualMode = useUIStore((s) => s.visualMode);
  const glowEnabled = VISUAL_MODES[visualMode].glowEffects;

  if (!active || !glowEnabled) {
    return <div className={className}>{children}</div>;
  }

  const shadow = GLOW_MAP[color][intensity];
  const pulseClass = intensity === 'high' ? 'animate-pulse-glow' : '';

  return (
    <div
      className={`rounded transition-shadow duration-300 ${pulseClass} ${className}`}
      style={{ boxShadow: shadow }}
    >
      {children}
    </div>
  );
}

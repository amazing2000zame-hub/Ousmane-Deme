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

const GLOW_MAP = {
  amber: {
    low: '0 0 4px rgba(255,184,0,0.2)',
    medium: '0 0 8px rgba(255,184,0,0.3)',
    high: '0 0 15px rgba(255,184,0,0.4)',
  },
  cyan: {
    low: '0 0 4px rgba(0,212,255,0.2)',
    medium: '0 0 8px rgba(0,212,255,0.3)',
    high: '0 0 15px rgba(0,212,255,0.4)',
  },
  green: {
    low: '0 0 4px rgba(51,255,136,0.2)',
    medium: '0 0 8px rgba(51,255,136,0.3)',
    high: '0 0 15px rgba(51,255,136,0.4)',
  },
  red: {
    low: '0 0 4px rgba(255,51,51,0.2)',
    medium: '0 0 8px rgba(255,51,51,0.3)',
    high: '0 0 15px rgba(255,51,51,0.4)',
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

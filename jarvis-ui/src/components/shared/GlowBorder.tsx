import type { ReactNode } from 'react';

interface GlowBorderProps {
  children: ReactNode;
  color?: 'amber' | 'green' | 'red';
  intensity?: 'low' | 'medium' | 'high';
  active?: boolean;
}

/**
 * Decorative glow border wrapper.
 * When active, applies a colored glow effect around the children.
 */
export function GlowBorder({ children, color = 'amber', intensity = 'low', active = false }: GlowBorderProps) {
  if (!active) return <>{children}</>;

  const glowMap = {
    amber: {
      low: '0 0 4px rgba(255,184,0,0.2)',
      medium: '0 0 8px rgba(255,184,0,0.3)',
      high: '0 0 15px rgba(255,184,0,0.4)',
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
  };

  const shadow = glowMap[color][intensity];

  return (
    <div
      className="rounded transition-shadow duration-300"
      style={{ boxShadow: shadow }}
    >
      {children}
    </div>
  );
}

import type { ReactNode } from 'react';
import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';

interface PanelFrameProps {
  title: string;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Which panel column this belongs to, for keyboard focus indication */
  column?: 'left' | 'center' | 'right';
}

export function PanelFrame({
  title,
  children,
  className = '',
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  column,
}: PanelFrameProps) {
  const visualMode = useUIStore((s) => s.visualMode);
  const focusedPanel = useUIStore((s) => s.focusedPanel);
  const modeConfig = VISUAL_MODES[visualMode];

  const isFocused = column != null && focusedPanel === column;

  // Border color: focused -> brighter amber, borderGlow -> amber/20, default -> amber/10
  const borderClass = isFocused
    ? 'border-jarvis-amber/50'
    : modeConfig.borderGlow
      ? 'border-jarvis-amber/20'
      : 'border-jarvis-amber/10';

  // Box shadow for glow effects
  const glowStyle: React.CSSProperties = {};
  if (isFocused && modeConfig.glowEffects) {
    glowStyle.boxShadow = '0 0 8px rgba(255, 184, 0, 0.3)';
  } else if (modeConfig.glowEffects) {
    // Hover glow is handled via CSS transition; we set a default to transition FROM
    glowStyle.boxShadow = 'none';
  }

  return (
    <div
      className={`bg-jarvis-bg-panel border ${borderClass} rounded transition-all duration-200 ${
        modeConfig.glowEffects ? 'hover:shadow-jarvis-glow-sm' : ''
      } ${className}`}
      style={glowStyle}
      data-panel={column}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-jarvis-amber/10">
        <span className="font-display text-jarvis-amber-dim text-xs tracking-wider uppercase">
          {title}
        </span>
        {collapsible && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-jarvis-text-dim hover:text-jarvis-amber transition-colors text-xs px-1"
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {collapsed ? '\u25B6' : '\u25BC'}
          </button>
        )}
      </div>

      {/* Panel body */}
      {!collapsed && (
        <div className="p-2">
          {children}
        </div>
      )}
    </div>
  );
}

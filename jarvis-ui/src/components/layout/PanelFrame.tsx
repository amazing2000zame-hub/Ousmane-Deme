import type { ReactNode } from 'react';

interface PanelFrameProps {
  title: string;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function PanelFrame({
  title,
  children,
  className = '',
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
}: PanelFrameProps) {
  return (
    <div
      className={`bg-jarvis-bg-panel border border-jarvis-amber/10 rounded ${className}`}
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

/** Terminal panel with node selector, connection controls, xterm.js display, and eDEX-UI scan lines */

import { useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

import { useTerminalStore } from '../../stores/terminal';
import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';
import { useTerminal } from '../../hooks/useTerminal';
import { ScanLines } from '../../effects/ScanLines';
import NodeSelector from './NodeSelector';
import TerminalView from './TerminalView';

export default function TerminalPanel() {
  const selectedNode = useTerminalStore((s) => s.selectedNode);
  const isCollapsed = useTerminalStore((s) => s.isCollapsed);
  const toggleCollapse = useTerminalStore((s) => s.toggleCollapse);
  const visualMode = useUIStore((s) => s.visualMode);
  const modeConfig = VISUAL_MODES[visualMode];

  const containerRef = useRef<HTMLDivElement | null>(null);
  const { connect, disconnect, isConnected } = useTerminal(containerRef);

  // Enhanced scan line opacity for terminal (heavier than global overlay)
  const terminalScanEnabled = modeConfig.scanLines;

  // Amber glow on terminal border when connected
  const connectedBorderStyle: React.CSSProperties = isConnected && modeConfig.glowEffects
    ? { boxShadow: 'var(--shadow-jarvis-glow-sm)' }
    : {};

  return (
    <div
      className="relative flex flex-col h-full bg-jarvis-bg-panel border-l border-jarvis-amber/10 transition-shadow duration-200"
      style={connectedBorderStyle}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-jarvis-amber/10">
        <span className="font-display text-jarvis-amber-dim text-xs tracking-wider uppercase">
          Terminal
        </span>
        <button
          onClick={toggleCollapse}
          className="text-jarvis-text-dim hover:text-jarvis-amber text-xs font-mono transition-colors"
          title={isCollapsed ? 'Expand terminal' : 'Collapse terminal'}
        >
          {isCollapsed ? '[+]' : '[-]'}
        </button>
      </div>

      {/* Controls + Terminal -- hidden when collapsed (display:none preserves xterm state) */}
      <div
        className="flex flex-col flex-1 min-h-0"
        style={{ display: isCollapsed ? 'none' : undefined }}
      >
        {/* Controls */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-jarvis-amber/5">
          <NodeSelector
            selectedNode={selectedNode}
            onSelect={(nodeName) => connect(nodeName)}
          />

          {/* Connection status */}
          <span
            className={[
              'text-xs font-mono flex-1 truncate',
              isConnected ? 'text-jarvis-green' : 'text-jarvis-text-dim',
            ].join(' ')}
          >
            {isConnected && selectedNode
              ? `Connected to ${selectedNode}`
              : 'Disconnected'}
          </span>

          {/* Disconnect button */}
          {isConnected && (
            <button
              onClick={disconnect}
              className="text-xs font-mono text-jarvis-red hover:text-jarvis-red/80 transition-colors px-1"
            >
              Disconnect
            </button>
          )}
        </div>

        {/* Terminal mount point with local scan lines overlay */}
        <div className="relative flex-1 min-h-0">
          <TerminalView containerRef={containerRef} />

          {/* Enhanced scan lines over terminal area */}
          {terminalScanEnabled && (
            <ScanLines staticOpacity={0.25} sweepOpacity={0.12} local />
          )}
        </div>
      </div>
    </div>
  );
}

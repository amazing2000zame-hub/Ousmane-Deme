import { useEffect, useRef, useState } from 'react';
import { useClusterStore } from '../../stores/cluster';
import { useUIStore } from '../../stores/ui';
import { useTerminalStore } from '../../stores/terminal';
import { useAuthStore } from '../../stores/auth';
import { useMetricsStore } from '../../stores/metrics';
import { StatusDot } from '../shared/StatusDot';
import { DataPulse } from '../../effects/DataPulse';
import { RadialThemePicker } from './RadialThemePicker';
import { toggleKillSwitch } from '../../services/api';
import type { VisualMode } from '../../theme/modes';

const MODE_LABELS: { key: VisualMode; label: string }[] = [
  { key: 'jarvis', label: 'J' },
  { key: 'ops', label: 'O' },
  { key: 'minimal', label: 'M' },
];

export function TopBar() {
  const quorum = useClusterStore((s) => s.quorum);
  const connected = useClusterStore((s) => s.connected);
  const monitorStatus = useClusterStore((s) => s.monitorStatus);
  const setKillSwitch = useClusterStore((s) => s.setKillSwitch);
  const visualMode = useUIStore((s) => s.visualMode);
  const setVisualMode = useUIStore((s) => s.setVisualMode);
  const isTerminalCollapsed = useTerminalStore((s) => s.isCollapsed);
  const toggleTerminal = useTerminalStore((s) => s.toggleCollapse);
  const showMetrics = useMetricsStore((s) => s.showMetrics);
  const toggleMetrics = useMetricsStore((s) => s.toggleMetrics);
  const token = useAuthStore((s) => s.token);
  const [time, setTime] = useState(() => new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const isKillSwitchActive = monitorStatus?.killSwitch ?? false;

  /** Toggle autonomous action kill switch with optimistic update */
  function handleKillSwitchToggle() {
    const newValue = !isKillSwitchActive;
    // Optimistic update for instant feedback
    setKillSwitch(newValue);
    // Persist via API
    if (token) {
      toggleKillSwitch(newValue, token).catch(() => {
        // Revert on API error
        setKillSwitch(!newValue);
      });
    }
  }

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Close settings dropdown when clicking outside
  useEffect(() => {
    if (!settingsOpen) return;
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [settingsOpen]);

  // Quorum display
  const quorumText = quorum
    ? `${quorum.nodes}/${quorum.expected}`
    : '---';
  const quorumColor = quorum
    ? quorum.quorate
      ? 'text-jarvis-green'
      : 'text-jarvis-red'
    : 'text-jarvis-text-dim';

  // Time display
  const timeStr = time.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <header className="flex items-center justify-between h-12 px-4 bg-jarvis-bg-panel border-b border-jarvis-amber/20 shrink-0">
      {/* Left: Title */}
      <div className="flex items-center gap-3">
        <span className="font-display text-jarvis-amber text-sm tracking-[0.2em]">
          J.A.R.V.I.S.
        </span>
      </div>

      {/* Center: Quorum */}
      <div className="flex items-center gap-2">
        <span className="font-display text-[10px] tracking-wider text-jarvis-text-dim uppercase">
          QUORUM
        </span>
        <span className={`font-mono text-sm ${quorumColor}`}>
          {quorumText}
        </span>
      </div>

      {/* Right: Connection + DataPulse + Terminal + Settings + Clock */}
      <div className="flex items-center gap-4">
        {/* Connection status + DataPulse */}
        <div className="flex items-center gap-1.5">
          <StatusDot
            status={connected ? 'online' : 'offline'}
            size="sm"
            pulse={connected}
          />
          <DataPulse />
          <span className="text-[10px] font-mono text-jarvis-text-dim uppercase">
            {connected ? 'LIVE' : 'DISC'}
          </span>
        </div>

        {/* Kill switch toggle */}
        <button
          type="button"
          onClick={handleKillSwitchToggle}
          title={isKillSwitchActive
            ? 'Autonomous Actions: DISABLED (Kill Switch Active)'
            : 'Autonomous Actions: ENABLED'}
          className={`
            flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono tracking-wider rounded
            transition-all duration-200
            ${isKillSwitchActive
              ? 'text-jarvis-red border border-jarvis-red/30 line-through'
              : 'text-jarvis-green border border-jarvis-green/30'}
          `}
        >
          <StatusDot
            status={isKillSwitchActive ? 'offline' : 'online'}
            size="sm"
            pulse={!isKillSwitchActive}
          />
          AUTO
        </button>

        {/* Visual mode switcher */}
        <div className="flex items-center gap-0.5">
          {MODE_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setVisualMode(key)}
              className={`
                px-1.5 py-0.5 text-[10px] font-display tracking-wider rounded
                transition-all duration-200
                ${visualMode === key
                  ? 'bg-jarvis-amber/20 text-jarvis-amber border border-jarvis-amber/30'
                  : 'text-jarvis-text-dim hover:text-jarvis-amber-dim border border-transparent'}
              `}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Latency metrics toggle */}
        <button
          type="button"
          onClick={toggleMetrics}
          title={showMetrics ? 'Hide latency metrics' : 'Show latency metrics'}
          className={`
            px-1.5 py-0.5 text-[10px] font-mono tracking-wider rounded
            transition-all duration-200
            ${showMetrics
              ? 'bg-jarvis-amber/20 text-jarvis-amber border border-jarvis-amber/30'
              : 'text-jarvis-text-dim hover:text-jarvis-amber-dim border border-transparent'}
          `}
        >
          LAT
        </button>

        {/* Terminal toggle */}
        <button
          type="button"
          onClick={toggleTerminal}
          title={isTerminalCollapsed ? 'Show terminal' : 'Hide terminal'}
          className={`
            px-1.5 py-0.5 text-[10px] font-mono tracking-wider rounded
            transition-all duration-200
            ${!isTerminalCollapsed
              ? 'bg-jarvis-amber/20 text-jarvis-amber border border-jarvis-amber/30'
              : 'text-jarvis-text-dim hover:text-jarvis-amber-dim border border-transparent'}
          `}
        >
          {'>_'}
        </button>

        {/* Settings gear (opens theme picker dropdown) */}
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            title="Settings"
            className={`
              px-1.5 py-0.5 text-[10px] font-display tracking-wider rounded
              transition-all duration-200
              ${settingsOpen
                ? 'bg-jarvis-amber/20 text-jarvis-amber border border-jarvis-amber/30'
                : 'text-jarvis-text-dim hover:text-jarvis-amber-dim border border-transparent'}
            `}
          >
            CFG
          </button>

          {/* Settings dropdown */}
          {settingsOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 bg-jarvis-bg-panel border border-jarvis-amber/20 rounded-md shadow-lg p-3 min-w-[180px]">
              <span className="font-display text-[9px] tracking-wider text-jarvis-text-muted uppercase block mb-2">
                COLOR THEME
              </span>
              <RadialThemePicker />
            </div>
          )}
        </div>

        {/* Clock */}
        <span className="font-mono text-xs text-jarvis-text-dim tabular-nums">
          {timeStr}
        </span>
      </div>
    </header>
  );
}

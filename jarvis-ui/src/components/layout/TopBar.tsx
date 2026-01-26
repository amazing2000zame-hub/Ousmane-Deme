import { useEffect, useState } from 'react';
import { useClusterStore } from '../../stores/cluster';
import { useUIStore, type ColorTheme } from '../../stores/ui';
import { StatusDot } from '../shared/StatusDot';
import { DataPulse } from '../../effects/DataPulse';
import type { VisualMode } from '../../theme/modes';

const MODE_LABELS: { key: VisualMode; label: string }[] = [
  { key: 'jarvis', label: 'J' },
  { key: 'ops', label: 'O' },
  { key: 'minimal', label: 'M' },
];

const THEME_SWATCHES: { key: ColorTheme; color: string; label: string }[] = [
  { key: 'amber',  color: '#ffb800', label: 'Amber' },
  { key: 'cyan',   color: '#00d4ff', label: 'Cyan' },
  { key: 'green',  color: '#33ff88', label: 'Green' },
  { key: 'purple', color: '#b366ff', label: 'Purple' },
  { key: 'red',    color: '#ff3333', label: 'Red' },
];

export function TopBar() {
  const quorum = useClusterStore((s) => s.quorum);
  const connected = useClusterStore((s) => s.connected);
  const visualMode = useUIStore((s) => s.visualMode);
  const setVisualMode = useUIStore((s) => s.setVisualMode);
  const colorTheme = useUIStore((s) => s.colorTheme);
  const setColorTheme = useUIStore((s) => s.setColorTheme);

  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Quorum display
  const quorumText = quorum
    ? `${quorum.totalVotes}/${quorum.expectedVotes}`
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

      {/* Right: Connection + DataPulse + Mode + Clock */}
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

        {/* Color theme swatches */}
        <div className="flex items-center gap-1">
          {THEME_SWATCHES.map(({ key, color, label }) => (
            <button
              key={key}
              type="button"
              title={label}
              onClick={() => setColorTheme(key)}
              className="w-3 h-3 rounded-full transition-all duration-200 border"
              style={{
                backgroundColor: colorTheme === key ? color : 'transparent',
                borderColor: color,
                boxShadow: colorTheme === key ? `0 0 6px ${color}80` : 'none',
              }}
            />
          ))}
        </div>

        {/* Clock */}
        <span className="font-mono text-xs text-jarvis-text-dim tabular-nums">
          {timeStr}
        </span>
      </div>
    </header>
  );
}

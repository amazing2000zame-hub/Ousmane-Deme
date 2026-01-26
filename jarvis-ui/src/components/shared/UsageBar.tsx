interface UsageBarProps {
  value: number; // 0-1
  label?: string;
  showPercent?: boolean;
  thresholds?: { warn: number; critical: number };
}

function getBarColor(value: number, thresholds: { warn: number; critical: number }): string {
  if (value >= thresholds.critical) return 'bg-jarvis-red';
  if (value >= thresholds.warn) return 'bg-jarvis-orange';
  return 'bg-jarvis-green';
}

export function UsageBar({
  value,
  label,
  showPercent = false,
  thresholds = { warn: 0.7, critical: 0.9 },
}: UsageBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const percent = Math.round(clamped * 100);
  const barColor = getBarColor(clamped, thresholds);

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="flex items-center justify-between mb-0.5">
          {label && (
            <span className="text-[10px] font-body text-jarvis-text-dim uppercase tracking-wider">
              {label}
            </span>
          )}
          {showPercent && (
            <span className="text-[10px] font-mono text-jarvis-text-dim">
              {percent}%
            </span>
          )}
        </div>
      )}
      <div className="w-full h-1.5 bg-jarvis-bg-card rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface StatusDotProps {
  status: 'online' | 'offline' | 'warning' | 'unknown';
  size?: 'sm' | 'md';
  pulse?: boolean;
}

const STATUS_COLORS: Record<StatusDotProps['status'], string> = {
  online: 'bg-jarvis-green',
  offline: 'bg-jarvis-red',
  warning: 'bg-jarvis-orange',
  unknown: 'bg-jarvis-text-dim',
};

const PULSE_COLORS: Record<StatusDotProps['status'], string> = {
  online: 'bg-jarvis-green/40',
  offline: 'bg-jarvis-red/40',
  warning: 'bg-jarvis-orange/40',
  unknown: 'bg-jarvis-text-dim/40',
};

const SIZE_MAP = {
  sm: 'h-2 w-2',
  md: 'h-3 w-3',
} as const;

const PULSE_SIZE_MAP = {
  sm: 'h-3.5 w-3.5',
  md: 'h-5 w-5',
} as const;

export function StatusDot({ status, size = 'md', pulse = false }: StatusDotProps) {
  const dotColor = STATUS_COLORS[status];
  const pulseColor = PULSE_COLORS[status];
  const dotSize = SIZE_MAP[size];
  const pulseSize = PULSE_SIZE_MAP[size];

  return (
    <span className="relative inline-flex items-center justify-center">
      {pulse && (
        <span
          className={`absolute ${pulseSize} ${pulseColor} rounded-full animate-ping`}
          style={{ animationDuration: '2s' }}
        />
      )}
      <span className={`relative ${dotSize} ${dotColor} rounded-full`} />
    </span>
  );
}

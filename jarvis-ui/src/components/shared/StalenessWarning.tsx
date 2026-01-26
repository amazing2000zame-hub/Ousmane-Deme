import { useEffect, useState } from 'react';
import { useClusterStore } from '../../stores/cluster';

interface StalenessWarningProps {
  dataKey: string;
  maxAgeMs: number;
}

export function StalenessWarning({ dataKey, maxAgeMs }: StalenessWarningProps) {
  const isStale = useClusterStore((s) => s.isStale);
  const [stale, setStale] = useState(() => isStale(dataKey, maxAgeMs));

  useEffect(() => {
    // Re-check staleness every second
    const interval = setInterval(() => {
      setStale(isStale(dataKey, maxAgeMs));
    }, 1000);
    return () => clearInterval(interval);
  }, [dataKey, maxAgeMs, isStale]);

  if (!stale) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <span className="text-jarvis-orange text-[10px] font-mono uppercase tracking-wider animate-pulse">
        DATA STALE
      </span>
    </div>
  );
}

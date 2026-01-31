import { useMetricsStore, type TimingBreakdown } from '../../stores/metrics';

/**
 * Timing stage metadata for display
 */
const TIMING_STAGES: Array<{
  key: keyof TimingBreakdown;
  label: string;
  color: string;
  description: string;
}> = [
  { key: 't1_routed', label: 'Route', color: 'bg-cyan-500', description: 'Intent routing decision' },
  { key: 't2_llm_start', label: 'LLM Start', color: 'bg-blue-500', description: 'Request dispatched to LLM' },
  { key: 't3_first_token', label: 'First Token', color: 'bg-green-500', description: 'First token received' },
  { key: 't4_llm_done', label: 'LLM Done', color: 'bg-yellow-500', description: 'LLM stream complete' },
  { key: 't5_tts_queued', label: 'TTS Queue', color: 'bg-orange-500', description: 'First sentence queued' },
  { key: 't6_tts_first', label: 'TTS Ready', color: 'bg-pink-500', description: 'First audio synthesized' },
  { key: 't7_audio_delivered', label: 'Audio Sent', color: 'bg-purple-500', description: 'First audio delivered' },
];

/**
 * Format milliseconds for display
 */
function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Single timing entry row with bar visualization
 */
function TimingRow({ timing, maxTotal }: { timing: TimingBreakdown; maxTotal: number }) {
  const total = timing.total_ms ?? 0;

  return (
    <div className="space-y-1.5">
      {/* Total time badge */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-jarvis-text-muted uppercase">
          Total Latency
        </span>
        <span className={`text-sm font-mono ${
          total < 1000 ? 'text-jarvis-green' :
          total < 3000 ? 'text-jarvis-amber' :
          'text-jarvis-red'
        }`}>
          {formatMs(total)}
        </span>
      </div>

      {/* Stacked bar visualization */}
      <div className="relative h-4 bg-jarvis-bg/50 rounded overflow-hidden">
        {TIMING_STAGES.map((stage, idx) => {
          const value = timing[stage.key] as number | undefined;
          if (value === undefined) return null;

          // Calculate width as percentage of max total
          const widthPercent = maxTotal > 0 ? (value / maxTotal) * 100 : 0;

          // Calculate left position from previous stage
          const prevStageIdx = idx > 0 ? idx - 1 : 0;
          const prevKey = TIMING_STAGES[prevStageIdx].key;
          const prevValue = idx > 0 ? (timing[prevKey] as number | undefined) ?? 0 : 0;
          const leftPercent = maxTotal > 0 ? (prevValue / maxTotal) * 100 : 0;

          // Segment width = this value - previous value
          const segmentWidth = widthPercent - leftPercent;

          return (
            <div
              key={stage.key}
              className={`absolute h-full ${stage.color} opacity-80`}
              style={{
                left: `${leftPercent}%`,
                width: `${Math.max(segmentWidth, 0)}%`,
              }}
              title={`${stage.label}: ${formatMs(value)}`}
            />
          );
        })}
      </div>

      {/* Stage breakdown */}
      <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 text-[9px]">
        {TIMING_STAGES.map((stage) => {
          const value = timing[stage.key] as number | undefined;
          if (value === undefined) return null;

          return (
            <div key={stage.key} className="flex items-center gap-1" title={stage.description}>
              <span className={`w-1.5 h-1.5 rounded-full ${stage.color}`} />
              <span className="text-jarvis-text-muted truncate">{stage.label}</span>
              <span className="text-jarvis-text-dim ml-auto tabular-nums">{formatMs(value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Latency metrics panel showing voice/chat timing breakdown.
 * Reads from useMetricsStore which is populated by chat:timing socket events.
 */
export function LatencyMetrics() {
  const timings = useMetricsStore((s) => s.timings);
  const showMetrics = useMetricsStore((s) => s.showMetrics);
  const toggleMetrics = useMetricsStore((s) => s.toggleMetrics);
  const clearMetrics = useMetricsStore((s) => s.clearMetrics);

  if (!showMetrics) return null;

  // Find max total for consistent bar scaling
  const maxTotal = Math.max(...timings.map((t) => t.timing.total_ms ?? 0), 1000);

  return (
    <div className="bg-jarvis-bg-panel/90 border border-jarvis-amber/20 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-jarvis-amber/10">
        <div className="flex items-center gap-2">
          <span className="font-display text-[10px] tracking-wider text-jarvis-amber uppercase">
            Latency Metrics
          </span>
          <span className="text-[9px] text-jarvis-text-muted">
            ({timings.length} request{timings.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {timings.length > 0 && (
            <button
              type="button"
              onClick={clearMetrics}
              className="text-[9px] text-jarvis-text-muted hover:text-jarvis-amber px-1.5 py-0.5"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={toggleMetrics}
            className="text-[9px] text-jarvis-text-muted hover:text-jarvis-amber px-1.5 py-0.5"
          >
            Hide
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
        {timings.length === 0 ? (
          <div className="text-center text-[10px] text-jarvis-text-muted py-4">
            No timing data yet. Send a message to see latency breakdown.
          </div>
        ) : (
          timings.map((entry, idx) => (
            <div key={entry.sessionId + idx} className="pb-2 border-b border-jarvis-amber/5 last:border-0 last:pb-0">
              <TimingRow timing={entry.timing} maxTotal={maxTotal} />
            </div>
          ))
        )}
      </div>

      {/* Legend */}
      {timings.length > 0 && (
        <div className="px-3 py-2 border-t border-jarvis-amber/10 bg-jarvis-bg/30">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-jarvis-text-muted">
            <span><span className="text-jarvis-green">Green</span> &lt;1s</span>
            <span><span className="text-jarvis-amber">Amber</span> 1-3s</span>
            <span><span className="text-jarvis-red">Red</span> &gt;3s</span>
          </div>
        </div>
      )}
    </div>
  );
}

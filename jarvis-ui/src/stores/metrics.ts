import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * Timing breakdown from backend (Phase 24 timing instrumentation)
 */
export interface TimingBreakdown {
  t0_received?: number;
  t1_routed?: number;
  t2_llm_start?: number;
  t3_first_token?: number;
  t4_llm_done?: number;
  t5_tts_queued?: number;
  t6_tts_first?: number;
  t7_audio_delivered?: number;
  total_ms?: number;
}

export interface TimingEntry {
  timestamp: number;
  sessionId: string;
  timing: TimingBreakdown;
}

interface MetricsState {
  timings: TimingEntry[];
  showMetrics: boolean;
  maxEntries: number;

  // Actions
  addTiming: (sessionId: string, timing: TimingBreakdown) => void;
  toggleMetrics: () => void;
  clearMetrics: () => void;
}

export const useMetricsStore = create<MetricsState>()(
  devtools(
    (set) => ({
      timings: [],
      showMetrics: false,
      maxEntries: 10, // Keep last 10 requests

      addTiming: (sessionId, timing) =>
        set(
          (state) => {
            const newEntry: TimingEntry = {
              timestamp: Date.now(),
              sessionId,
              timing,
            };
            const updatedTimings = [newEntry, ...state.timings].slice(0, state.maxEntries);
            return { timings: updatedTimings };
          },
          false,
          'metrics/addTiming',
        ),

      toggleMetrics: () =>
        set(
          (state) => ({ showMetrics: !state.showMetrics }),
          false,
          'metrics/toggleMetrics',
        ),

      clearMetrics: () =>
        set({ timings: [] }, false, 'metrics/clearMetrics'),
    }),
    { name: 'metrics-store' },
  ),
);

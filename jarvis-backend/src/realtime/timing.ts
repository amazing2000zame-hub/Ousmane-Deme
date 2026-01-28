/**
 * Pipeline timing instrumentation for JARVIS request lifecycle.
 *
 * Records performance.now() marks at named pipeline stages and produces
 * a relative-time breakdown for observability and latency diagnosis.
 *
 * Usage:
 *   const timer = new RequestTimer();
 *   timer.mark('t1_routed');
 *   // ... later ...
 *   timer.mark('t3_first_token');
 *   console.log(timer.toLog());
 *   // "[Timing] route=12ms first_token=890ms total=890ms"
 */

export interface TimingBreakdown {
  t0_received: number;        // 0 (base)
  t1_routed: number;          // ms after t0: routing decision complete
  t2_llm_start: number;       // ms after t0: LLM request dispatched
  t3_first_token: number;     // ms after t0: first token received from LLM
  t4_llm_done: number;        // ms after t0: LLM stream complete
  t5_tts_queued?: number;     // ms after t0: first sentence queued for TTS (voice only)
  t6_tts_first?: number;      // ms after t0: first audio chunk ready (voice only)
  t7_audio_delivered?: number; // ms after t0: first audio emitted to client (voice only)
  total_ms: number;            // t0 to final mark
}

/** Human-readable label for each mark key. */
const MARK_LABELS: Record<string, string> = {
  t1_routed: 'route',
  t2_llm_start: 'llm_start',
  t3_first_token: 'first_token',
  t4_llm_done: 'llm_done',
  t5_tts_queued: 'tts_queued',
  t6_tts_first: 'tts_first',
  t7_audio_delivered: 'audio_delivered',
};

/** Optional marks that may not be recorded (voice-only stages). */
const OPTIONAL_MARKS = new Set(['t5_tts_queued', 't6_tts_first', 't7_audio_delivered']);

/**
 * Records named pipeline marks and produces timing breakdowns.
 */
export class RequestTimer {
  private marks = new Map<string, number>();

  constructor() {
    this.mark('t0_received');
  }

  /** Record a performance.now() timestamp for the given stage name. */
  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  /**
   * Return all marks as milliseconds relative to t0.
   * Missing optional marks (t5-t7) are undefined, not 0.
   * total_ms = latest mark minus t0.
   */
  breakdown(): TimingBreakdown {
    const t0 = this.marks.get('t0_received') ?? 0;
    let latest = t0;

    const result: Record<string, number | undefined> = {
      t0_received: 0,
    };

    for (const [name, timestamp] of this.marks) {
      if (name === 't0_received') continue;
      const relative = timestamp - t0;
      result[name] = relative;
      if (timestamp > latest) latest = timestamp;
    }

    // Ensure optional marks are undefined when not recorded (not just missing)
    for (const opt of OPTIONAL_MARKS) {
      if (!this.marks.has(opt)) {
        result[opt] = undefined;
      }
    }

    result['total_ms'] = latest - t0;

    return result as unknown as TimingBreakdown;
  }

  /**
   * Single-line human-readable timing summary.
   * Only includes marks that have been recorded. Rounds to integers.
   *
   * Example: "[Timing] route=12ms llm_start=15ms first_token=890ms total=2450ms"
   */
  toLog(): string {
    const t0 = this.marks.get('t0_received') ?? 0;
    let latest = t0;
    const parts: string[] = [];

    // Iterate marks in insertion order (constructor sets t0 first)
    for (const [name, timestamp] of this.marks) {
      if (name === 't0_received') continue;
      const relative = Math.round(timestamp - t0);
      const label = MARK_LABELS[name] ?? name;
      parts.push(`${label}=${relative}ms`);
      if (timestamp > latest) latest = timestamp;
    }

    const total = Math.round(latest - t0);
    parts.push(`total=${total}ms`);

    return `[Timing] ${parts.join(' ')}`;
  }
}

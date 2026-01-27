/**
 * Streaming sentence boundary detector.
 *
 * Accumulates LLM text tokens and emits complete sentences as soon as
 * a sentence boundary is detected (period, exclamation, question mark
 * followed by whitespace or end-of-stream).
 *
 * Used by the streaming voice pipeline (PERF-01) to dispatch
 * per-sentence TTS synthesis while the LLM is still generating.
 */

export class SentenceAccumulator {
  private buffer = '';
  private sentenceIndex = 0;
  private readonly onSentence: (sentence: string, index: number) => void;

  /** Minimum characters before we consider a boundary valid.
   *  Covers 'Yes.' (4 chars), 'Done.' (5 chars), 'Sure.' (5 chars) without
   *  false-splitting on 'Dr.' (3 chars). Text shorter than 4 chars is still
   *  spoken via flush() at end-of-stream. */
  private static readonly MIN_SENTENCE_LEN = 4;

  constructor(onSentence: (sentence: string, index: number) => void) {
    this.onSentence = onSentence;
  }

  /** Feed a new text token from the LLM stream. */
  push(text: string): void {
    this.buffer += text;
    this.drain();
  }

  /** Flush any remaining buffered text as a final sentence. */
  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed.length > 0) {
      this.onSentence(trimmed, this.sentenceIndex++);
      this.buffer = '';
    }
  }

  /** Scan buffer for complete sentences and emit them. */
  private drain(): void {
    // Look for sentence-ending punctuation followed by whitespace.
    // Pattern: one or more of [.!?] then one or more whitespace chars.
    // We use a loop scanning from the start to find the earliest valid boundary.
    let searchFrom = 0;

    while (searchFrom < this.buffer.length) {
      const idx = this.findBoundary(searchFrom);
      if (idx === -1) break;

      const sentence = this.buffer.slice(0, idx).trim();
      if (sentence.length >= SentenceAccumulator.MIN_SENTENCE_LEN) {
        this.buffer = this.buffer.slice(idx).trimStart();
        this.onSentence(sentence, this.sentenceIndex++);
        searchFrom = 0; // restart scan on remaining buffer
      } else {
        // Sentence too short — likely an abbreviation. Skip this boundary.
        searchFrom = idx + 1;
      }
    }
  }

  /**
   * Find the next sentence boundary starting from `from`.
   * Returns the index just past the punctuation (before the whitespace),
   * or -1 if no boundary found.
   */
  private findBoundary(from: number): number {
    for (let i = from; i < this.buffer.length - 1; i++) {
      const ch = this.buffer[i];
      if (ch === '.' || ch === '!' || ch === '?') {
        // Skip consecutive punctuation (e.g. "..." or "?!")
        let end = i + 1;
        while (end < this.buffer.length && (this.buffer[end] === '.' || this.buffer[end] === '!' || this.buffer[end] === '?')) {
          end++;
        }
        // Must be followed by whitespace (space, newline, tab)
        if (end < this.buffer.length) {
          const next = this.buffer[end];
          if (next === ' ' || next === '\n' || next === '\r' || next === '\t') {
            return end;
          }
        }
      }
    }
    return -1;
  }
}

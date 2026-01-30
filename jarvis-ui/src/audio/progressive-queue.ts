/**
 * Progressive audio queue -- gapless voice playback (PERF-03/04).
 *
 * Plays audio chunks progressively as they arrive via chat:audio_chunk
 * events. Uses Web Audio clock scheduling (AudioBufferSourceNode.start(when))
 * for zero-gap seamless sentence transitions. Supports both WAV and OGG Opus
 * content types (auto-detected by decodeAudioData).
 *
 * Pre-decodes the next buffer during playback to eliminate decode latency.
 */

import { useVoiceStore } from '../stores/voice';

// ---------------------------------------------------------------------------
// Singleton Web Audio context (shared with useVoice.ts)
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let gainNode: GainNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    gainNode = audioCtx.createGain();
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Expose the shared AudioContext for useVoice.ts monolithic playback. */
export function getSharedAudioContext(): {
  ctx: AudioContext;
  analyser: AnalyserNode;
  gainNode: GainNode;
} {
  const ctx = getAudioContext();
  return { ctx, analyser: analyser!, gainNode: gainNode! };
}

// ---------------------------------------------------------------------------
// XTTS audio chunk queue — progressive playback
// ---------------------------------------------------------------------------

interface QueuedChunk {
  buffer: ArrayBuffer;
  contentType: string;
  index: number;
}

let xttsQueue: QueuedChunk[] = [];
let isPlayingXtts = false;
let currentSource: AudioBufferSourceNode | null = null;
let xttsStreamDone = false;
let nextStartTime = 0; // Web Audio clock time for next chunk start
let prefetchedBuffer: AudioBuffer | null = null;
let prefetchedIndex = -1;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let activeSessionId: string | null = null;

/**
 * Tracks whether progressive playback was used for the current/last response.
 * This persists beyond session finalization so ChatPanel can check it
 * and skip redundant monolithic auto-play.
 */
let _progressiveWasUsed = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new progressive voice session.
 * Prepares XTTS playback track for incoming audio chunks.
 */
export function startProgressiveSession(sessionId: string, messageId: string): void {
  // Stop any XTTS playback from a previous session
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }

  activeSessionId = sessionId;
  xttsQueue = [];
  isPlayingXtts = false;
  xttsStreamDone = false;
  nextStartTime = 0;
  prefetchedBuffer = null;
  prefetchedIndex = -1;
  _progressiveWasUsed = true;

  const store = useVoiceStore.getState();
  store.setPlaying(true, messageId);
}

/**
 * Queue an XTTS audio chunk for immediate progressive playback.
 * Chunks arrive as sentences are synthesized by the backend XTTS service.
 */
export function queueAudioChunk(
  sessionId: string,
  chunk: ArrayBuffer,
  contentType: string,
  index: number,
): void {
  if (sessionId !== activeSessionId) return;
  xttsQueue.push({ buffer: chunk, contentType, index });
  xttsQueue.sort((a, b) => a.index - b.index);

  if (contentType && !contentType.includes('wav')) {
    console.debug(`[ProgressiveAudio] Received non-WAV chunk: ${contentType}`);
  }

  // Start playback immediately if not already playing
  if (!isPlayingXtts) {
    playNextXttsChunk();
  }
}

/**
 * Signal that all XTTS audio chunks have been sent.
 */
export function markStreamDone(sessionId: string): void {
  if (sessionId !== activeSessionId) return;
  xttsStreamDone = true;

  if (!isPlayingXtts && xttsQueue.length === 0) {
    finalize();
  }
}

/** Stop all progressive playback and reset state. */
export function stopProgressive(): void {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }

  xttsQueue = [];
  isPlayingXtts = false;
  xttsStreamDone = false;
  nextStartTime = 0;
  prefetchedBuffer = null;
  prefetchedIndex = -1;
  activeSessionId = null;

  useVoiceStore.getState().setPlaying(false, null);
  useVoiceStore.getState().setAnalyserNode(null);
}

/** Whether a progressive session is active. */
export function isProgressiveActive(): boolean {
  return activeSessionId !== null;
}

/**
 * Whether progressive playback was used for the last response.
 * Returns true even after the session has finalized — used by ChatPanel
 * to avoid redundant monolithic auto-play after progressive finishes.
 */
export function wasProgressiveUsedForSession(): boolean {
  return _progressiveWasUsed;
}

/** Reset the progressive-used flag. Call after ChatPanel has checked it. */
export function resetProgressiveUsed(): void {
  _progressiveWasUsed = false;
}

/** Get the active progressive session ID. */
export function getProgressiveSessionId(): string | null {
  return activeSessionId;
}

// ---------------------------------------------------------------------------
// XTTS playback — progressive chunk-by-chunk
// ---------------------------------------------------------------------------

async function playNextXttsChunk(): Promise<void> {
  if (xttsQueue.length === 0) {
    isPlayingXtts = false;
    if (xttsStreamDone) {
      finalize();
    }
    return;
  }

  isPlayingXtts = true;
  const chunk = xttsQueue.shift()!;

  try {
    const { ctx, gainNode: gain } = getSharedAudioContext();
    const volume = useVoiceStore.getState().volume;
    gain.gain.value = volume;

    // Use pre-decoded buffer if available for this chunk, otherwise decode now
    let audioBuffer: AudioBuffer;
    if (prefetchedBuffer && prefetchedIndex === chunk.index) {
      audioBuffer = prefetchedBuffer;
      prefetchedBuffer = null;
      prefetchedIndex = -1;
    } else {
      audioBuffer = await ctx.decodeAudioData(chunk.buffer.slice(0));
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);
    currentSource = source;

    // Connect analyser for visualizer
    useVoiceStore.getState().setAnalyserNode(analyser);

    // Schedule at precise time (gapless playback)
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextStartTime);
    nextStartTime = startAt + audioBuffer.duration;

    source.onended = () => {
      currentSource = null;
      playNextXttsChunk();
    };

    source.start(startAt);

    // Pre-decode next chunk while current is playing
    prefetchNextChunk();
  } catch (err) {
    console.warn('[ProgressiveAudio] Failed to play chunk:', err);
    currentSource = null;
    playNextXttsChunk();
  }
}

async function prefetchNextChunk(): Promise<void> {
  if (xttsQueue.length === 0) return;
  const next = xttsQueue[0]; // Peek, don't shift
  if (next.index === prefetchedIndex) return; // Already prefetched

  try {
    const { ctx } = getSharedAudioContext();
    prefetchedBuffer = await ctx.decodeAudioData(next.buffer.slice(0));
    prefetchedIndex = next.index;
  } catch {
    prefetchedBuffer = null;
    prefetchedIndex = -1;
  }
}

function finalize(): void {
  activeSessionId = null;
  isPlayingXtts = false;
  xttsStreamDone = false;
  nextStartTime = 0;
  prefetchedBuffer = null;
  prefetchedIndex = -1;
  xttsQueue = []; // Clear any leftover chunks
  // NOTE: _progressiveWasUsed is NOT reset here — it persists so
  // ChatPanel can check it after finalization to skip monolithic auto-play.

  useVoiceStore.getState().setPlaying(false, null);
  useVoiceStore.getState().setAnalyserNode(null);
}

// ---------------------------------------------------------------------------
// Acknowledgment playback -- immediate, non-queued
// ---------------------------------------------------------------------------

/**
 * Play acknowledgment audio immediately, bypassing the progressive queue.
 * Used for tool acknowledgments that must play before any response audio.
 * Does NOT interfere with progressive sessions - uses same AudioContext.
 */
export async function playAcknowledgmentImmediate(
  audioData: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const voiceState = useVoiceStore.getState();
  if (!voiceState.enabled || !voiceState.autoPlay) return;

  try {
    const { ctx, gainNode } = getSharedAudioContext();
    const volume = voiceState.volume;
    gainNode.gain.value = volume;

    // Decode the audio buffer
    const audioBuffer = await ctx.decodeAudioData(audioData.slice(0));

    // Create and play source immediately
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);
    source.start(0); // Play NOW, not scheduled

    // Don't wait for playback to complete - fire and forget
    console.log(`[ProgressiveAudio] Playing acknowledgment immediately (${contentType})`);
  } catch (err) {
    console.warn('[ProgressiveAudio] Failed to play acknowledgment:', err);
  }
}

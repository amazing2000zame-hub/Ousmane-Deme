/**
 * Progressive audio queue — XTTS-only voice playback (PERF-03/04).
 *
 * Plays XTTS audio chunks progressively as they arrive via chat:audio_chunk
 * events. Uses the custom trained JARVIS voice for all speech output.
 *
 * chat:sentence events are used only to start the session and track state;
 * actual audio playback is driven entirely by XTTS audio chunks.
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

    const audioBuffer = await ctx.decodeAudioData(chunk.buffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);
    currentSource = source;

    // Connect analyser for visualizer
    useVoiceStore.getState().setAnalyserNode(analyser);

    source.onended = () => {
      currentSource = null;
      playNextXttsChunk();
    };

    source.start();
  } catch (err) {
    console.warn('[ProgressiveAudio] Failed to play XTTS chunk:', err);
    currentSource = null;
    playNextXttsChunk();
  }
}

function finalize(): void {
  activeSessionId = null;
  isPlayingXtts = false;
  xttsStreamDone = false;
  // NOTE: _progressiveWasUsed is NOT reset here — it persists so
  // ChatPanel can check it after finalization to skip monolithic auto-play.

  useVoiceStore.getState().setPlaying(false, null);
  useVoiceStore.getState().setAnalyserNode(null);
}

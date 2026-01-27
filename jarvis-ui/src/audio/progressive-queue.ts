/**
 * Progressive audio queue — plays audio chunks sequentially as they arrive
 * from the streaming voice pipeline (PERF-03/04).
 *
 * Manages a FIFO queue of ArrayBuffer audio chunks, decoding and playing
 * them via Web Audio API. Connects to an AnalyserNode for visualization.
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
// Queue state
// ---------------------------------------------------------------------------

interface QueuedChunk {
  buffer: ArrayBuffer;
  contentType: string;
  index: number;
}

let queue: QueuedChunk[] = [];
let isPlaying = false;
let currentSource: AudioBufferSourceNode | null = null;
let streamDone = false;
let activeSessionId: string | null = null;
let chunksReceived = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new progressive audio session.
 * Resets the queue and prepares for incoming chunks.
 */
export function startProgressiveSession(sessionId: string, messageId: string): void {
  // Stop any existing playback
  stopProgressive();

  activeSessionId = sessionId;
  chunksReceived = 0;
  streamDone = false;
  queue = [];
  isPlaying = false;

  // Signal playing state
  const store = useVoiceStore.getState();
  store.setPlaying(true, messageId);

  // Connect analyser for visualization
  getAudioContext();
  store.setAnalyserNode(analyser);
}

/**
 * Queue an audio chunk for progressive playback.
 * If nothing is currently playing, starts playback immediately.
 */
export function queueAudioChunk(
  sessionId: string,
  chunk: ArrayBuffer,
  contentType: string,
  index: number,
): void {
  if (sessionId !== activeSessionId) return;

  chunksReceived++;
  queue.push({ buffer: chunk, contentType, index });

  // Sort by index to handle out-of-order delivery
  queue.sort((a, b) => a.index - b.index);

  // Start playback if not already playing
  if (!isPlaying) {
    playNext();
  }
}

/**
 * Signal that all audio chunks have been sent for this session.
 * Playback will stop after the last queued chunk finishes.
 */
export function markStreamDone(sessionId: string): void {
  if (sessionId !== activeSessionId) return;
  streamDone = true;

  // If queue is empty and nothing playing, finalize now
  if (!isPlaying && queue.length === 0) {
    finalize();
  }
}

/** Stop progressive playback and reset state. */
export function stopProgressive(): void {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  queue = [];
  isPlaying = false;
  streamDone = false;
  activeSessionId = null;
  chunksReceived = 0;

  useVoiceStore.getState().setPlaying(false, null);
  useVoiceStore.getState().setAnalyserNode(null);
}

/** Whether a progressive session is active (has received at least one chunk). */
export function isProgressiveActive(): boolean {
  return activeSessionId !== null && chunksReceived > 0;
}

/** Get the active progressive session ID. */
export function getProgressiveSessionId(): string | null {
  return activeSessionId;
}

// ---------------------------------------------------------------------------
// Internal playback
// ---------------------------------------------------------------------------

async function playNext(): Promise<void> {
  if (queue.length === 0) {
    isPlaying = false;
    if (streamDone) {
      finalize();
    }
    return;
  }

  isPlaying = true;
  const chunk = queue.shift()!;

  try {
    const { ctx, gainNode: gain } = getSharedAudioContext();

    // Set volume from store
    const volume = useVoiceStore.getState().volume;
    gain.gain.value = volume;

    // Decode the audio chunk
    const audioBuffer = await ctx.decodeAudioData(chunk.buffer.slice(0));

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);
    currentSource = source;

    source.onended = () => {
      currentSource = null;
      // Play next chunk in queue
      playNext();
    };

    source.start();
  } catch (err) {
    console.warn('[ProgressiveAudio] Failed to play chunk:', err);
    currentSource = null;
    // Try next chunk
    playNext();
  }
}

function finalize(): void {
  activeSessionId = null;
  chunksReceived = 0;
  isPlaying = false;
  streamDone = false;

  useVoiceStore.getState().setPlaying(false, null);
  useVoiceStore.getState().setAnalyserNode(null);
}

/**
 * Progressive audio queue — dual-track voice playback (PERF-03/04/06).
 *
 * Track 1: Browser SpeechSynthesis — instant sentence playback (~0ms delay)
 *   Sentences arrive via chat:sentence events and play immediately.
 *
 * Track 2: XTTS audio chunks — custom JARVIS voice (10-30s delay on CPU)
 *   Audio chunks arrive via chat:audio_chunk events and are cached.
 *   Used for "click to replay" with the JARVIS voice.
 *
 * This dual-track approach eliminates perceived delay: the user hears
 * voice immediately via browser speech, while XTTS generates the custom
 * voice in the background for future replays and cache warm-up.
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
// Track 1: Browser SpeechSynthesis — instant sentence playback
// ---------------------------------------------------------------------------

let sentenceQueue: string[] = [];
let isSpeakingBrowser = false;
let browserSessionActive = false;

/**
 * Speak a sentence immediately using browser SpeechSynthesis.
 * Sentences are queued and played sequentially.
 */
export function speakSentenceBrowser(sessionId: string, text: string): void {
  if (sessionId !== activeSessionId) return;
  if (!window.speechSynthesis) return;

  sentenceQueue.push(text);

  if (!isSpeakingBrowser) {
    playNextSentence();
  }
}

function playNextSentence(): void {
  if (sentenceQueue.length === 0) {
    isSpeakingBrowser = false;
    // If browser stream is done and no XTTS audio came in, finalize
    if (browserStreamDone && !xttsChunksReceived) {
      finalize();
    }
    return;
  }

  isSpeakingBrowser = true;
  const text = sentenceQueue.shift()!;
  const store = useVoiceStore.getState();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = store.speed;
  utterance.volume = store.volume;
  utterance.lang = 'en-GB';

  // Try to find a British voice for JARVIS feel
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) => v.lang.startsWith('en-GB') && v.name.toLowerCase().includes('male'),
  ) ?? voices.find(
    (v) => v.lang.startsWith('en-GB'),
  ) ?? voices.find(
    (v) => v.lang.startsWith('en'),
  );
  if (preferred) utterance.voice = preferred;

  utterance.onend = () => playNextSentence();
  utterance.onerror = () => playNextSentence();

  window.speechSynthesis.speak(utterance);
}

// ---------------------------------------------------------------------------
// Track 2: XTTS audio chunks — queued for replay
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
let xttsChunksReceived = 0;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let activeSessionId: string | null = null;
let browserStreamDone = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new progressive voice session.
 * Prepares both browser speech and XTTS tracks.
 */
export function startProgressiveSession(sessionId: string, messageId: string): void {
  stopProgressive();

  activeSessionId = sessionId;
  browserStreamDone = false;
  browserSessionActive = true;
  sentenceQueue = [];
  isSpeakingBrowser = false;

  xttsQueue = [];
  isPlayingXtts = false;
  xttsStreamDone = false;
  xttsChunksReceived = 0;

  const store = useVoiceStore.getState();
  store.setPlaying(true, messageId);
}

/**
 * Queue an XTTS audio chunk. These arrive late (10-30s after sentence).
 * Currently stored for potential replay; browser speech handles live playback.
 */
export function queueAudioChunk(
  sessionId: string,
  chunk: ArrayBuffer,
  contentType: string,
  index: number,
): void {
  if (sessionId !== activeSessionId) return;
  xttsChunksReceived++;
  xttsQueue.push({ buffer: chunk, contentType, index });
  xttsQueue.sort((a, b) => a.index - b.index);

  // If browser speech is already done, play XTTS audio
  // (this path handles the case where XTTS is fast, e.g., cached phrases)
  if (!isSpeakingBrowser && !isPlayingXtts && browserStreamDone) {
    playNextXttsChunk();
  }
}

/**
 * Signal that all XTTS audio chunks have been sent.
 */
export function markStreamDone(sessionId: string): void {
  if (sessionId !== activeSessionId) return;
  xttsStreamDone = true;

  if (!isPlayingXtts && xttsQueue.length === 0 && !isSpeakingBrowser) {
    finalize();
  }
}

/**
 * Signal that all sentences have been emitted (LLM done).
 */
export function markBrowserStreamDone(): void {
  browserStreamDone = true;
  if (!isSpeakingBrowser && !isPlayingXtts) {
    finalize();
  }
}

/** Stop all progressive playback and reset state. */
export function stopProgressive(): void {
  // Stop XTTS playback
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  // Stop browser speech
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  sentenceQueue = [];
  xttsQueue = [];
  isSpeakingBrowser = false;
  isPlayingXtts = false;
  xttsStreamDone = false;
  browserStreamDone = false;
  activeSessionId = null;
  browserSessionActive = false;
  xttsChunksReceived = 0;

  useVoiceStore.getState().setPlaying(false, null);
  useVoiceStore.getState().setAnalyserNode(null);
}

/** Whether a progressive session is active (browser speech started). */
export function isProgressiveActive(): boolean {
  return activeSessionId !== null && browserSessionActive;
}

/** Get the active progressive session ID. */
export function getProgressiveSessionId(): string | null {
  return activeSessionId;
}

// ---------------------------------------------------------------------------
// XTTS playback (for replay or when XTTS is fast)
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
  browserSessionActive = false;
  xttsChunksReceived = 0;
  isPlayingXtts = false;
  isSpeakingBrowser = false;
  xttsStreamDone = false;
  browserStreamDone = false;

  useVoiceStore.getState().setPlaying(false, null);
  useVoiceStore.getState().setAnalyserNode(null);
}

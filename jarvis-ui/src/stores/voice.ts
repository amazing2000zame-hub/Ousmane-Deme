/**
 * Voice state store — hardcoded to local XTTS JARVIS voice.
 * Only user-controllable setting is the on/off toggle.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface VoiceState {
  /** Master voice on/off */
  enabled: boolean;
  /** Auto-play assistant responses */
  autoPlay: boolean;
  /** Playback volume (0.0 - 1.0) */
  volume: number;
  /** Microphone input toggle (STT) */
  micEnabled: boolean;
  /** Wake word ("JARVIS") detection */
  wakeWordEnabled: boolean;

  // Runtime state (not persisted)
  isPlaying: boolean;
  playingMessageId: string | null;
  isRecording: boolean;
  analyserNode: AnalyserNode | null;

  // Actions
  setEnabled: (enabled: boolean) => void;
  setMicEnabled: (enabled: boolean) => void;
  setWakeWordEnabled: (enabled: boolean) => void;
  setPlaying: (isPlaying: boolean, messageId?: string | null) => void;
  setRecording: (isRecording: boolean) => void;
  setAnalyserNode: (node: AnalyserNode | null) => void;
}

const STORAGE_KEY = 'jarvis-voice-settings';

function loadEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return !!parsed.enabled;
    }
  } catch { /* ignore */ }
  return false;
}

function saveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled }));
  } catch { /* ignore */ }
}

export const useVoiceStore = create<VoiceState>()(
  devtools(
    (set) => ({
      // Hardcoded — JARVIS XTTS voice, always
      enabled: loadEnabled(),
      autoPlay: true,
      volume: 0.8,
      micEnabled: false,
      wakeWordEnabled: false,

      // Runtime
      isPlaying: false,
      playingMessageId: null,
      isRecording: false,
      analyserNode: null,

      setEnabled: (enabled) => {
        set({ enabled }, false, 'voice/setEnabled');
        saveEnabled(enabled);
      },
      setMicEnabled: (micEnabled) =>
        set({ micEnabled }, false, 'voice/setMicEnabled'),
      setWakeWordEnabled: (wakeWordEnabled) =>
        set({ wakeWordEnabled }, false, 'voice/setWakeWordEnabled'),
      setPlaying: (isPlaying, messageId = null) =>
        set({ isPlaying, playingMessageId: messageId }, false, 'voice/setPlaying'),
      setRecording: (isRecording) =>
        set({ isRecording }, false, 'voice/setRecording'),
      setAnalyserNode: (analyserNode) =>
        set({ analyserNode }, false, 'voice/setAnalyserNode'),
    }),
    { name: 'voice-store' },
  ),
);

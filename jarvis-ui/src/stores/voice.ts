/**
 * Voice state store — manages TTS/STT settings with localStorage persistence.
 *
 * Settings:
 *  - enabled: master voice toggle (TTS playback)
 *  - autoPlay: auto-play assistant responses when they finish
 *  - speed: TTS playback speed (0.5 - 2.0)
 *  - voice: OpenAI TTS voice name (onyx = deep JARVIS, fable = British warmth)
 *  - volume: playback volume (0.0 - 1.0)
 *  - provider: 'elevenlabs' (preferred) | 'openai' (fallback) | 'browser' (Web Speech API)
 *  - micEnabled: microphone input toggle (STT)
 *  - wakeWordEnabled: listen for "JARVIS" wake word
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type TTSProvider = 'local' | 'elevenlabs' | 'openai' | 'browser';
export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

interface VoiceSettings {
  enabled: boolean;
  autoPlay: boolean;
  speed: number;
  voice: TTSVoice;
  volume: number;
  provider: TTSProvider;
  micEnabled: boolean;
  wakeWordEnabled: boolean;
}

interface VoiceState extends VoiceSettings {
  /** True while TTS audio is currently playing */
  isPlaying: boolean;
  /** Message ID currently being spoken */
  playingMessageId: string | null;
  /** True while microphone is actively recording */
  isRecording: boolean;
  /** Audio analyser node for visualizer (set during playback) */
  analyserNode: AnalyserNode | null;

  // Actions
  setEnabled: (enabled: boolean) => void;
  setAutoPlay: (autoPlay: boolean) => void;
  setSpeed: (speed: number) => void;
  setVoice: (voice: TTSVoice) => void;
  setVolume: (volume: number) => void;
  setProvider: (provider: TTSProvider) => void;
  setMicEnabled: (enabled: boolean) => void;
  setWakeWordEnabled: (enabled: boolean) => void;
  setPlaying: (isPlaying: boolean, messageId?: string | null) => void;
  setRecording: (isRecording: boolean) => void;
  setAnalyserNode: (node: AnalyserNode | null) => void;
}

const STORAGE_KEY = 'jarvis-voice-settings';

/** Load persisted settings from localStorage */
function loadSettings(): Partial<VoiceSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse errors
  }
  return {};
}

/** Persist current settings to localStorage */
function saveSettings(state: VoiceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      enabled: state.enabled,
      autoPlay: state.autoPlay,
      speed: state.speed,
      voice: state.voice,
      volume: state.volume,
      provider: state.provider,
      micEnabled: state.micEnabled,
      wakeWordEnabled: state.wakeWordEnabled,
    }));
  } catch {
    // localStorage might be full or unavailable
  }
}

const defaults: VoiceSettings = {
  enabled: false,
  autoPlay: true,
  speed: 1.0,
  voice: 'onyx',
  volume: 0.8,
  provider: 'local',
  micEnabled: false,
  wakeWordEnabled: false,
};

const persisted = loadSettings();

export const useVoiceStore = create<VoiceState>()(
  devtools(
    (set, get) => ({
      ...defaults,
      ...persisted,
      isPlaying: false,
      playingMessageId: null,
      isRecording: false,
      analyserNode: null,

      setEnabled: (enabled) => {
        set({ enabled }, false, 'voice/setEnabled');
        saveSettings({ ...get(), enabled });
      },
      setAutoPlay: (autoPlay) => {
        set({ autoPlay }, false, 'voice/setAutoPlay');
        saveSettings({ ...get(), autoPlay });
      },
      setSpeed: (speed) => {
        set({ speed }, false, 'voice/setSpeed');
        saveSettings({ ...get(), speed });
      },
      setVoice: (voice) => {
        set({ voice }, false, 'voice/setVoice');
        saveSettings({ ...get(), voice });
      },
      setVolume: (volume) => {
        set({ volume }, false, 'voice/setVolume');
        saveSettings({ ...get(), volume });
      },
      setProvider: (provider) => {
        set({ provider }, false, 'voice/setProvider');
        saveSettings({ ...get(), provider });
      },
      setMicEnabled: (micEnabled) => {
        set({ micEnabled }, false, 'voice/setMicEnabled');
        saveSettings({ ...get(), micEnabled });
      },
      setWakeWordEnabled: (wakeWordEnabled) => {
        set({ wakeWordEnabled }, false, 'voice/setWakeWordEnabled');
        saveSettings({ ...get(), wakeWordEnabled });
      },
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

/**
 * TTS playback hook — fetches audio from backend /api/tts endpoint
 * and plays it via Web Audio API. Falls back to browser SpeechSynthesis
 * when backend TTS is unavailable.
 *
 * Exposes an AnalyserNode on the voice store for the audio visualizer.
 */

import { useCallback, useRef } from 'react';
import { useVoiceStore } from '../stores/voice';
import { useAuthStore } from '../stores/auth';

const BASE_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://192.168.1.50:4000';

/** Singleton AudioContext (created on first user interaction) */
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

interface UseVoiceReturn {
  speak: (text: string, messageId: string) => Promise<void>;
  stop: () => void;
}

export function useVoice(): UseVoiceReturn {
  const token = useAuthStore((s) => s.token);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    // Stop Web Audio API playback
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current = null;
    }
    // Stop browser SpeechSynthesis
    if (utteranceRef.current) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    }
    useVoiceStore.getState().setPlaying(false, null);
    useVoiceStore.getState().setAnalyserNode(null);
  }, []);

  const speakWithBackend = useCallback(async (text: string, messageId: string): Promise<boolean> => {
    try {
      const state = useVoiceStore.getState();
      const res = await fetch(`${BASE_URL}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          text,
          voice: state.voice,
          speed: state.speed,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.fallback === 'browser') return false;
        throw new Error(data.error || `TTS API error: ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const ctx = getAudioContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      // Set volume
      if (gainNode) {
        gainNode.gain.value = state.volume;
      }

      // Create and play source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode!);
      sourceRef.current = source;

      useVoiceStore.getState().setPlaying(true, messageId);
      useVoiceStore.getState().setAnalyserNode(analyser);

      source.onended = () => {
        sourceRef.current = null;
        useVoiceStore.getState().setPlaying(false, null);
        useVoiceStore.getState().setAnalyserNode(null);
      };

      source.start();
      return true;
    } catch (err) {
      console.warn('[Voice] Backend TTS failed, falling back to browser:', err);
      return false;
    }
  }, [token]);

  const speakWithBrowser = useCallback((text: string, messageId: string) => {
    if (!window.speechSynthesis) {
      console.warn('[Voice] SpeechSynthesis not available');
      return;
    }

    window.speechSynthesis.cancel();
    const state = useVoiceStore.getState();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = state.speed;
    utterance.volume = state.volume;
    utterance.lang = 'en-GB';

    // Try to find a British male voice
    const voices = window.speechSynthesis.getVoices();
    const british = voices.find(
      (v) => v.lang.startsWith('en-GB') && v.name.toLowerCase().includes('male'),
    ) ?? voices.find(
      (v) => v.lang.startsWith('en-GB'),
    ) ?? voices.find(
      (v) => v.lang.startsWith('en'),
    );
    if (british) utterance.voice = british;

    utteranceRef.current = utterance;
    useVoiceStore.getState().setPlaying(true, messageId);

    utterance.onend = () => {
      utteranceRef.current = null;
      useVoiceStore.getState().setPlaying(false, null);
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      useVoiceStore.getState().setPlaying(false, null);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(async (text: string, messageId: string) => {
    // Stop any current playback
    stop();

    if (!text.trim()) return;

    const state = useVoiceStore.getState();

    // ElevenLabs and OpenAI both use the backend /api/tts endpoint
    if (state.provider === 'elevenlabs' || state.provider === 'openai') {
      const success = await speakWithBackend(text, messageId);
      if (success) return;
    }

    // Browser fallback (also used when backend fails)
    speakWithBrowser(text, messageId);
  }, [stop, speakWithBackend, speakWithBrowser]);

  return { speak, stop };
}

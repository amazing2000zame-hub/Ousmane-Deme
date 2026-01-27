/**
 * TTS playback hook — fetches audio from backend /api/tts endpoint
 * and plays it via Web Audio API. Falls back to browser SpeechSynthesis
 * when backend TTS is unavailable.
 *
 * For progressive streaming playback (PERF-03/04), see progressive-queue.ts.
 * This hook handles on-demand "click to speak" and post-completion auto-play
 * when the streaming pipeline didn't produce audio.
 *
 * Exposes an AnalyserNode on the voice store for the audio visualizer.
 */

import { useCallback, useRef } from 'react';
import { useVoiceStore } from '../stores/voice';
import { useAuthStore } from '../stores/auth';
import { getSharedAudioContext, stopProgressive } from '../audio/progressive-queue';
import { cleanTextForSpeech } from '../audio/text-cleaner';

const BASE_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://192.168.1.50:4000';

interface UseVoiceReturn {
  speak: (text: string, messageId: string) => Promise<void>;
  stop: () => void;
}

export function useVoice(): UseVoiceReturn {
  const token = useAuthStore((s) => s.token);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    // Stop progressive streaming playback
    stopProgressive();
    // Stop Web Audio API playback (monolithic)
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
      const { ctx, analyser: sharedAnalyser, gainNode: sharedGain } = getSharedAudioContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      // Set volume
      sharedGain.gain.value = state.volume;

      // Create and play source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(sharedGain);
      sourceRef.current = source;

      useVoiceStore.getState().setPlaying(true, messageId);
      useVoiceStore.getState().setAnalyserNode(sharedAnalyser);

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

    // Clean markdown and special characters before speaking
    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) return;

    const state = useVoiceStore.getState();

    // All non-browser providers use the backend /api/tts endpoint
    if (state.provider === 'local' || state.provider === 'elevenlabs' || state.provider === 'openai') {
      const success = await speakWithBackend(cleaned, messageId);
      if (success) return;
    }

    // Browser fallback (also used when backend fails)
    speakWithBrowser(cleaned, messageId);
  }, [stop, speakWithBackend, speakWithBrowser]);

  return { speak, stop };
}

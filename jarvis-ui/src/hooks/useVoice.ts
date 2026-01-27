/**
 * TTS playback hook — fetches audio from backend /api/tts endpoint
 * and plays it via Web Audio API using the local XTTS JARVIS voice.
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

  const stop = useCallback(() => {
    // Stop progressive streaming playback
    stopProgressive();
    // Stop Web Audio API playback (monolithic)
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current = null;
    }
    useVoiceStore.getState().setPlaying(false, null);
    useVoiceStore.getState().setAnalyserNode(null);
  }, []);

  const speak = useCallback(async (text: string, messageId: string) => {
    // Stop any current playback
    stop();

    // Clean markdown and special characters before speaking
    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) return;

    try {
      const res = await fetch(`${BASE_URL}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: cleaned,
          voice: 'jarvis',
          speed: 1.0,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn('[Voice] Backend TTS error:', data.error || res.status);
        return;
      }

      const arrayBuffer = await res.arrayBuffer();
      const { ctx, analyser: sharedAnalyser, gainNode: sharedGain } = getSharedAudioContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      // Set volume (hardcoded)
      sharedGain.gain.value = 0.8;

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
    } catch (err) {
      console.warn('[Voice] Backend TTS failed:', err);
    }
  }, [stop, token]);

  return { speak, stop };
}

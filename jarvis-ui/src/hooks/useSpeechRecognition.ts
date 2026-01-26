/**
 * Speech-to-text hook using the Web Speech API (SpeechRecognition).
 *
 * Features:
 *  - Start/stop recording with microphone permission handling
 *  - Interim + final transcript updates
 *  - "JARVIS" wake word detection (optional continuous listening)
 *  - Auto-stop after configurable silence timeout
 *
 * Browser support: Chrome, Edge, Safari 14.1+. Not supported in Firefox.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceStore } from '../stores/voice';

// Web Speech API types (not in standard lib)
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

interface UseSpeechRecognitionReturn {
  /** Whether Web Speech API is available in this browser */
  supported: boolean;
  /** Whether the mic is actively recording */
  isListening: boolean;
  /** Current transcript (interim + final) */
  transcript: string;
  /** Start recording */
  startListening: () => void;
  /** Stop recording */
  stopListening: () => void;
  /** Clear the transcript */
  clearTranscript: () => void;
}

const WAKE_WORD = /\bjarvis\b/i;
const SILENCE_TIMEOUT_MS = 5000;

export function useSpeechRecognition(
  onFinalTranscript?: (text: string) => void,
): UseSpeechRecognitionReturn {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeWordListenerRef = useRef<SpeechRecognitionInstance | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    useVoiceStore.getState().setRecording(false);
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    if (!supported || isListening) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';
    recognitionRef.current = recognition;

    let finalText = '';

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
      useVoiceStore.getState().setRecording(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      clearSilenceTimer();
      let interim = '';
      finalText = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      setTranscript(finalText + interim);

      // Reset silence timer
      silenceTimerRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, SILENCE_TIMEOUT_MS);
    };

    recognition.onend = () => {
      setIsListening(false);
      useVoiceStore.getState().setRecording(false);
      recognitionRef.current = null;
      clearSilenceTimer();

      if (finalText.trim() && onFinalTranscript) {
        onFinalTranscript(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      console.warn('[STT] Recognition error:', event.error);
      if (event.error !== 'no-speech') {
        setIsListening(false);
        useVoiceStore.getState().setRecording(false);
        recognitionRef.current = null;
      }
    };

    recognition.start();
  }, [supported, isListening, clearSilenceTimer, onFinalTranscript]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  // Wake word detection (continuous background listening)
  const wakeWordEnabled = useVoiceStore((s) => s.wakeWordEnabled);
  const voiceEnabled = useVoiceStore((s) => s.enabled);

  useEffect(() => {
    if (!supported || !wakeWordEnabled || !voiceEnabled || isListening) {
      // Stop wake word listener
      if (wakeWordListenerRef.current) {
        wakeWordListenerRef.current.abort();
        wakeWordListenerRef.current = null;
      }
      return;
    }

    const wakeListener = new SpeechRecognition();
    wakeListener.continuous = true;
    wakeListener.interimResults = true;
    wakeListener.lang = 'en-GB';
    wakeWordListenerRef.current = wakeListener;

    wakeListener.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (WAKE_WORD.test(text)) {
          // Wake word detected — stop background listener and start main recording
          wakeListener.stop();
          wakeWordListenerRef.current = null;
          startListening();
          return;
        }
      }
    };

    wakeListener.onend = () => {
      // Restart wake word listener if still enabled
      if (wakeWordListenerRef.current === wakeListener) {
        try { wakeListener.start(); } catch { /* ignore */ }
      }
    };

    wakeListener.onerror = () => {
      // Restart on error
      if (wakeWordListenerRef.current === wakeListener) {
        setTimeout(() => {
          try { wakeListener.start(); } catch { /* ignore */ }
        }, 1000);
      }
    };

    try {
      wakeListener.start();
    } catch {
      // Browser may block without user gesture
    }

    return () => {
      wakeListener.abort();
      wakeWordListenerRef.current = null;
    };
  }, [supported, wakeWordEnabled, voiceEnabled, isListening, startListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (wakeWordListenerRef.current) wakeWordListenerRef.current.abort();
      clearSilenceTimer();
    };
  }, [clearSilenceTimer]);

  return {
    supported,
    isListening,
    transcript,
    startListening,
    stopListening,
    clearTranscript,
  };
}

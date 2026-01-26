import { useState, useEffect, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { useVoiceStore } from '../../stores/voice';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const voiceEnabled = useVoiceStore((s) => s.enabled);
  const micEnabled = useVoiceStore((s) => s.micEnabled);

  const handleFinalTranscript = useCallback(
    (text: string) => {
      if (text.trim() && !disabled) {
        onSend(text.trim());
      }
    },
    [onSend, disabled],
  );

  const {
    supported: sttSupported,
    isListening,
    transcript,
    startListening,
    stopListening,
    clearTranscript,
  } = useSpeechRecognition(handleFinalTranscript);

  // Update input with live transcript
  useEffect(() => {
    if (isListening && transcript) {
      setValue(transcript);
    }
  }, [isListening, transcript]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    clearTranscript();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleMicToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const showMic = voiceEnabled && micEnabled && sttSupported;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-jarvis-amber/10 bg-jarvis-bg-panel">
      {/* Mic button */}
      {showMic && (
        <button
          type="button"
          onClick={handleMicToggle}
          disabled={disabled}
          title={isListening ? 'Stop recording' : 'Voice input'}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${
            isListening
              ? 'bg-red-500/20 border border-red-500/50 text-red-400 animate-pulse'
              : 'border border-jarvis-amber/20 text-jarvis-text-muted hover:text-jarvis-amber hover:border-jarvis-amber/40'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0v-4A2.5 2.5 0 008 1z" />
            <path d="M3.5 7.5a.5.5 0 011 0 3.5 3.5 0 007 0 .5.5 0 011 0 4.5 4.5 0 01-4 4.473V14h2a.5.5 0 010 1h-5a.5.5 0 010-1h2v-2.027a4.5 4.5 0 01-4-4.473z" />
          </svg>
        </button>
      )}

      {/* Text input */}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={isListening ? 'Listening...' : 'Speak to J.A.R.V.I.S...'}
        className={`flex-1 bg-jarvis-bg-card/50 border rounded px-3 py-2 text-sm font-mono text-jarvis-text placeholder-jarvis-text-muted focus:outline-none transition-colors disabled:opacity-40 ${
          isListening
            ? 'border-red-500/30 focus:border-red-500/50'
            : 'border-jarvis-amber/20 focus:border-jarvis-amber/50'
        }`}
      />

      {/* Send button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="px-3 py-2 text-[10px] font-display tracking-wider text-jarvis-amber border border-jarvis-amber/30 rounded bg-jarvis-amber/5 hover:bg-jarvis-amber/15 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        SEND
      </button>
    </div>
  );
}

import { useState } from 'react';
import type { KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-jarvis-amber/10 bg-jarvis-bg-panel">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Speak to J.A.R.V.I.S..."
        className="flex-1 bg-jarvis-bg-card/50 border border-jarvis-amber/20 rounded px-3 py-2 text-sm font-mono text-jarvis-text placeholder-jarvis-text-muted focus:outline-none focus:border-jarvis-amber/50 transition-colors disabled:opacity-40"
      />
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

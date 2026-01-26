/**
 * Compact play/stop button for TTS playback on assistant messages.
 * Shows a small speaker icon; toggles between play and stop states.
 */

interface VoicePlayButtonProps {
  isPlaying: boolean;
  onPlay: () => void;
}

export function VoicePlayButton({ isPlaying, onPlay }: VoicePlayButtonProps) {
  return (
    <button
      type="button"
      onClick={onPlay}
      title={isPlaying ? 'Stop speaking' : 'Speak this message'}
      className={`w-4 h-4 flex items-center justify-center rounded transition-all ${
        isPlaying
          ? 'text-cyan-400 animate-pulse'
          : 'text-jarvis-text-muted hover:text-jarvis-amber'
      }`}
    >
      {isPlaying ? (
        // Stop icon (small square)
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
          <rect x="0" y="0" width="8" height="8" rx="1" />
        </svg>
      ) : (
        // Speaker icon
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5L4 5H1v6h3l4 3.5V1.5zM11.5 4.5a4.5 4.5 0 010 7M13.5 2.5a7.5 7.5 0 010 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d="M8 1.5L4 5H1v6h3l4 3.5V1.5z" />
        </svg>
      )}
    </button>
  );
}

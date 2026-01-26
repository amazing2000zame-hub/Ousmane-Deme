/**
 * Voice settings panel — configures TTS/STT preferences.
 * Appears as a dropdown panel from the voice toggle button.
 *
 * Settings: voice selection, speed, volume, auto-play, mic input, wake word.
 */

import { useVoiceStore } from '../../stores/voice';
import type { TTSVoice, TTSProvider } from '../../stores/voice';

interface VoiceSettingsProps {
  onClose: () => void;
}

const VOICES: { value: TTSVoice; label: string; desc: string }[] = [
  { value: 'onyx', label: 'Onyx', desc: 'Deep, authoritative' },
  { value: 'fable', label: 'Fable', desc: 'British, warm' },
  { value: 'echo', label: 'Echo', desc: 'Neutral, steady' },
  { value: 'alloy', label: 'Alloy', desc: 'Balanced, clear' },
  { value: 'nova', label: 'Nova', desc: 'Bright, energetic' },
  { value: 'shimmer', label: 'Shimmer', desc: 'Soft, expressive' },
];

const PROVIDERS: { value: TTSProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'browser', label: 'Browser (Free)' },
];

export function VoiceSettings({ onClose }: VoiceSettingsProps) {
  const voice = useVoiceStore((s) => s.voice);
  const speed = useVoiceStore((s) => s.speed);
  const volume = useVoiceStore((s) => s.volume);
  const autoPlay = useVoiceStore((s) => s.autoPlay);
  const micEnabled = useVoiceStore((s) => s.micEnabled);
  const wakeWordEnabled = useVoiceStore((s) => s.wakeWordEnabled);
  const provider = useVoiceStore((s) => s.provider);

  const setVoice = useVoiceStore((s) => s.setVoice);
  const setSpeed = useVoiceStore((s) => s.setSpeed);
  const setVolume = useVoiceStore((s) => s.setVolume);
  const setAutoPlay = useVoiceStore((s) => s.setAutoPlay);
  const setMicEnabled = useVoiceStore((s) => s.setMicEnabled);
  const setWakeWordEnabled = useVoiceStore((s) => s.setWakeWordEnabled);
  const setProvider = useVoiceStore((s) => s.setProvider);

  return (
    <div className="absolute top-full right-0 mt-1 w-72 bg-jarvis-bg-panel border border-jarvis-amber/20 rounded-lg shadow-lg z-50 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-display text-[10px] tracking-wider text-jarvis-amber uppercase">
          Voice Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-jarvis-text-muted hover:text-jarvis-amber text-xs"
        >
          &times;
        </button>
      </div>

      {/* Provider */}
      <SettingRow label="Provider">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as TTSProvider)}
          className="bg-jarvis-bg-card border border-jarvis-amber/20 rounded px-2 py-1 text-xs text-jarvis-text font-mono"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </SettingRow>

      {/* Voice Selection (only for OpenAI) */}
      {provider === 'openai' && (
        <SettingRow label="Voice">
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value as TTSVoice)}
            className="bg-jarvis-bg-card border border-jarvis-amber/20 rounded px-2 py-1 text-xs text-jarvis-text font-mono"
          >
            {VOICES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label} — {v.desc}
              </option>
            ))}
          </select>
        </SettingRow>
      )}

      {/* Speed */}
      <SettingRow label={`Speed: ${speed.toFixed(1)}x`}>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="w-full accent-amber-500"
        />
      </SettingRow>

      {/* Volume */}
      <SettingRow label={`Volume: ${Math.round(volume * 100)}%`}>
        <input
          type="range"
          min="0"
          max="1.0"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full accent-amber-500"
        />
      </SettingRow>

      {/* Toggles */}
      <div className="space-y-2 pt-1 border-t border-jarvis-amber/10">
        <Toggle label="Auto-play responses" checked={autoPlay} onChange={setAutoPlay} />
        <Toggle label="Microphone input" checked={micEnabled} onChange={setMicEnabled} />
        <Toggle
          label='Wake word ("JARVIS")'
          checked={wakeWordEnabled}
          onChange={setWakeWordEnabled}
          disabled={!micEnabled}
        />
      </div>
    </div>
  );
}

/** Labeled row for a setting control */
function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-display tracking-wider text-jarvis-text-muted uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Toggle switch component */
function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center justify-between cursor-pointer ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-xs text-jarvis-text font-mono">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition-colors ${
          checked ? 'bg-jarvis-amber/40' : 'bg-jarvis-bg-card border border-jarvis-amber/20'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full transition-transform ${
            checked
              ? 'translate-x-4 bg-jarvis-amber'
              : 'translate-x-0.5 bg-jarvis-text-muted'
          }`}
        />
      </button>
    </label>
  );
}

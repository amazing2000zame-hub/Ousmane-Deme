import { useState } from 'react';
import { ActivityFeed } from './ActivityFeed';
import { ChatPanel } from './ChatPanel';
import { GlobeHUD } from './GlobeHUD';
import { useVoiceStore } from '../../stores/voice';

type CenterView = 'hud' | 'feed' | 'chat';

/**
 * CenterDisplay -- split view with Iron Man-style Globe HUD above
 * and ActivityFeed below. Toggle tabs switch between full-HUD and full-feed views.
 * Chat view includes voice toggle button for JARVIS TTS.
 */
export function CenterDisplay() {
  const [view, setView] = useState<CenterView>('hud');
  const voiceEnabled = useVoiceStore((s) => s.enabled);
  const setVoiceEnabled = useVoiceStore((s) => s.setEnabled);
  const isPlaying = useVoiceStore((s) => s.isPlaying);
  const isRecording = useVoiceStore((s) => s.isRecording);

  return (
    <div className="flex flex-col h-full" data-panel="center">
      {/* Header with view tabs */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-jarvis-amber/10 bg-jarvis-bg-panel shrink-0">
        <span className="font-display text-jarvis-amber-dim text-xs tracking-wider uppercase">
          JARVIS {view === 'hud' ? 'HUD' : view === 'feed' ? 'ACTIVITY' : 'CHAT'}
        </span>

        <div className="flex items-center gap-2">
          {/* Voice on/off toggle (shown in chat view) */}
          {view === 'chat' && (
            <button
              type="button"
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              title={voiceEnabled ? 'Disable JARVIS voice' : 'Enable JARVIS voice'}
              className={`px-2 py-0.5 text-[9px] font-display tracking-wider rounded transition-all duration-200 flex items-center gap-1 ${
                voiceEnabled
                  ? isPlaying
                    ? 'bg-jarvis-cyan/15 text-jarvis-cyan border border-jarvis-cyan/30 animate-pulse'
                    : isRecording
                      ? 'bg-jarvis-red/15 text-jarvis-red border border-jarvis-red/30 animate-pulse'
                      : 'bg-jarvis-amber/15 text-jarvis-amber border border-jarvis-amber/30'
                  : 'text-jarvis-text-dim hover:text-jarvis-amber-dim border border-transparent'
              }`}
            >
              {/* Speaker icon */}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                {isRecording ? (
                  <>
                    <path d="M8 1a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0v-4A2.5 2.5 0 008 1z" />
                    <path d="M3.5 7.5a.5.5 0 011 0 3.5 3.5 0 007 0 .5.5 0 011 0 4.5 4.5 0 01-4 4.473V14h2a.5.5 0 010 1h-5a.5.5 0 010-1h2v-2.027a4.5 4.5 0 01-4-4.473z" />
                  </>
                ) : (
                  <>
                    <path d="M8 1.5L4 5H1v6h3l4 3.5V1.5z" />
                    {voiceEnabled && (
                      <>
                        <path d="M11.5 4.5a4.5 4.5 0 010 7" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                        <path d="M13.5 2.5a7.5 7.5 0 010 11" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                      </>
                    )}
                  </>
                )}
              </svg>
              VOICE
            </button>
          )}

          {/* View tabs */}
          <div className="flex gap-0.5">
            {(['hud', 'feed', 'chat'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-2 py-0.5 text-[9px] font-display tracking-wider rounded transition-all duration-200 ${
                  view === v
                    ? 'bg-jarvis-amber/15 text-jarvis-amber border border-jarvis-amber/30'
                    : 'text-jarvis-text-dim hover:text-jarvis-amber-dim border border-transparent'
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'chat' ? (
          <ChatPanel />
        ) : view === 'hud' ? (
          <div className="flex flex-col">
            {/* Globe HUD */}
            <GlobeHUD />

            {/* Recent activity divider */}
            <div className="flex items-center gap-2 px-3 py-1 mt-1">
              <div className="flex-1 h-px bg-jarvis-amber/10" />
              <span className="font-display text-[8px] text-jarvis-text-muted tracking-[0.2em] uppercase">
                RECENT ACTIVITY
              </span>
              <div className="flex-1 h-px bg-jarvis-amber/10" />
            </div>

            {/* Compact activity feed below globe */}
            <div className="px-2 pb-2">
              <ActivityFeed />
            </div>
          </div>
        ) : (
          <div className="p-2">
            <ActivityFeed />
          </div>
        )}
      </div>
    </div>
  );
}

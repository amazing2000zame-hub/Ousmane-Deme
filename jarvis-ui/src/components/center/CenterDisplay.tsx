import { useState } from 'react';
import { ActivityFeed } from './ActivityFeed';
import { GlobeHUD } from './GlobeHUD';

type CenterView = 'hud' | 'feed';

/**
 * CenterDisplay -- split view with Iron Man-style Globe HUD above
 * and ActivityFeed below. Toggle tabs switch between full-HUD and full-feed views.
 */
export function CenterDisplay() {
  const [view, setView] = useState<CenterView>('hud');

  return (
    <div className="flex flex-col h-full" data-panel="center">
      {/* Header with view tabs */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-jarvis-amber/10 bg-jarvis-bg-panel shrink-0">
        <span className="font-display text-jarvis-amber-dim text-xs tracking-wider uppercase">
          JARVIS {view === 'hud' ? 'HUD' : 'ACTIVITY'}
        </span>
        <div className="flex gap-0.5">
          {(['hud', 'feed'] as const).map((v) => (
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

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'hud' ? (
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

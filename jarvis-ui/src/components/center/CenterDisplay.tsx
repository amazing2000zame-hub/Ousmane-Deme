import { useClusterStore } from '../../stores/cluster';
import { PanelFrame } from '../layout/PanelFrame';
import { ActivityFeed } from './ActivityFeed';

/**
 * CenterDisplay -- context-aware center column view switcher.
 * Currently displays ActivityFeed as the default view.
 * When no events exist, shows a JARVIS HUD placeholder.
 * In Phase 3 this will switch between ActivityFeed, JarvisDisplay, and Chat.
 */
export function CenterDisplay() {
  const events = useClusterStore((s) => s.events);
  const hasEvents = events.length > 0;

  return (
    <PanelFrame title="JARVIS ACTIVITY" className="flex-1" column="center">
      {hasEvents ? (
        <ActivityFeed />
      ) : (
        <div className="flex flex-col items-center justify-center h-64">
          {/* Hexagonal frame placeholder */}
          <div
            className="relative w-24 h-24 flex items-center justify-center mb-4"
            style={{
              border: '1px solid rgba(255, 184, 0, 0.15)',
              borderRadius: '12px',
              transform: 'rotate(0deg)',
            }}
          >
            <div
              className="w-16 h-16 flex items-center justify-center"
              style={{
                border: '1px solid rgba(255, 184, 0, 0.1)',
                borderRadius: '8px',
              }}
            >
              <span className="font-display text-jarvis-amber/40 text-xs tracking-wider">
                HUD
              </span>
            </div>
          </div>
          <span className="font-display text-jarvis-amber/30 text-sm tracking-[0.3em] uppercase">
            JARVIS DISPLAY
          </span>
          <span className="font-mono text-jarvis-text-muted text-xs mt-2">
            Awaiting activity data...
          </span>
        </div>
      )}
    </PanelFrame>
  );
}

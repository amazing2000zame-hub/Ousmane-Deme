import { PanelFrame } from '../layout/PanelFrame';
import { ActivityFeed } from './ActivityFeed';

/**
 * CenterDisplay -- context-aware center column view switcher.
 * Currently displays ActivityFeed as the default view.
 * In Phase 3 this will switch between ActivityFeed, JarvisDisplay, and Chat.
 */
export function CenterDisplay() {
  return (
    <PanelFrame title="JARVIS ACTIVITY" className="flex-1">
      <ActivityFeed />
    </PanelFrame>
  );
}

import { useHotkeys } from 'react-hotkeys-hook';
import { useUIStore } from '../stores/ui';
import { useTerminalStore } from '../stores/terminal';
import type { VisualMode } from '../theme/modes';

const MODE_CYCLE: VisualMode[] = ['jarvis', 'ops', 'minimal'];

/**
 * Keyboard shortcut orchestration for dashboard navigation.
 * Call at the Dashboard level.
 *
 * Shortcuts:
 * - 1 / Alt+1: Focus left panel
 * - 2 / Alt+2: Focus center panel
 * - 3 / Alt+3: Focus right panel (terminal)
 * - t: Toggle terminal collapse
 * - m: Cycle visual mode (jarvis -> ops -> minimal -> jarvis)
 * - Escape: Unfocus all panels
 *
 * Shortcuts are disabled when form inputs or contentEditable elements are focused,
 * preventing interference with terminal typing and other text input.
 */
export function useKeyboardNav() {
  const setFocusedPanel = useUIStore((s) => s.setFocusedPanel);
  const setVisualMode = useUIStore((s) => s.setVisualMode);
  const visualMode = useUIStore((s) => s.visualMode);
  const toggleCollapse = useTerminalStore((s) => s.toggleCollapse);

  // Panel focus: 1 / Alt+1 -> left
  useHotkeys(
    '1, alt+1',
    () => setFocusedPanel('left'),
    { enableOnFormTags: false, enableOnContentEditable: false },
  );

  // Panel focus: 2 / Alt+2 -> center
  useHotkeys(
    '2, alt+2',
    () => setFocusedPanel('center'),
    { enableOnFormTags: false, enableOnContentEditable: false },
  );

  // Panel focus: 3 / Alt+3 -> right (terminal)
  useHotkeys(
    '3, alt+3',
    () => setFocusedPanel('right'),
    { enableOnFormTags: false, enableOnContentEditable: false },
  );

  // Toggle terminal collapse
  useHotkeys(
    't',
    () => toggleCollapse(),
    { enableOnFormTags: false, enableOnContentEditable: false },
  );

  // Cycle visual mode
  useHotkeys(
    'm',
    () => {
      const currentIdx = MODE_CYCLE.indexOf(visualMode);
      const nextIdx = (currentIdx + 1) % MODE_CYCLE.length;
      setVisualMode(MODE_CYCLE[nextIdx]);
    },
    { enableOnFormTags: false, enableOnContentEditable: false },
    [visualMode],
  );

  // Escape: unfocus all panels
  useHotkeys(
    'escape',
    () => setFocusedPanel(null),
    { enableOnFormTags: true, enableOnContentEditable: true },
  );
}

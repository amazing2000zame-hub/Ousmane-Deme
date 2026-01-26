import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { VisualMode } from '../theme/modes';

interface UIState {
  visualMode: VisualMode;
  bootComplete: boolean;
  focusedPanel: 'left' | 'center' | 'right' | null;

  setVisualMode: (mode: VisualMode) => void;
  setBootComplete: (complete: boolean) => void;
  setFocusedPanel: (panel: 'left' | 'center' | 'right' | null) => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        visualMode: 'jarvis' as VisualMode,
        bootComplete: false,
        focusedPanel: null,

        setVisualMode: (mode) =>
          set({ visualMode: mode }, false, 'ui/setVisualMode'),

        setBootComplete: (complete) =>
          set({ bootComplete: complete }, false, 'ui/setBootComplete'),

        setFocusedPanel: (panel) =>
          set({ focusedPanel: panel }, false, 'ui/setFocusedPanel'),
      }),
      {
        name: 'jarvis-ui',
        partialize: (state) => ({ visualMode: state.visualMode }),
      },
    ),
    { name: 'ui-store' },
  ),
);

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { VisualMode } from '../theme/modes';

export type ColorTheme = 'amber' | 'cyan' | 'green' | 'purple' | 'red';

interface UIState {
  visualMode: VisualMode;
  colorTheme: ColorTheme;
  bootComplete: boolean;
  focusedPanel: 'left' | 'center' | 'right' | null;

  setVisualMode: (mode: VisualMode) => void;
  setColorTheme: (theme: ColorTheme) => void;
  setBootComplete: (complete: boolean) => void;
  setFocusedPanel: (panel: 'left' | 'center' | 'right' | null) => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        visualMode: 'jarvis' as VisualMode,
        colorTheme: 'amber' as ColorTheme,
        bootComplete: false,
        focusedPanel: null,

        setVisualMode: (mode) =>
          set({ visualMode: mode }, false, 'ui/setVisualMode'),

        setColorTheme: (theme) =>
          set({ colorTheme: theme }, false, 'ui/setColorTheme'),

        setBootComplete: (complete) =>
          set({ bootComplete: complete }, false, 'ui/setBootComplete'),

        setFocusedPanel: (panel) =>
          set({ focusedPanel: panel }, false, 'ui/setFocusedPanel'),
      }),
      {
        name: 'jarvis-ui',
        partialize: (state) => ({
          visualMode: state.visualMode,
          colorTheme: state.colorTheme,
        }),
      },
    ),
    { name: 'ui-store' },
  ),
);

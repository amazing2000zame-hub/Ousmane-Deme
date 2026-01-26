import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface TerminalState {
  selectedNode: string | null;
  isConnected: boolean;
  isCollapsed: boolean;

  selectNode: (name: string | null) => void;
  setConnected: (connected: boolean) => void;
  toggleCollapse: () => void;
}

export const useTerminalStore = create<TerminalState>()(
  devtools(
    (set) => ({
      selectedNode: null,
      isConnected: false,
      isCollapsed: false,

      selectNode: (name) =>
        set({ selectedNode: name }, false, 'terminal/selectNode'),

      setConnected: (connected) =>
        set({ isConnected: connected }, false, 'terminal/setConnected'),

      toggleCollapse: () =>
        set(
          (state) => ({ isCollapsed: !state.isCollapsed }),
          false,
          'terminal/toggleCollapse',
        ),
    }),
    { name: 'terminal-store' },
  ),
);

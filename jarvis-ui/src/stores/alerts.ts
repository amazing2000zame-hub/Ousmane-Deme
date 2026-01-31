import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface AlertNotification {
  id: string;
  type: 'unknown_person';
  camera: string;
  timestamp: number; // Unix timestamp in seconds
  thumbnailUrl: string;
  snapshotUrl: string;
  message: string;
  receivedAt: number; // When we received it (ms)
}

interface AlertState {
  alerts: AlertNotification[];
  ttsEnabled: boolean;

  // Actions
  addAlert: (alert: Omit<AlertNotification, 'receivedAt'>) => void;
  clearAlerts: () => void;
  setTtsEnabled: (enabled: boolean) => void;
  getRecentAlerts: (sinceMinutes?: number) => AlertNotification[];
}

export const useAlertStore = create<AlertState>()(
  devtools(
    (set, get) => ({
      alerts: [],
      ttsEnabled: true,

      addAlert: (alert) => {
        const fullAlert: AlertNotification = {
          ...alert,
          receivedAt: Date.now(),
        };
        set(
          (state) => ({
            // Keep last 50 alerts, newest first
            alerts: [fullAlert, ...state.alerts].slice(0, 50),
          }),
          false,
          'alerts/addAlert',
        );
      },

      clearAlerts: () => set({ alerts: [] }, false, 'alerts/clear'),

      setTtsEnabled: (enabled) => set({ ttsEnabled: enabled }, false, 'alerts/setTtsEnabled'),

      getRecentAlerts: (sinceMinutes = 60) => {
        const threshold = Date.now() - sinceMinutes * 60 * 1000;
        return get().alerts.filter((a) => a.receivedAt > threshold);
      },
    }),
    { name: 'alerts-store' },
  ),
);

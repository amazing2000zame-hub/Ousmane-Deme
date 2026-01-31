/**
 * Alert Notification Component - Phase 29
 *
 * Displays proactive security alerts as toast notifications.
 * Shows thumbnail from Frigate and auto-dismisses after 10 seconds.
 */

import { toast, Toaster } from 'sonner';
import type { AlertNotification as AlertData } from '../../stores/alerts';

const FRIGATE_URL = import.meta.env.VITE_FRIGATE_URL || 'http://192.168.1.61:5000';

export function AlertToast({ alert }: { alert: AlertData }) {
  const cameraName = alert.camera.replace(/_/g, ' ');
  const time = new Date(alert.timestamp * 1000).toLocaleTimeString();

  return (
    <div className="flex items-start gap-3 p-2">
      <img
        src={`${FRIGATE_URL}/api/events/${alert.id}/thumbnail.jpg`}
        alt={`${cameraName} snapshot`}
        className="w-20 h-15 rounded object-cover"
        loading="lazy"
      />
      <div className="flex-1 min-w-0">
        <div className="text-cyan-400 font-medium text-sm">
          Unknown Person
        </div>
        <div className="text-slate-300 text-xs mt-0.5">
          {cameraName} at {time}
        </div>
      </div>
    </div>
  );
}

export function showAlertToast(alert: AlertData): void {
  toast.custom(
    (t) => (
      <div
        className="bg-slate-800/95 border border-cyan-500/30 rounded-lg shadow-lg shadow-cyan-500/10 cursor-pointer"
        onClick={() => toast.dismiss(t)}
      >
        <AlertToast alert={alert} />
      </div>
    ),
    {
      duration: 10000, // 10 second auto-dismiss (ALERT-03)
      position: 'top-right',
    },
  );
}

// Export Toaster wrapper configured for dark theme
// Note: This is a secondary toaster for alerts in top-right position.
// The main app Toaster stays at bottom-right for general notifications.
export function AlertToasterProvider() {
  return (
    <Toaster
      theme="dark"
      position="top-right"
      toastOptions={{
        style: {
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
        },
      }}
    />
  );
}

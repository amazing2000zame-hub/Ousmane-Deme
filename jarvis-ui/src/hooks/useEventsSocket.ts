import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { createEventsSocket } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useClusterStore } from '../stores/cluster';
import { useCameraStore } from '../stores/camera';
import { useAlertStore, type AlertNotification } from '../stores/alerts';
import { useVoiceStore } from '../stores/voice';
import { showAlertToast } from '../components/alerts/AlertNotification';
import { getMonitorStatus, getRecentEvents } from '../services/api';
import type { JarvisEvent } from '../types/events';

/**
 * Hook that manages the Socket.IO /events namespace connection.
 * Receives events and alerts, pushes them into the cluster store event ring buffer.
 * Also handles kill switch status change events and fetches initial monitor status.
 * Call once at the app level (e.g., in App.tsx).
 */
export function useEventsSocket(): void {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const socketRef = useRef<Socket | null>(null);

  const addEvent = useClusterStore((s) => s.addEvent);
  const setEvents = useClusterStore((s) => s.setEvents);
  const setKillSwitch = useClusterStore((s) => s.setKillSwitch);
  const setMonitorStatus = useClusterStore((s) => s.setMonitorStatus);

  // Alert store for proactive notifications (Phase 29)
  const addAlert = useAlertStore((s) => s.addAlert);
  const alertTtsEnabled = useAlertStore((s) => s.ttsEnabled);
  const voiceEnabled = useVoiceStore((s) => s.enabled);

  useEffect(() => {
    if (!token) return;

    const socket = createEventsSocket(token);
    socketRef.current = socket;

    // Named handlers for proper cleanup with socket.off()
    function onEvent(data: JarvisEvent) {
      addEvent(data);

      // If this is a kill switch event, update monitor status in store
      if (data.type === 'status' && data.title?.includes('KILL SWITCH')) {
        const isActive = data.title.includes('ACTIVATED');
        setKillSwitch(isActive);
      }
    }

    function onAlert(data: JarvisEvent) {
      addEvent(data);
    }

    function onShowLiveFeed(data: { camera: string; timestamp: string }) {
      console.log('[Events] Received show_live_feed:', data.camera);
      useCameraStore.getState().openLiveModal(data.camera);
    }

    // Phase 29: Proactive alert notification handler
    function onAlertNotification(alert: Omit<AlertNotification, 'receivedAt'>) {
      console.log('[Alert] Received notification:', alert.camera, alert.id);

      // Add to store
      addAlert(alert);

      // Show toast notification
      showAlertToast({ ...alert, receivedAt: Date.now() });

      // Play TTS announcement if enabled (ALERT-05)
      if (alertTtsEnabled && voiceEnabled) {
        // Use browser speech synthesis for immediate playback
        // (Backend Piper TTS would add latency)
        const utterance = new SpeechSynthesisUtterance(alert.message);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;
        speechSynthesis.speak(utterance);
      }
    }

    function onConnect() {
      // Fetch initial monitor status on socket connection
      getMonitorStatus(token!).then(setMonitorStatus).catch(() => {});
      // Seed ActivityFeed with recent event history
      getRecentEvents(token!, 50).then(setEvents).catch(() => {});
    }

    function onConnectError(err: Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('token') || msg.includes('expired') || msg.includes('unauthorized')) {
        logout();
      }
    }

    socket.on('event', onEvent);
    socket.on('alert', onAlert);
    socket.on('show_live_feed', onShowLiveFeed);
    socket.on('alert:notification', onAlertNotification);
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);

    socket.connect();

    return () => {
      socket.off('event', onEvent);
      socket.off('alert', onAlert);
      socket.off('show_live_feed', onShowLiveFeed);
      socket.off('alert:notification', onAlertNotification);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, logout, addEvent, setEvents, setKillSwitch, setMonitorStatus, addAlert, alertTtsEnabled, voiceEnabled]);
}

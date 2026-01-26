import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { createEventsSocket } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useClusterStore } from '../stores/cluster';
import type { JarvisEvent } from '../types/events';

/**
 * Hook that manages the Socket.IO /events namespace connection.
 * Receives events and alerts, pushes them into the cluster store event ring buffer.
 * Call once at the app level (e.g., in App.tsx).
 */
export function useEventsSocket(): void {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const socketRef = useRef<Socket | null>(null);

  const addEvent = useClusterStore((s) => s.addEvent);

  useEffect(() => {
    if (!token) return;

    const socket = createEventsSocket(token);
    socketRef.current = socket;

    // Named handlers for proper cleanup with socket.off()
    function onEvent(data: JarvisEvent) {
      addEvent(data);
    }

    function onAlert(data: JarvisEvent) {
      addEvent(data);
    }

    function onConnectError(err: Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('token') || msg.includes('expired') || msg.includes('unauthorized')) {
        logout();
      }
    }

    socket.on('event', onEvent);
    socket.on('alert', onAlert);
    socket.on('connect_error', onConnectError);

    socket.connect();

    return () => {
      socket.off('event', onEvent);
      socket.off('alert', onAlert);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, logout, addEvent]);
}

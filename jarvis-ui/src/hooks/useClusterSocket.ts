import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { createClusterSocket } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useClusterStore } from '../stores/cluster';
import type { NodeData, VMData, StorageData, QuorumData } from '../types/cluster';

/**
 * Hook that manages the Socket.IO /cluster namespace connection.
 * Connects when authenticated, pushes data into the cluster Zustand store.
 * Call once at the app level (e.g., in App.tsx).
 */
export function useClusterSocket(): void {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const socketRef = useRef<Socket | null>(null);

  const setNodes = useClusterStore((s) => s.setNodes);
  const setVMs = useClusterStore((s) => s.setVMs);
  const setStorage = useClusterStore((s) => s.setStorage);
  const setQuorum = useClusterStore((s) => s.setQuorum);
  const setConnected = useClusterStore((s) => s.setConnected);

  useEffect(() => {
    if (!token) return;

    const socket = createClusterSocket(token);
    socketRef.current = socket;

    // Named handlers for proper cleanup with socket.off()
    function onConnect() {
      setConnected(true);
    }

    function onDisconnect() {
      setConnected(false);
    }

    function onNodes(data: NodeData[]) {
      setNodes(data);
    }

    function onVMs(data: VMData[]) {
      setVMs(data);
    }

    function onStorage(data: StorageData[]) {
      setStorage(data);
    }

    function onQuorum(data: QuorumData) {
      setQuorum(data);
    }

    function onConnectError(err: Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('token') || msg.includes('expired') || msg.includes('unauthorized')) {
        logout();
      }
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('nodes', onNodes);
    socket.on('vms', onVMs);
    socket.on('storage', onStorage);
    socket.on('quorum', onQuorum);
    socket.on('connect_error', onConnectError);

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('nodes', onNodes);
      socket.off('vms', onVMs);
      socket.off('storage', onStorage);
      socket.off('quorum', onQuorum);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, logout, setNodes, setVMs, setStorage, setQuorum, setConnected]);
}

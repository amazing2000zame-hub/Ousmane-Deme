import { io, type Socket } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://192.168.1.50:4000';

/** Create a Socket.IO client for the /cluster namespace */
export function createClusterSocket(token: string): Socket {
  return io(`${BACKEND_URL}/cluster`, {
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });
}

/** Create a Socket.IO client for the /events namespace */
export function createEventsSocket(token: string): Socket {
  return io(`${BACKEND_URL}/events`, {
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });
}

/** Create a Socket.IO client for the /terminal namespace */
export function createTerminalSocket(token: string): Socket {
  return io(`${BACKEND_URL}/terminal`, {
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });
}

import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyJWT } from '../auth/jwt.js';
import { config } from '../config.js';

/**
 * Set up Socket.IO with /cluster, /events, and /terminal namespaces.
 * All namespaces require JWT authentication via handshake.auth.token.
 */
export function setupSocketIO(server: HttpServer) {
  const io = new SocketServer(server, {
    cors: {
      origin: config.corsOrigins,
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 10000,
  });

  // Create namespaces
  const clusterNs = io.of('/cluster');
  const eventsNs = io.of('/events');
  const terminalNs = io.of('/terminal');
  const chatNs = io.of('/chat');

  // JWT auth middleware for namespaces
  const socketAuthMiddleware = (
    socket: { handshake: { auth: { token?: string } }; disconnect: () => void },
    next: (err?: Error) => void
  ) => {
    const token = socket.handshake.auth.token;
    if (!token || typeof token !== 'string') {
      next(new Error('Authentication required'));
      return;
    }

    const payload = verifyJWT(token);
    if (!payload) {
      next(new Error('Invalid or expired token'));
      return;
    }

    next();
  };

  clusterNs.use(socketAuthMiddleware);
  eventsNs.use(socketAuthMiddleware);
  terminalNs.use(socketAuthMiddleware);
  chatNs.use(socketAuthMiddleware);

  // Connection logging
  clusterNs.on('connection', (socket) => {
    console.log(`[Socket.IO] /cluster client connected: ${socket.id}`);
    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] /cluster client disconnected: ${socket.id} (${reason})`);
    });
  });

  eventsNs.on('connection', (socket) => {
    console.log(`[Socket.IO] /events client connected: ${socket.id}`);
    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] /events client disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log('[Socket.IO] WebSocket server initialized with /cluster, /events, /terminal, and /chat namespaces');

  return { io, clusterNs, eventsNs, terminalNs, chatNs };
}

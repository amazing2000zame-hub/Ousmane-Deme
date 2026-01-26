import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { config } from './config.js';
import { router } from './api/routes.js';
import { setupSocketIO } from './realtime/socket.js';
import { runMigrations } from './db/migrate.js';
import { getToolList } from './mcp/server.js';
import { closeAllConnections } from './clients/ssh.js';
import { startEmitter, stopEmitter } from './realtime/emitter.js';
import { setupTerminalHandlers } from './realtime/terminal.js';
import { setupChatHandlers } from './realtime/chat.js';

// Create Express app and HTTP server
const app = express();
const server = createServer(app);

// CORS configuration
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));

// Body parsing
app.use(express.json());

// Mount routes
app.use(router);

// Set up Socket.IO on the HTTP server
const { io, clusterNs, eventsNs, terminalNs, chatNs } = setupSocketIO(server);

// Export for use by other modules (e.g., emitting events)
export { io, clusterNs, eventsNs, terminalNs, chatNs };

// Run database migrations, then start listening
try {
  await runMigrations();
} catch (err) {
  console.error('Failed to run database migrations:', err);
  console.warn('Starting server without database -- persistence will be unavailable');
}

// Initialize MCP tool server
const tools = getToolList();
console.log(`MCP server initialized: ${tools.length} tools registered`);
for (const t of tools) {
  console.log(`  [${t.tier.toUpperCase().padEnd(6)}] ${t.name}`);
}

// Start real-time data emitter (polls Proxmox and pushes to /cluster namespace)
startEmitter(clusterNs);

// Register SSH PTY terminal handlers on the /terminal namespace
setupTerminalHandlers(terminalNs);

// Register AI chat handlers on the /chat namespace
setupChatHandlers(chatNs);
console.log('[Chat] AI chat handler initialized on /chat namespace');

// Start listening -- IMPORTANT: listen on `server`, not `app` (Socket.IO requirement)
server.listen(config.port, () => {
  console.log(`Jarvis backend running on port ${config.port}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`  Health check: http://localhost:${config.port}/api/health`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  stopEmitter();
  closeAllConnections();
  io.close();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

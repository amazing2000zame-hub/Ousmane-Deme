import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { config } from './config.js';
import { router } from './api/routes.js';
import { setupSocketIO } from './realtime/socket.js';
import { runMigrations } from './db/migrate.js';

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
const { io, clusterNs, eventsNs } = setupSocketIO(server);

// Export for use by other modules (e.g., emitting events)
export { io, clusterNs, eventsNs };

// Run database migrations, then start listening
try {
  await runMigrations();
} catch (err) {
  console.error('Failed to run database migrations:', err);
  console.warn('Starting server without database -- persistence will be unavailable');
}

// Start listening -- IMPORTANT: listen on `server`, not `app` (Socket.IO requirement)
server.listen(config.port, () => {
  console.log(`Jarvis backend running on port ${config.port}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`  Health check: http://localhost:${config.port}/api/health`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
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

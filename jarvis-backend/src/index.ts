import crypto from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { config } from './config.js';
import { router, setupMonitorRoutes } from './api/routes.js';
import { setupSocketIO } from './realtime/socket.js';
import { runMigrations } from './db/migrate.js';
import { getToolList } from './mcp/server.js';
import { closeAllConnections } from './clients/ssh.js';
import { startEmitter, stopEmitter } from './realtime/emitter.js';
import { startMonitor, stopMonitor } from './monitor/index.js';
import { setupTerminalHandlers } from './realtime/terminal.js';
import { setupChatHandlers } from './realtime/chat.js';
import { setupVoiceHandlers } from './realtime/voice.js';
import { costRouter } from './api/cost.js';
import { memoryRouter } from './api/memory.js';
import { ttsRouter } from './api/tts.js';
import { prewarmTtsCache } from './ai/tts.js';
import { authMiddleware } from './auth/jwt.js';
import { memoryStore } from './db/memory.js';
import { startMemoryCleanup, stopMemoryCleanup } from './services/memory-cleanup.js';
import { startAlertMonitor, stopAlertMonitor } from './services/alert-monitor.js';
import { startMqttAlertService, stopMqttAlertService, isMqttConnected } from './services/mqtt-alert-service.js';

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
app.use('/api/cost', authMiddleware, costRouter);
app.use('/api/memory', authMiddleware, memoryRouter);
app.use('/api/tts', authMiddleware, ttsRouter);

// Set up Socket.IO on the HTTP server
const { io, clusterNs, eventsNs, terminalNs, chatNs, voiceNs } = setupSocketIO(server);

// Export for use by other modules (e.g., emitting events)
export { io, clusterNs, eventsNs, terminalNs, chatNs, voiceNs };

// Run database migrations, then start listening
try {
  await runMigrations();
} catch (err) {
  console.error('Failed to run database migrations:', err);
  console.warn('Starting server without database -- persistence will be unavailable');
}

// Start memory cleanup service (hourly TTL expiration)
startMemoryCleanup();

// Initialize MCP tool server
const tools = getToolList();
console.log(`MCP server initialized: ${tools.length} tools registered`);
for (const t of tools) {
  console.log(`  [${t.tier.toUpperCase().padEnd(6)}] ${t.name}`);
}

// Start real-time data emitter (polls Proxmox and pushes to /cluster namespace)
startEmitter(clusterNs);

// Wire monitor REST API routes (dependency injection: eventsNs passed as parameter)
setupMonitorRoutes(router, eventsNs);

// Start autonomous monitoring service (detects state changes and threshold violations)
startMonitor(eventsNs);

// Register SSH PTY terminal handlers on the /terminal namespace
setupTerminalHandlers(terminalNs);

// Register AI chat handlers on the /chat namespace
setupChatHandlers(chatNs, eventsNs);
console.log('[Chat] AI chat handler initialized on /chat namespace');

// Register server-side voice handlers on the /voice namespace
setupVoiceHandlers(voiceNs, eventsNs);
console.log('[Voice] Server-side voice handler initialized on /voice namespace');

// Start proactive alert monitoring (Phase 33: MQTT preferred, REST fallback)
const mqttConnected = await startMqttAlertService(eventsNs);
if (mqttConnected) {
  console.log('[Alert] Using MQTT for real-time alerts (<100ms latency)');
} else {
  startAlertMonitor(eventsNs);
  console.log('[Alert] Using REST polling fallback (5s latency)');
}

// Start listening -- IMPORTANT: listen on `server`, not `app` (Socket.IO requirement)
server.listen(config.port, () => {
  console.log(`Jarvis backend running on port ${config.port}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`  Health check: http://localhost:${config.port}/api/health`);

  // Emit JARVIS Online startup event
  const startupEvent = {
    id: crypto.randomUUID(),
    type: 'status' as const,
    severity: 'info' as const,
    title: 'JARVIS Online',
    message: 'Backend services initialized -- monitoring active',
    source: 'system' as const,
    timestamp: new Date().toISOString(),
  };
  eventsNs.emit('event', startupEvent);
  memoryStore.saveEvent({
    type: 'status',
    severity: 'info',
    source: 'system',
    summary: '[System] JARVIS Online: Backend services initialized -- monitoring active',
  });
  console.log('[System] JARVIS Online event emitted');

  // Phase 23: Pre-warm TTS disk cache after startup settles
  setTimeout(() => {
    prewarmTtsCache().catch((err) => {
      console.warn(`[TTS Cache] Pre-warm error: ${err}`);
    });
  }, 10_000); // 10s delay to let XTTS container stabilize
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  stopMemoryCleanup();
  stopMqttAlertService();
  stopAlertMonitor();
  stopMonitor();
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

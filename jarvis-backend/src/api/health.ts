import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkTTSHealth } from '../ai/tts.js';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let version = '1.0.0';
try {
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
  version = pkg.version;
} catch {
  // Fall back to default version
}

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  // Liveness check for Docker healthcheck compatibility
  if (req.query.liveness !== undefined) {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), version });
    return;
  }

  // Component-level health check
  const [ttsResult, llmResult, dbResult, proxmoxResult] = await Promise.allSettled([
    // TTS check
    (async () => {
      const health = await checkTTSHealth();
      return { status: health.healthy ? 'up' : 'down', responseMs: health.responseMs, engine: 'xtts', endpoint: health.endpoint };
    })(),
    // LLM check
    (async () => {
      const start = Date.now();
      try {
        const res = await fetch(`${config.localLlmEndpoint}/health`, { signal: AbortSignal.timeout(3000) });
        const responseMs = Date.now() - start;
        return { status: res.ok ? 'up' : 'down', responseMs, model: config.localLlmModel };
      } catch {
        return { status: 'down' as const, responseMs: Date.now() - start, model: config.localLlmModel };
      }
    })(),
    // Database check
    (async () => {
      const start = Date.now();
      try {
        sqlite.prepare('SELECT 1').get();
        return { status: 'up' as const, responseMs: Date.now() - start };
      } catch {
        return { status: 'down' as const, responseMs: Date.now() - start };
      }
    })(),
    // Proxmox API check
    (async () => {
      const start = Date.now();
      try {
        const node = config.clusterNodes[0];
        const res = await fetch(`https://${node.host}:8006/api2/json/version`, {
          signal: AbortSignal.timeout(3000),
          headers: { Authorization: `PVEAPIToken=${config.pveTokenId}=${config.pveTokenSecret}` },
        });
        const responseMs = Date.now() - start;
        let pveVersion: string | undefined;
        if (res.ok) {
          try {
            const data = await res.json() as { data?: { version?: string } };
            pveVersion = data.data?.version;
          } catch {}
        }
        return { status: res.ok ? 'up' : 'down', responseMs, ...(pveVersion ? { version: pveVersion } : {}) };
      } catch {
        return { status: 'down' as const, responseMs: Date.now() - start };
      }
    })(),
  ]);

  const components = {
    tts: ttsResult.status === 'fulfilled' ? ttsResult.value : { status: 'down', responseMs: 0 },
    llm: llmResult.status === 'fulfilled' ? llmResult.value : { status: 'down', responseMs: 0 },
    database: dbResult.status === 'fulfilled' ? dbResult.value : { status: 'down', responseMs: 0 },
    proxmox: proxmoxResult.status === 'fulfilled' ? proxmoxResult.value : { status: 'down', responseMs: 0 },
  };

  const allUp = Object.values(components).every((c) => c.status === 'up');

  res.status(allUp ? 200 : 503).json({
    status: allUp ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version,
    components,
  });
});

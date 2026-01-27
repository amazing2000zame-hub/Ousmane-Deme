# Phase 21: Quick Wins & Measurement Baseline - Research

**Researched:** 2026-01-27
**Domain:** SQLite performance tuning, TTS reliability, Express health endpoints, Docker container health management
**Confidence:** HIGH

## Summary

Phase 21 covers four independent improvements to the Jarvis backend: SQLite performance PRAGMAs (BACK-01), TTS cache expansion with engine-specific keys (PERF-01), sentence detection minimum length reduction with TTS health check auto-restart (PERF-04), and an expanded component-level health endpoint (OBS-02). All four requirements involve modifying existing backend files with zero new npm dependencies.

The codebase is well-structured for these changes. SQLite setup is centralized in `db/index.ts`. TTS cache is an in-memory Map-based LRU in `ai/tts.ts`. Sentence detection uses a static `MIN_SENTENCE_LEN` in `ai/sentence-stream.ts`. The health endpoint is a simple Express router in `api/health.ts`. The Docker Compose file already has healthchecks defined for the TTS container.

**Primary recommendation:** Implement all four requirements as isolated, non-overlapping changes to existing files. The TTS auto-restart requires mounting the Docker socket into the backend container and using Node.js built-in `http` module with `socketPath` to call the Docker Engine API -- no new npm dependency needed.

## Standard Stack

### Core (Already in Use -- No New Dependencies)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| better-sqlite3 | ^12.6.2 | SQLite database driver | Already installed; `.pragma()` API for PRAGMA statements |
| Express 5 | ^5.2.1 | HTTP framework | Already installed; health endpoint router |
| Node.js built-in `http` | 22.x | Docker socket communication | Built-in; `http.request` supports `socketPath` option |
| Node.js built-in `crypto` | 22.x | Cache key hashing | Already used in codebase |

### Supporting (Already in Use)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm | ^0.45.1 | ORM over better-sqlite3 | Already used for all DB operations |
| socket.io | ^4.8.3 | Real-time events | Already used for health event broadcasting |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node.js `http` for Docker API | `dockerode` npm package | Would add a new dependency; constraint says zero new backend deps |
| In-memory LRU cache (Map) | `lru-cache` npm package | Would add dependency; hand-rolled Map LRU is sufficient for 200 entries |
| willfarrell/autoheal sidecar | Node.js Docker API restart | Autoheal adds a container; backend-triggered restart gives more control and logging |

**Installation:** No new packages needed. Zero `npm install` commands.

## Architecture Patterns

### Recommended File Change Map
```
jarvis-backend/src/
├── db/
│   └── index.ts            # BACK-01: Add 4 PRAGMAs after WAL
├── ai/
│   ├── tts.ts              # PERF-01: Expand cache to 200+, engine-specific keys
│   │                       # PERF-04: Export health check, add restart logic
│   └── sentence-stream.ts  # PERF-04: Reduce MIN_SENTENCE_LEN from 20 to ~4
├── api/
│   └── health.ts           # OBS-02: Expand to component-level status
docker-compose.yml           # PERF-04: Mount Docker socket into backend container
```

### Pattern 1: SQLite PRAGMA Application Order
**What:** PRAGMAs must be set in specific order after database open, before any queries.
**When to use:** At database initialization in `db/index.ts`.
**Critical ordering:** `journal_mode = WAL` MUST come before `synchronous = NORMAL` because SQLite may auto-adjust synchronous when switching journal modes.

```typescript
// Source: SQLite official documentation + better-sqlite3 API
// db/index.ts -- after Database() constructor, before drizzle()

const sqlite = new Database(config.dbPath);

// PRAGMA order matters: WAL first, then synchronous
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');       // Safe in WAL mode, skips fsync on most writes
sqlite.pragma('cache_size = -64000');        // 64 MB page cache (negative = KiB)
sqlite.pragma('temp_store = MEMORY');        // Temp tables/indices in RAM
sqlite.pragma('mmap_size = 268435456');      // 256 MB memory-mapped I/O
```

### Pattern 2: Component Health Check with Promise.allSettled
**What:** Check all backend dependencies in parallel, report individual status regardless of failures.
**When to use:** Expanded `/api/health` endpoint.

```typescript
// Source: MDN Promise.allSettled + Express health check best practices
interface ComponentStatus {
  status: 'up' | 'down';
  responseMs: number;
  details?: Record<string, unknown>;
}

async function checkComponent(name: string, fn: () => Promise<unknown>): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    const result = await fn();
    return { status: 'up', responseMs: Date.now() - start, details: result };
  } catch {
    return { status: 'down', responseMs: Date.now() - start };
  }
}

// In health route handler:
const results = await Promise.allSettled([
  checkComponent('tts', checkTTS),
  checkComponent('llm', checkLLM),
  checkComponent('database', checkDB),
  checkComponent('proxmox', checkPVE),
]);
```

### Pattern 3: Engine-Specific TTS Cache Keys
**What:** Prefix cache keys with engine identifier so XTTS and future Piper entries never collide.
**When to use:** TTS cache in `ai/tts.ts`.

```typescript
// Current key: just normalized text
function cacheKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// New key: engine prefix + normalized text
function cacheKey(text: string, engine: string = 'xtts'): string {
  return `${engine}:${text.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}
```

### Pattern 4: Docker Socket API for Container Restart
**What:** Use Node.js built-in `http.request` with `socketPath` to call Docker Engine API.
**When to use:** When TTS health check detects unresponsive container.

```typescript
// Source: Docker Engine API docs + Node.js http module
import http from 'node:http';

function restartContainer(containerName: string, timeoutSec = 10): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path: `/v1.45/containers/${containerName}/restart?t=${timeoutSec}`,
      method: 'POST',
    }, (res) => {
      resolve(res.statusCode === 204);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(30_000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}
```

### Anti-Patterns to Avoid
- **Setting synchronous=OFF in production:** Risks database corruption. Use NORMAL, not OFF.
- **Using Promise.all for health checks:** One failing component would mask all others. Use Promise.allSettled.
- **Cache keys without engine prefix:** When Piper is added in Phase 22, same text would return XTTS audio for Piper requests.
- **Using `fetch()` for Docker socket:** Node.js built-in `fetch()` does NOT support Unix domain sockets. Must use `http.request` with `socketPath`.
- **Mounting Docker socket without awareness:** This grants root-equivalent access. The backend container already runs with `apparmor:unconfined`, so the security posture is already relaxed -- but document the decision.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Docker container restart | Shell exec (`child_process.exec('docker restart ...')`) | `http.request` with Docker socket API | Shell exec requires docker CLI in container image; socket API is cleaner, zero deps |
| LRU cache eviction | Custom doubly-linked list | Map insertion-order + delete/re-insert pattern | JavaScript Map preserves insertion order; the existing pattern in tts.ts is correct |
| Health check timeout | Manual setTimeout races | `AbortSignal.timeout(ms)` on fetch calls | Node.js 22 supports AbortSignal.timeout natively; cleaner than Promise.race with setTimeout |
| PRAGMA verification | Custom query to check each PRAGMA | `sqlite.pragma('name', { simple: true })` return value | better-sqlite3's `.pragma()` returns the result directly |

**Key insight:** All four requirements are configuration/tuning changes to existing code. No new architectural patterns or libraries are needed. The biggest complexity is the Docker socket integration for TTS auto-restart, which is a ~30-line utility function.

## Common Pitfalls

### Pitfall 1: PRAGMA Order Dependency
**What goes wrong:** Setting `synchronous = NORMAL` before `journal_mode = WAL` may have no effect because SQLite uses `SQLITE_DEFAULT_WAL_SYNCHRONOUS` when switching to WAL mode, potentially overriding a previously-set synchronous value.
**Why it happens:** SQLite compile-time defaults interact with runtime PRAGMAs in non-obvious ways.
**How to avoid:** Always set `journal_mode = WAL` first, then `synchronous = NORMAL`.
**Warning signs:** `PRAGMA synchronous` returns `2` (FULL) even after setting to NORMAL.

### Pitfall 2: Docker Socket Not Mounted
**What goes wrong:** Backend container tries to call Docker API but socket file doesn't exist inside container.
**Why it happens:** Docker socket must be explicitly bind-mounted in docker-compose.yml.
**How to avoid:** Add `/var/run/docker.sock:/var/run/docker.sock` to volumes in jarvis-backend service.
**Warning signs:** `ENOENT: no such file or directory` when calling `http.request` with socketPath.

### Pitfall 3: Docker Does NOT Auto-Restart Unhealthy Containers
**What goes wrong:** Assuming `restart: unless-stopped` + `healthcheck` in docker-compose.yml will auto-restart an unhealthy TTS container.
**Why it happens:** Docker healthcheck marks container as unhealthy but does NOT trigger restart. The restart policy only triggers when the container's PID 1 exits. An unhealthy container stays running.
**How to avoid:** Implement application-level restart via Docker API from the backend, or use a sidecar like `willfarrell/autoheal`. The application-level approach is preferred here (zero new containers, more control, logging).
**Warning signs:** TTS container shows `unhealthy` in `docker ps` but keeps running indefinitely.

### Pitfall 4: Cache Size Units Confusion
**What goes wrong:** Setting `cache_size = 64000` (positive) allocates 64000 pages (about 256 MB with default 4KB pages), not 64 MB.
**Why it happens:** Positive values are in pages, negative values are in KiB.
**How to avoid:** Use `cache_size = -64000` (negative = KiB, so -64000 = ~64 MB).
**Warning signs:** Unexpectedly high memory usage from SQLite.

### Pitfall 5: Sentence Length Threshold Too Low
**What goes wrong:** Reducing `MIN_SENTENCE_LEN` to 1 causes abbreviations like "Dr." and "U.S." to trigger false sentence boundaries.
**Why it happens:** The sentence detector splits on `.` followed by whitespace. "Dr. Smith" would be split into "Dr" and "Smith" if MIN_SENTENCE_LEN is 1.
**How to avoid:** Reduce to ~4 characters (covers "Yes.", "No.", "Done.", "Sure.") but not lower. The flush() method in SentenceAccumulator already handles end-of-stream fragments of any length.
**Warning signs:** Sentence boundaries detected in the middle of abbreviations.

### Pitfall 6: Health Check Blocks Main Thread
**What goes wrong:** Component health checks taking too long block the Express event loop.
**Why it happens:** Database PRAGMA check is synchronous (better-sqlite3 is synchronous by design). Network checks to TTS/LLM/Proxmox can hang.
**How to avoid:** Use `AbortSignal.timeout()` on all network checks (2-3 second max). For the database check, `sqlite.pragma('integrity_check', { simple: true })` is fast but can be slow on large databases -- instead just do a simple SELECT query with a timeout wrapper. The DB check should be a quick `SELECT 1` or similar.
**Warning signs:** Health endpoint response times > 5 seconds.

### Pitfall 7: TTS Restart Loop
**What goes wrong:** Backend repeatedly restarts TTS container if the underlying issue is not transient.
**Why it happens:** No cooldown between restart attempts.
**How to avoid:** Implement a restart cooldown (e.g., max 1 restart per 5 minutes). Track last restart timestamp and refuse to restart again until cooldown expires.
**Warning signs:** TTS container restart events in rapid succession in logs.

## Code Examples

### BACK-01: SQLite Performance PRAGMAs
```typescript
// File: jarvis-backend/src/db/index.ts
// Source: SQLite official docs (sqlite.org/pragma.html)

import Database, { type Database as DatabaseType } from 'better-sqlite3';

const sqlite: DatabaseType = new Database(config.dbPath);

// Performance PRAGMAs -- order matters!
sqlite.pragma('journal_mode = WAL');          // Already exists in codebase
sqlite.pragma('synchronous = NORMAL');        // NEW: Safe in WAL, skip fsync on most writes
sqlite.pragma('cache_size = -64000');         // NEW: 64 MB page cache
sqlite.pragma('temp_store = MEMORY');         // NEW: Temp tables in RAM
sqlite.pragma('mmap_size = 268435456');       // NEW: 256 MB memory-mapped I/O
```

### PERF-01: Expanded Engine-Specific Cache
```typescript
// File: jarvis-backend/src/ai/tts.ts
// Modifications to existing cache implementation

const SENTENCE_CACHE_MAX = 200;  // Changed from 50

function cacheKey(text: string, engine: string = 'xtts'): string {
  return `${engine}:${text.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

// All calls to cacheKey() must pass engine parameter:
// cacheGet(text, 'xtts') and cachePut(text, audio, 'xtts')
```

### PERF-04: Reduced Sentence Length
```typescript
// File: jarvis-backend/src/ai/sentence-stream.ts
// Change MIN_SENTENCE_LEN from 20 to 4

private static readonly MIN_SENTENCE_LEN = 4;
// This allows "Yes." (4 chars), "No." (3 chars via flush), "Done." (5 chars)
// Still blocks "Dr." (3 chars) from being a false sentence boundary
// Note: text shorter than 4 chars is still spoken via flush() at end-of-stream
```

### PERF-04: TTS Health Check with Auto-Restart
```typescript
// File: jarvis-backend/src/ai/tts.ts (new exported function)
// Uses Node.js built-in http module -- zero new dependencies

import http from 'node:http';

const TTS_CONTAINER_NAME = 'jarvis-tts';
const RESTART_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
let lastRestartAttempt = 0;

async function restartTTSContainer(): Promise<boolean> {
  const now = Date.now();
  if (now - lastRestartAttempt < RESTART_COOLDOWN_MS) {
    console.warn('[TTS] Restart cooldown active, skipping');
    return false;
  }
  lastRestartAttempt = now;

  return new Promise((resolve) => {
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path: `/v1.45/containers/${TTS_CONTAINER_NAME}/restart?t=10`,
      method: 'POST',
    }, (res) => {
      const success = res.statusCode === 204;
      console.log(`[TTS] Container restart ${success ? 'succeeded' : 'failed'}: HTTP ${res.statusCode}`);
      resolve(success);
    });
    req.on('error', (err) => {
      console.error(`[TTS] Container restart error: ${err.message}`);
      resolve(false);
    });
    req.setTimeout(30_000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}
```

### OBS-02: Expanded Health Endpoint
```typescript
// File: jarvis-backend/src/api/health.ts
// Replace simple liveness with component-level readiness check

healthRouter.get('/', async (_req, res) => {
  const checks = await Promise.allSettled([
    checkTTS(),
    checkLLM(),
    checkDatabase(),
    checkProxmox(),
  ]);

  const components = {
    tts:      mapResult(checks[0]),
    llm:      mapResult(checks[1]),
    database: mapResult(checks[2]),
    proxmox:  mapResult(checks[3]),
  };

  const allUp = Object.values(components).every(c => c.status === 'up');

  res.status(allUp ? 200 : 503).json({
    status: allUp ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version,
    components,
  });
});
```

### Docker Compose: Mount Docker Socket
```yaml
# File: docker-compose.yml -- jarvis-backend service
services:
  jarvis-backend:
    volumes:
      - jarvis-data:/data
      - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro
      - /root/.ssh/known_hosts:/app/.ssh/known_hosts:ro
      - /var/run/docker.sock:/var/run/docker.sock  # NEW: For TTS auto-restart
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SQLite default sync (FULL) | synchronous=NORMAL in WAL mode | Well-established SQLite recommendation | Fewer fsyncs, faster writes, no corruption risk in WAL mode |
| Simple liveness health check | Component-level readiness probe | Industry standard since Kubernetes adoption | Enables per-component monitoring and alerting |
| Docker autoheal sidecar | Application-level Docker API restart | Available since Docker Engine API v1.17 | No extra container, better control, logging integration |
| Fixed cache size (50 entries) | Expanded cache (200+ entries) | Performance tuning | More cache hits for repeated JARVIS phrases |

**Deprecated/outdated:**
- `synchronous=OFF`: Sometimes seen in benchmarks but unsafe for production data. NORMAL is the correct production setting for WAL mode.
- `docker-autoheal` sidecar: Still works but adds complexity. Application-level restart via Docker API is simpler for single-container recovery.

## Open Questions

1. **PRAGMA mmap_size value for Docker container**
   - What we know: 256 MB mmap is standard recommendation. The database is small (Jarvis chat history + events).
   - What's unclear: Whether the Docker container's memory limit (16G for TTS, not specified for backend) affects mmap behavior.
   - Recommendation: 256 MB is safe; it only reserves virtual address space, not physical RAM. Use as specified.

2. **Health endpoint authentication**
   - What we know: Current `/api/health` is public (no auth required, mounted before auth middleware in routes.ts). Docker Compose healthcheck calls it without auth tokens.
   - What's unclear: Whether the expanded health endpoint with component details should remain public.
   - Recommendation: Keep public. Component status (up/down + response times) is not sensitive. Docker healthcheck and external monitors need unauthenticated access. The detailed component info helps debugging.

3. **Proxmox API check reliability**
   - What we know: Proxmox API is at `https://192.168.1.50:8006` with self-signed cert (`NODE_TLS_REJECT_UNAUTHORIZED=0` is set).
   - What's unclear: Whether the PVE API token is always valid and what the typical response time is.
   - Recommendation: Use a simple GET to `/api2/json/version` with a 3-second timeout. Handle auth failures as "down" status gracefully.

## Sources

### Primary (HIGH confidence)
- [SQLite PRAGMA documentation](https://www.sqlite.org/pragma.html) -- authoritative source for all PRAGMA semantics
- [SQLite WAL documentation](https://sqlite.org/wal.html) -- WAL mode behavior and synchronous interaction
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- `.pragma()` method usage
- [Docker Engine API docs](https://docs.docker.com/reference/api/engine/) -- container restart endpoint
- [MDN Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled) -- Promise.allSettled semantics
- Codebase direct inspection: `db/index.ts`, `ai/tts.ts`, `api/health.ts`, `ai/sentence-stream.ts`, `realtime/chat.ts`, `config.ts`, `docker-compose.yml`, TTS server at `/opt/jarvis-tts/app/server.py`

### Secondary (MEDIUM confidence)
- [SQLite performance tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) -- widely-cited reference for recommended PRAGMAs
- [SQLite recommended PRAGMAs (highperformancesqlite.com)](https://highperformancesqlite.com/articles/sqlite-recommended-pragmas) -- confirms PRAGMA set
- [Docker Compose healthcheck blog (justanotheruptime.com)](https://blog.justanotheruptime.com/posts/2025_07_07_docker_compose_restart_policies_and_healthchecks/) -- confirms Docker does NOT auto-restart unhealthy containers
- [Node.js net module](https://nodejs.org/api/net.html) -- socketPath support documentation
- Docker version on Home node: 26.1.5 (API v1.45) -- verified via `docker version`

### Tertiary (LOW confidence)
- [Dev.to better-sqlite3 PRAGMA benchmarks (Nov 2025)](https://dev.to/lovestaco/scaling-sqlite-with-node-worker-threads-and-better-sqlite3-4189) -- benchmark results for PRAGMA tuning
- [willfarrell/docker-autoheal GitHub](https://github.com/willfarrell/docker-autoheal) -- alternative auto-restart approach (not recommended for this use case)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies, APIs verified against official docs
- Architecture (PRAGMAs): HIGH -- SQLite official documentation is definitive; PRAGMA semantics are well-documented
- Architecture (Health endpoint): HIGH -- Promise.allSettled is a standard JS API; component health pattern is well-established
- Architecture (TTS restart): HIGH -- Docker Engine API is stable; Node.js `http.request` socketPath is documented built-in feature
- Architecture (Cache expansion): HIGH -- Simple constant change + cache key prefix; verified existing Map-based LRU pattern
- Pitfalls: HIGH -- PRAGMA ordering, Docker restart behavior, sentence threshold limits all verified with authoritative sources

**Research date:** 2026-01-27
**Valid until:** 2026-03-27 (stable domain; SQLite PRAGMAs, Docker API, and JS Promise.allSettled are mature, unlikely to change)

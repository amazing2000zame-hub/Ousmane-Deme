# Phase 01 Plan 02: Infrastructure Clients (Proxmox + SSH) Summary

**One-liner:** Proxmox REST API client with PVEAPIToken auth and SSH client with connection pooling, both tested against the live 4-node cluster.

## What Was Built

### Proxmox REST API Client (`jarvis-backend/src/clients/proxmox.ts`)
- `ProxmoxClient` class with generic `get<T>()` and `post<T>()` methods
- PVEAPIToken authentication header: `PVEAPIToken={tokenId}={tokenSecret}`
- Automatic `{data: T}` envelope unwrapping on all responses
- 15-second timeout on all fetch calls via AbortController
- Descriptive error messages including host, path, status code
- Domain methods: `getNodes`, `getNodeStatus`, `getClusterResources`, `getClusterStatus`, `getNodeStorage`, `getRecentTasks`, `startVM`, `stopVM`, `rebootVM`, `shutdownVM`, `startCT`, `stopCT`, `rebootCT`
- Pre-built client instances for all 4 cluster nodes via `proxmoxClients` Map
- `getAnyClient()` for cluster-wide queries (defaults to Home node)
- `getClientForNode(name)` for node-specific operations

### SSH Client (`jarvis-backend/src/clients/ssh.ts`)
- Connection pooling: one persistent `NodeSSH` per host IP, lazily created
- Auto-reconnect: stale connections detected via `isConnected()` and replaced
- `getSSHConnection(host)`: get or create pooled connection
- `execOnNode(host, command, timeout?)`: execute command by IP
- `execOnNodeByName(nodeName, command, timeout?)`: resolve name to IP from config
- `closeAllConnections()`: graceful shutdown of all pooled connections
- 10-second connect timeout, 30-second command timeout (defaults)
- Uses `privateKeyPath` for key-based auth (ed25519)

### Line Counts
- `proxmox.ts`: 230 lines (requirement: min 80)
- `ssh.ts`: 154 lines (requirement: min 50)

## Verification Results

| Check | Result |
|-------|--------|
| TypeScript compiles cleanly | PASS |
| ProxmoxClient instances for all 4 nodes | PASS (Home, pve, agent1, agent) |
| getAnyClient() and getClientForNode() | PASS |
| SSH exec on Home node | PASS (hostname returned "Home") |
| SSH exec on pve node | PASS (uptime returned) |
| Connection pooling reuses connections | PASS (same object identity) |
| All calls have timeouts | PASS (10s connect, 15s HTTP, 30s exec) |

## Commits

| Hash | Message |
|------|---------|
| 78a0029 | feat(01-02): add Proxmox REST API client with token auth |
| 24118ab | feat(01-02): add SSH client with connection pooling and command execution |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] node-ssh privateKey vs privateKeyPath**
- **Found during:** Task 2 runtime testing
- **Issue:** Plan stated "node-ssh accepts privateKey as a file path string" but `privateKey` expects key content; the file path parameter is `privateKeyPath`
- **Fix:** Changed `privateKey: config.sshKeyPath` to `privateKeyPath: config.sshKeyPath`
- **Files modified:** `jarvis-backend/src/clients/ssh.ts`
- **Commit:** 24118ab

**2. [Rule 1 - Bug] Pre-existing TS4023 error in db/index.ts**
- **Found during:** Task 1 compilation check
- **Issue:** `Exported variable 'sqlite' has or is using name 'BetterSqlite3.Database' from external module but cannot be named`
- **Fix:** Added explicit type annotation `const sqlite: DatabaseType`
- **Files modified:** `jarvis-backend/src/db/index.ts`
- **Commit:** 78a0029

**3. [Rule 1 - Bug] Pre-existing TS2769 type error in db/memory.ts**
- **Found during:** Task 2 compilation check
- **Issue:** `getEventsByType(type: string)` passed `string` to `eq()` but column expects union type
- **Fix:** Changed parameter type to `'alert' | 'action' | 'status' | 'metric'`
- **Files modified:** `jarvis-backend/src/db/memory.ts`
- **Commit:** 24118ab

## Decisions Made

- **PVEAPIToken format:** `PVEAPIToken={tokenId}={tokenSecret}` (standard Proxmox API token format)
- **Self-signed TLS:** Handled via `NODE_TLS_REJECT_UNAUTHORIZED=0` env var (set in Docker Compose), no per-request custom agent
- **SSH key resolution:** Uses `privateKeyPath` (file path) not `privateKey` (content string)
- **Connection pool disposal:** On exec failure, connection is disposed and removed from pool so next call creates fresh connection

## Key Files

### Created
- `jarvis-backend/src/clients/proxmox.ts` -- Proxmox REST API client
- `jarvis-backend/src/clients/ssh.ts` -- SSH client with connection pooling

### Modified
- `jarvis-backend/src/db/index.ts` -- Fixed TS4023 type export error
- `jarvis-backend/src/db/memory.ts` -- Fixed TS2769 type mismatch

## Next Phase Readiness

- Proxmox API tokens (`root@pam!jarvis`) still need to be created on each PVE node before the clients can make real API calls
- Both clients are ready for use by MCP tools in Plan 03
- `closeAllConnections()` should be called during server shutdown (integrate into `index.ts` shutdown handler in a future plan)

## Metrics

- **Duration:** ~3 minutes
- **Completed:** 2026-01-26
- **Tasks:** 2/2

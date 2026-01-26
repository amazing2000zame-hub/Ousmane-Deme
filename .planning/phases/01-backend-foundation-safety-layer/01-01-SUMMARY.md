---
phase: 01-backend-foundation-safety-layer
plan: 01
subsystem: api, infra
tags: [express, socket.io, jwt, typescript, docker, cors, jsonwebtoken, better-sqlite3, drizzle-orm, mcp-sdk]

# Dependency graph
requires:
  - phase: none
    provides: greenfield project start
provides:
  - Express 5 HTTP server on port 4000
  - JWT authentication (login, verify, middleware)
  - Socket.IO WebSocket server with /cluster and /events namespaces
  - Health check endpoint at GET /api/health
  - Docker Compose build pipeline
  - All Phase 1 npm dependencies pre-installed
  - TypeScript build pipeline (ES2022 + NodeNext)
  - Centralized config from environment variables
affects: [01-02, 01-03, 01-04, 02-dashboard]

# Tech tracking
tech-stack:
  added: [express@5, socket.io@4, jsonwebtoken, cors, dotenv, better-sqlite3, drizzle-orm, drizzle-kit, @modelcontextprotocol/sdk, zod, node-ssh, typescript@5.9, tsx]
  patterns: [ESM modules with .js extensions in imports, centralized config object, Express Router composition, Socket.IO namespace separation, JWT Bearer token auth, multi-stage Docker build]

key-files:
  created:
    - jarvis-backend/package.json
    - jarvis-backend/tsconfig.json
    - jarvis-backend/.env.example
    - jarvis-backend/.env
    - jarvis-backend/src/index.ts
    - jarvis-backend/src/config.ts
    - jarvis-backend/src/auth/jwt.ts
    - jarvis-backend/src/api/health.ts
    - jarvis-backend/src/api/routes.ts
    - jarvis-backend/src/realtime/socket.ts
    - jarvis-backend/Dockerfile
    - jarvis-backend/.dockerignore
    - jarvis-backend/.gitignore
    - docker-compose.yml
    - .env
  modified: []

key-decisions:
  - "Used node:22-slim instead of node:22-alpine for Docker (avoids musl/glibc issues with better-sqlite3 native bindings)"
  - "Used prebuild-install for better-sqlite3 in Docker instead of compiling from source (faster builds, no python3/make/g++ needed in builder)"
  - "Express 5 with native async error handling (no need for express-async-errors)"
  - "Socket.IO namespaces (/cluster, /events) for separation of real-time data streams"
  - "JWT 7-day expiry with single operator role (homelab simplicity)"
  - "CORS configured for management VM (192.168.1.65:3004) and localhost dev"

patterns-established:
  - "Config pattern: centralized config.ts exporting typed config object from env vars"
  - "Auth pattern: Bearer token in Authorization header, authMiddleware skips PUBLIC_PATHS"
  - "Route pattern: Router composition in routes.ts, public routes mounted before auth middleware"
  - "Socket auth: JWT verified from socket.handshake.auth.token on namespace middleware"
  - "Import pattern: ESM with .js extensions (e.g., import from './config.js')"
  - "Graceful shutdown: SIGTERM/SIGINT handlers closing io then server with 10s force timeout"

# Metrics
duration: 7min
completed: 2026-01-26
---

# Phase 1 Plan 1: Project Scaffold & Core Server Summary

**Express 5 backend with JWT auth, Socket.IO WebSocket server, health endpoint, and Docker Compose -- all Phase 1 dependencies pre-installed**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-26T07:02:11Z
- **Completed:** 2026-01-26T07:09:10Z
- **Tasks:** 2
- **Files created:** 16

## Accomplishments

- Fully functional Express 5 HTTP server on port 4000 with health endpoint, JWT authentication, and Socket.IO WebSocket support
- All Phase 1 npm dependencies installed upfront (MCP SDK, better-sqlite3, drizzle-orm, node-ssh, zod) so subsequent plans can focus on features
- Docker Compose pipeline builds and runs the backend container with healthcheck, volume mounts for data persistence and SSH keys, and bridge networking
- TypeScript build pipeline configured for ES2022 + NodeNext modules with strict mode

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize jarvis-backend project with all Phase 1 dependencies** - `0b9c1f1` (feat)
2. **Task 2: Create Express 5 server with JWT auth, Socket.IO, health endpoint, and Docker Compose** - `e426bd5` (feat)

## Files Created/Modified

- `jarvis-backend/package.json` - Project manifest with all Phase 1 dependencies (express, socket.io, better-sqlite3, drizzle-orm, MCP SDK, etc.)
- `jarvis-backend/tsconfig.json` - TypeScript config: ES2022 target, NodeNext modules, strict mode
- `jarvis-backend/.env.example` - Template documenting all required environment variables
- `jarvis-backend/.env` - Local development defaults (JWT_SECRET, JARVIS_PASSWORD, etc.)
- `jarvis-backend/src/index.ts` - Entry point: Express app + HTTP server + Socket.IO + graceful shutdown
- `jarvis-backend/src/config.ts` - Centralized config from env vars with cluster node definitions
- `jarvis-backend/src/auth/jwt.ts` - JWT sign/verify/middleware/login handler (7-day tokens, operator role)
- `jarvis-backend/src/api/health.ts` - GET /api/health returning status, timestamp, uptime, version
- `jarvis-backend/src/api/routes.ts` - Route composition: public routes, then auth middleware for protected routes
- `jarvis-backend/src/realtime/socket.ts` - Socket.IO with /cluster and /events namespaces, JWT auth middleware
- `jarvis-backend/Dockerfile` - Multi-stage build: node:22-slim builder + production image
- `jarvis-backend/.dockerignore` - Excludes node_modules, dist, .env from Docker context
- `jarvis-backend/.gitignore` - Excludes node_modules, dist, .env, data/
- `docker-compose.yml` - jarvis-backend service with healthcheck, volumes, networking
- `.env` - Docker Compose environment variables (development defaults)

## Decisions Made

- **node:22-slim over alpine** - Avoids musl/glibc compatibility issues with better-sqlite3 native bindings. Slightly larger image but more reliable native module compilation.
- **prebuild-install for better-sqlite3** - Downloads pre-built binary instead of compiling from source in Docker. Eliminates need for python3/make/g++ in builder stage.
- **Express 5** - Native async error handling, no need for express-async-errors wrapper.
- **Socket.IO namespace separation** - /cluster for real-time cluster data push, /events for Jarvis activity feed. Clean separation of concerns.
- **JWT 7-day expiry with single operator role** - Appropriate for homelab with single user. No refresh token complexity needed.
- **All Phase 1 deps installed upfront** - Plans 01-02 through 01-04 can start coding immediately without npm install steps.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Backend server is running and accepting health checks, JWT authentication, and WebSocket connections
- All Phase 1 dependencies are installed and ready for use:
  - `better-sqlite3` + `drizzle-orm` for Plan 01-02 (database layer)
  - `node-ssh` for Plan 01-03 (SSH execution engine)
  - `@modelcontextprotocol/sdk` + `zod` for Plan 01-04 (MCP tools)
- Docker Compose pipeline ready for deployment
- Proxmox API tokens (`root@pam!jarvis`) still need to be created before Plan 01-03 can connect to cluster nodes

---
*Phase: 01-backend-foundation-safety-layer*
*Completed: 2026-01-26*

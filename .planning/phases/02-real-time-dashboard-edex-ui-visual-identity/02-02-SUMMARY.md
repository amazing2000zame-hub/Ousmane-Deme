---
phase: 02-real-time-dashboard-edex-ui-visual-identity
plan: 02
subsystem: api, realtime
tags: [socket.io, proxmox-api, ssh-pty, rest-api, polling, mcp-tools]

# Dependency graph
requires:
  - phase: 01-backend-foundation-safety-layer
    provides: "Socket.IO namespaces, Proxmox client, SSH connection pool, MCP server with executeTool()"
provides:
  - "Real-time data emitter pushing nodes/VMs/storage/quorum/temperature to /cluster namespace"
  - "POST /api/tools/execute endpoint for MCP tool invocation with immediate Socket.IO data refresh"
  - "/terminal Socket.IO namespace for SSH PTY sessions with bidirectional shell streaming"
  - "On-demand emit functions (emitNodesNow, emitStorageNow) for instant UI updates after actions"
affects:
  - "02-03 (dashboard components consume Socket.IO events)"
  - "02-04 (terminal panel connects to /terminal namespace)"
  - "03-ai-chat (AI actions trigger tool execution endpoint)"
  - "04-autonomous-agents (monitors use same data stream)"

# Tech tracking
tech-stack:
  added: ["@types/ssh2"]
  patterns:
    - "Timed polling with try/catch per interval (never crash the loop)"
    - "On-demand emit after tool execution for instant UI feedback"
    - "SSH PTY sessions via connection pool (shell cleanup without pool disposal)"
    - "Session tracking with cleaned flag to prevent double-close"

key-files:
  created:
    - "jarvis-backend/src/realtime/emitter.ts"
    - "jarvis-backend/src/realtime/terminal.ts"
  modified:
    - "jarvis-backend/src/api/routes.ts"
    - "jarvis-backend/src/index.ts"
    - "jarvis-backend/src/config.ts"
    - "jarvis-backend/src/realtime/socket.ts"
    - "jarvis-backend/src/clients/ssh.ts"

key-decisions:
  - "Quorum polled at 10s interval (same as nodes) since it's critical cluster health data"
  - "Temperature fetched via SSH paste command combining thermal zone type and temp in one call"
  - "On-demand emit runs before API response returns, so WebSocket clients see changes within milliseconds"
  - "Terminal sessions use case-insensitive node name resolution for better UX"
  - "@types/ssh2 installed to get proper ClientChannel type for PTY shell streams"

patterns-established:
  - "Emitter pattern: poll -> transform -> emit with try/catch per category"
  - "On-demand emit after tool execution: emitNodesNow/emitStorageNow called from routes"
  - "Shell session lifecycle: create -> track by socket.id -> cleanup with cleaned flag"
  - "External timeout for SSH commands via Promise.race (ssh2 ExecOptions lacks timeout)"

# Metrics
duration: 7min
completed: 2026-01-26
---

# Phase 2 Plan 2: Real-Time Data Emitter, Tool Execution, and Terminal Namespace Summary

**Proxmox polling emitter (10-30s intervals) pushing to Socket.IO /cluster, POST /api/tools/execute with instant Socket.IO refresh, and /terminal SSH PTY namespace using connection pool**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-26T08:50:04Z
- **Completed:** 2026-01-26T08:57:25Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Real-time data emitter polls Proxmox for nodes (10s), VMs (15s), storage (30s), quorum (10s), and temperature (30s via SSH), emitting structured data to /cluster namespace
- POST /api/tools/execute endpoint invokes MCP tools with full safety tier enforcement (GREEN/YELLOW/RED/BLACK) and immediately emits updated data to all connected clients
- /terminal Socket.IO namespace creates SSH PTY sessions with bidirectional data streaming, resize support, and proper cleanup semantics that preserve pooled SSH connections
- On first client connection, all data categories are emitted immediately (no waiting for interval)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create real-time data emitter and tool execution endpoint** - `ede9a07` (feat)
2. **Task 2: Create /terminal Socket.IO namespace for SSH PTY sessions** - `a506deb` (feat)

## Files Created/Modified
- `jarvis-backend/src/realtime/emitter.ts` - Periodic Proxmox polling and Socket.IO emit logic with on-demand emit functions (342 lines)
- `jarvis-backend/src/realtime/terminal.ts` - SSH PTY session management over /terminal namespace (268 lines)
- `jarvis-backend/src/api/routes.ts` - Added POST /api/tools/execute and GET /api/tools endpoints
- `jarvis-backend/src/index.ts` - Wired emitter start/stop and terminal handler setup into server lifecycle
- `jarvis-backend/src/config.ts` - Added Vite dev server CORS origins (localhost:5173, 192.168.1.50:5173)
- `jarvis-backend/src/realtime/socket.ts` - Added /terminal namespace with JWT auth middleware
- `jarvis-backend/src/clients/ssh.ts` - Fixed ExecOptions timeout (ssh2 doesn't support timeout in ExecOptions)

## Decisions Made
- Quorum polled at 10s (same as nodes) rather than 30s because quorum state is critical and the API call is lightweight
- Temperature uses SSH `paste` command to combine thermal zone type and temp in a single call, reducing SSH round-trips
- On-demand emit fires before the API response is sent, ensuring WebSocket clients see the tool's effect within milliseconds
- Terminal namespace uses case-insensitive node name lookup for better operator UX
- Installed @types/ssh2 as devDependency for proper ClientChannel typing in terminal.ts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed ssh2 ExecOptions timeout type error**
- **Found during:** Task 2 (TypeScript compilation after @types/ssh2 install)
- **Issue:** The ssh.ts client passed `{ timeout }` in `execOptions`, but ssh2's `ExecOptions` interface does not have a `timeout` property. This was hidden before @types/ssh2 was installed.
- **Fix:** Replaced with external timeout via `Promise.race()` -- the command promise races against a setTimeout rejection
- **Files modified:** `jarvis-backend/src/clients/ssh.ts`
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `a506deb` (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was necessary for compilation after adding @types/ssh2. Timeout behavior is preserved via Promise.race. No scope creep.

## Issues Encountered
- Task 1 commit accidentally included pre-staged jarvis-ui scaffold files that were staged by a prior session. These are legitimate Phase 2 frontend files and do not affect correctness. Noted for awareness.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- /cluster namespace emits nodes, vms, storage, quorum, and temperature events -- dashboard components can subscribe immediately
- POST /api/tools/execute is ready for dashboard action buttons (start/stop VM, etc.)
- /terminal namespace is ready for the terminal panel component
- CORS configured for both production (port 3004) and development (port 5173) origins
- All additions compile cleanly and integrate with existing Phase 1 architecture

---
*Phase: 02-real-time-dashboard-edex-ui-visual-identity*
*Completed: 2026-01-26*

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Phase 2 -- Real-Time Dashboard & eDEX-UI Visual Identity

## Current Position

Phase: 2 of 5 (Real-Time Dashboard & eDEX-UI Visual Identity)
Plan: 5 of 6 in current phase
Status: In progress (plans 02-01, 02-02, 02-05 complete; 02-03, 02-04 parallel; 02-06 remaining)
Last activity: 2026-01-26 -- Completed 02-05-PLAN.md (terminal panel with xterm.js + Socket.IO PTY)

Progress: [##........] 1/5 phases complete, plan 5/6 in phase 2

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 5.4 min
- Total execution time: 38 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4/4 | 22 min | 5.5 min |
| 02 | 3/6 | 16 min | 5.3 min |

**Recent Trend:**
- Last 5 plans: 01-03 (7 min), 02-01 (6 min), 02-02 (7 min), 02-05 (3 min)
- Trend: consistent, 02-05 fast (2 focused tasks)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 5-phase dependency-driven build order (backend -> dashboard -> AI chat -> autonomy -> hybrid intelligence)
- [Roadmap]: Safety framework is Phase 1 architectural constraint, not retrofittable
- [Roadmap]: Claude-only in Phase 3, hybrid LLM deferred to Phase 5
- [01-01]: node:22-slim over alpine for Docker (avoids musl/glibc issues with better-sqlite3)
- [01-01]: Express 5 with native async error handling
- [01-01]: Socket.IO namespaces /cluster and /events for real-time data separation
- [01-01]: JWT 7-day expiry with single operator role (homelab simplicity)
- [01-01]: All Phase 1 deps installed upfront in 01-01
- [01-02]: PVEAPIToken auth format, self-signed TLS via env var, SSH privateKeyPath not privateKey
- [01-02]: SSH connection pool with auto-reconnect on stale connections
- [01-03]: 4-tier safety with BLACK default (unknown tools blocked by fail-safe)
- [01-03]: Command allowlist (default-deny) for SSH commands with 50+ safe patterns
- [01-03]: Handler capture via McpServer.tool() monkey-patch for in-process executeTool()
- [01-03]: SSH closeAllConnections() integrated into graceful shutdown
- [01-04]: Dual migration strategy (drizzle migrator + direct SQL fallback)
- [01-04]: onConflictDoUpdate for preference upsert semantics
- [01-04]: JS Date for resolvedAt to avoid drizzle type complexity
- [02-01]: Events stored in cluster store (not separate) with 100-item ring buffer
- [02-01]: All socket handlers use named functions for reliable .off() cleanup
- [02-01]: Auth persist only stores token (isAuthenticated derived on hydration)
- [02-01]: UI store persists only visualMode (not bootComplete or focusedPanel)
- [02-02]: Quorum polled at 10s (same as nodes) -- critical cluster health, lightweight API call
- [02-02]: Temperature via SSH paste command combining zone type + temp in one call
- [02-02]: On-demand emit before API response return for instant WebSocket client updates
- [02-02]: Terminal namespace uses case-insensitive node name resolution
- [02-02]: External timeout for SSH commands via Promise.race (ssh2 ExecOptions lacks timeout)
- [02-05]: WebGL addon with try/catch DOM fallback -- context loss disposes WebGL addon gracefully
- [02-05]: display:none for collapsed state preserves xterm.js instance (no re-create on expand)
- [02-05]: Single session enforced at hook level -- connect() auto-disconnects previous session

### Pending Todos

None.

### Blockers/Concerns

- Proxmox API tokens (`root@pam!jarvis`) do not exist yet -- must be created manually on each PVE node before Phase 1 backend can connect
- Self-signed TLS on Proxmox nodes handled via NODE_TLS_REJECT_UNAUTHORIZED=0 env var
- ~~closeAllConnections() should be integrated into server shutdown handler~~ (RESOLVED in 01-03)

## Session Continuity

Last session: 2026-01-26T09:07:00Z
Stopped at: Completed 02-05-PLAN.md (terminal panel with xterm.js + Socket.IO PTY)
Resume file: None

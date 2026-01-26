# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Phase 1 -- Backend Foundation & Safety Layer

## Current Position

Phase: 1 of 5 (Backend Foundation & Safety Layer)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-01-26 -- Completed 01-04-PLAN.md (SQLite Persistence Layer)

Progress: [#######...] 3/4 Phase 1 plans complete (75%)

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: 5 min
- Total execution time: 15 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3/4 | 15 min | 5 min |

**Recent Trend:**
- Last 5 plans: 01-01 (7 min), 01-02 (3 min), 01-04 (5 min)
- Trend: consistent

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
- [01-04]: Dual migration strategy (drizzle migrator + direct SQL fallback)
- [01-04]: onConflictDoUpdate for preference upsert semantics
- [01-04]: JS Date for resolvedAt to avoid drizzle type complexity

### Pending Todos

None.

### Blockers/Concerns

- Proxmox API tokens (`root@pam!jarvis`) do not exist yet -- must be created manually on each PVE node before Phase 1 backend can connect
- Self-signed TLS on Proxmox nodes handled via NODE_TLS_REJECT_UNAUTHORIZED=0 env var
- closeAllConnections() should be integrated into server shutdown handler

## Session Continuity

Last session: 2026-01-26T07:19:44Z
Stopped at: Completed 01-04-PLAN.md
Resume file: None

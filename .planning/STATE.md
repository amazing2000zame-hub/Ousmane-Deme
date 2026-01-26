# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Phase 3 -- AI Chat & Claude Integration

## Current Position

Phase: 3 of 5 (AI Chat & Claude Integration)
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-01-26 -- Completed Phase 2 (dashboard, eDEX-UI, globe HUD, 5-theme system)

Progress: [####......] 2/5 phases complete

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: 5.4 min
- Total execution time: 54 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4/4 | 22 min | 5.5 min |
| 02 | 6/6 | 32 min | 5.3 min |

**Recent Trend:**
- Last 5 plans: 02-02 (7 min), 02-05 (3 min), 02-03 (5 min), 02-04 (5 min), 02-06 (6 min)
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
- [02-03]: Auth gate uses AuthenticatedApp wrapper so socket hooks only run when authenticated
- [02-03]: Dashboard column widths: 320px left, 1fr center, 380px right for optimal density
- [02-03]: GlowBorder created as deviation fix to unblock VMCard compilation from Plan 02-04
- [02-03]: Node temperature shows first zone as primary, all zones in expanded detail view
- [02-05]: WebGL addon with try/catch DOM fallback -- context loss disposes WebGL addon gracefully
- [02-05]: display:none for collapsed state preserves xterm.js instance (no re-create on expand)
- [02-05]: Single session enforced at hook level -- connect() auto-disconnects previous session
- [02-04]: VMData status mapped to StatusDot via toStatusDotStatus() adapter function
- [02-04]: GlowBorder enhanced with cyan color, visual mode awareness, className prop
- [02-04]: ConfirmDialog uses Escape key and backdrop click for cancel (accessibility)
- [02-04]: ActivityFeed auto-scrolls to top on new events (newest first rendering)
- [02-06]: 5-colorway theme system via CSS custom property overrides ([data-theme="X"] selectors)
- [02-06]: Iron Man 3 wireframe globe HUD with CSS 3D transforms (no Three.js dependency)
- [02-06]: RadialDataRing SVG arcs for per-node CPU visualization around globe
- [02-06]: Theme picker hidden behind CFG dropdown in TopBar to reduce clutter
- [02-06]: Terminal toggle (>_) button in TopBar, collapsed terminal fully hides (0px) preserving xterm state

### Pending Todos

None.

### Blockers/Concerns

- Proxmox API tokens (`root@pam!jarvis`) do not exist yet -- must be created manually on each PVE node before Phase 1 backend can connect
- Self-signed TLS on Proxmox nodes handled via NODE_TLS_REJECT_UNAUTHORIZED=0 env var
- ~~closeAllConnections() should be integrated into server shutdown handler~~ (RESOLVED in 01-03)

## Session Continuity

Last session: 2026-01-26
Stopped at: Phase 2 complete, ready for Phase 3 planning
Resume file: None

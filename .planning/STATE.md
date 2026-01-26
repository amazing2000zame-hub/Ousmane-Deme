# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Phase 6 -- HUD & Feed Data Pipeline (wire temperature, seed feed, chat events, heartbeat)

## Current Position

Phase: 6 of 6 (HUD & Feed Data Pipeline) -- executing
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-01-26 -- Completed 06-01-PLAN.md (event pipeline wiring)

Progress: [#################.] 17/18 plans complete

### Roadmap Evolution
- Phase 6 added: HUD & Feed Data Pipeline -- wire temperature data to frontend, seed ActivityFeed with event history, emit chat tool executions to feed, implement health heartbeat and storage alerts

## Performance Metrics

**Velocity:**
- Total plans completed: 17
- Average duration: 5.6 min
- Total execution time: 99 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4/4 | 22 min | 5.5 min |
| 02 | 6/6 | 32 min | 5.3 min |
| 03 | 3/3 | 19 min | 6.3 min |
| 04 | 3/3 | 23 min | 7.7 min |
| 06 | 1/2 | 3 min | 3.0 min |

**Recent Trend:**
- Last 5 plans: 06-01 (3 min), 04-02 (11 min), 04-03 (~8 min), 03-01 (~8 min), 03-02 (~6 min)
- Trend: improving

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
- [04-01]: Threshold order: DISK_CRITICAL (95%) before DISK_HIGH (90%) so highest severity wins
- [04-01]: 5-second startup delay for monitor to let emitter populate first
- [04-01]: Polling offsets 12s/32s vs emitter 10s/30s to avoid API thundering herd
- [04-01]: State tracker in-memory Maps (not SQLite) for hot-path performance
- [04-01]: Only running->stopped transitions trigger VM_CRASHED/CT_CRASHED
- [04-02]: Dependency injection for eventsNs via setupMonitorRoutes(router, eventsNs) -- avoids circular import
- [04-02]: Kill switch double-check: once in checkGuardrails + once before executeTool (race condition guard)
- [04-02]: Escalation emails bypass 5-minute rate limit -- always sent
- [04-02]: Runbook execution fire-and-forget from pollCritical() -- never blocks poll loop
- [04-02]: Stale remediation cleanup at 10-minute timeout prevents blast radius deadlock
- [04-03]: Source field optional on JarvisEvent for backward compat with pre-monitor events
- [04-03]: Optimistic kill switch toggle -- setKillSwitch before API, revert on error
- [04-03]: Remediation border color derived from title keywords (detected=amber, remediating=cyan, resolved=green, escalation=red)
- [04-03]: Filter buttons match J/O/M mode button styling for eDEX-UI consistency
- [04-03]: Monitor status fetched on socket connect (not separate polling) to avoid redundant API calls
- [03-01]: Claude client null when ANTHROPIC_API_KEY not set -- claudeAvailable flag gates usage
- [03-01]: Tool definitions hardcoded for LLM-optimized descriptions, not auto-converted from Zod
- [03-01]: Smart routing: keyword detection routes to Claude (tools) or local Qwen (conversation)
- [03-01]: Override passkey ('override alpha') temporarily elevates BLACK/RED restrictions
- [03-01]: Max loop iterations (10) with final iteration omitting tools to force text response
- [03-02]: uid() fallback for crypto.randomUUID in HTTP (non-secure) contexts
- [03-02]: Chat store not persisted -- sessions ephemeral until Phase 5 memory
- [03-02]: useChatStore.getState() in socket handlers avoids stale closures
- [03-03]: ConfirmCard internal responded state prevents double-click on AUTHORIZE/DENY
- [03-03]: describeAction() generates readable summaries from toolName + input params
- [03-03]: GlowBorder amber for confirm, red for blocked -- matches eDEX-UI severity aesthetic
- [06-01]: eventsNs injected as second parameter to setupChatHandlers (same DI pattern as monitor routes)
- [06-01]: One event per tool execution (onToolUse only) -- no events for onToolResult/onBlocked to avoid feed spam
- [06-01]: Storage check has inner try/catch in pollBackground so failures don't block audit cleanup

### Pending Todos

None.

### Blockers/Concerns

- Proxmox API tokens (`root@pam!jarvis`) do not exist yet -- must be created manually on each PVE node before Phase 1 backend can connect
- Self-signed TLS on Proxmox nodes handled via NODE_TLS_REJECT_UNAUTHORIZED=0 env var
- ~~closeAllConnections() should be integrated into server shutdown handler~~ (RESOLVED in 01-03)

## Session Continuity

Last session: 2026-01-26T16:41:46Z
Stopped at: Completed 06-01-PLAN.md (event pipeline wiring). Next: 06-02-PLAN.md
Resume file: None

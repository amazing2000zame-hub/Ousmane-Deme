---
phase: 01-backend-foundation-safety-layer
plan: 03
subsystem: safety-and-mcp
tags: [mcp, safety, tiers, ssh, proxmox, tools, sanitization]
dependency-graph:
  requires: ["01-02", "01-04"]
  provides: ["mcp-tool-server", "safety-framework", "executeTool-pipeline"]
  affects: ["02-01", "02-02", "03-01", "04-01"]
tech-stack:
  added: []
  patterns: ["4-tier-safety", "command-allowlist", "protected-resources", "tool-registry-pattern"]
key-files:
  created:
    - jarvis-backend/src/safety/tiers.ts
    - jarvis-backend/src/safety/protected.ts
    - jarvis-backend/src/safety/sanitize.ts
    - jarvis-backend/src/mcp/server.ts
    - jarvis-backend/src/mcp/tools/cluster.ts
    - jarvis-backend/src/mcp/tools/lifecycle.ts
    - jarvis-backend/src/mcp/tools/system.ts
  modified:
    - jarvis-backend/src/index.ts
decisions:
  - id: safety-tiers
    decision: "4-tier classification (Green/Yellow/Red/Black) with fail-safe default to BLACK"
    reason: "Unknown tools are blocked by default, preventing new tools from bypassing safety"
  - id: command-allowlist
    decision: "Default-deny command policy with explicit allowlist for SSH commands"
    reason: "Prevents arbitrary command execution; only monitored safe commands are permitted"
  - id: mcp-handler-capture
    decision: "Monkey-patch McpServer.tool() to capture handler references for in-process execution"
    reason: "MCP SDK designed for transport-based execution; we need direct in-process calls via executeTool()"
  - id: ssh-shutdown-integration
    decision: "closeAllConnections() integrated into graceful shutdown handler"
    reason: "Resolves existing blocker from STATE.md about SSH connection cleanup"
metrics:
  duration: "7 min"
  completed: "2026-01-26"
---

# Phase 1 Plan 3: MCP Tools & Safety Layer Summary

**One-liner:** 18 MCP tools with 4-tier safety enforcement, protected resource blocking, command allowlist/blocklist, and full execution logging via executeTool() pipeline.

## What Was Built

### Safety Framework (3 modules)

1. **tiers.ts** (152 lines) -- 4-tier action classification:
   - GREEN (9 tools): Auto-execute read-only operations
   - YELLOW (3 tools): Execute + log (SSH, service restart, WOL)
   - RED (6 tools): Require `confirmed=true` (VM/CT lifecycle)
   - BLACK (1 tool): Always blocked (reboot_node)
   - Unknown tools default to BLACK (fail-safe)

2. **protected.ts** (107 lines) -- Protected resource enforcement:
   - Node `agent1` (Jarvis infrastructure host) -- always blocked
   - VMID 103 (management VM) -- always blocked
   - `docker.service` / `docker` -- always blocked
   - IPs `192.168.1.61` and `192.168.1.65` -- always blocked
   - Checks node, vmid, service, ip, and command arguments

3. **sanitize.ts** (223 lines) -- Input sanitization:
   - `sanitizeInput()`: Strip null bytes, control chars, truncate to 10K
   - `sanitizeNodeName()`: Strict alphanumeric + hyphen/underscore pattern
   - `sanitizeCommand()`: Default-deny with explicit allowlist of 50+ safe commands
   - Blocklist of 18 destructive command patterns (rm -rf, mkfs, dd, etc.)
   - Shell metacharacter detection (;, &, `, $) with limited pipe support

### MCP Tool Server (4 modules)

4. **server.ts** (242 lines) -- Central execution pipeline:
   - `executeTool(name, args, source)` -- single entry point for all operations
   - Pipeline: sanitize -> checkSafety -> execute handler -> log to SQLite
   - Sources: 'llm' | 'monitor' | 'user' | 'api'
   - All executions logged with duration, tier, success/failure
   - Blocked attempts logged with warning severity

5. **tools/cluster.ts** (248 lines) -- 9 read-only tools:
   - get_cluster_status, get_node_status, get_vms, get_containers
   - get_storage, get_cluster_resources, get_node_temperature
   - get_recent_tasks, get_backups

6. **tools/lifecycle.ts** (191 lines) -- 6 lifecycle tools:
   - start_vm, stop_vm, restart_vm
   - start_container, stop_container, restart_container

7. **tools/system.ts** (198 lines) -- 3 system tools:
   - execute_ssh (allowlist-enforced)
   - restart_service (restart + verify is-active)
   - wake_node (WOL API at 192.168.1.65:3005)

### Application Integration

- MCP server initialized during startup with tool count log
- SSH connection cleanup integrated into graceful shutdown
- Server prints all 18 tools with tier classification on start

## Verification Results

| Check | Result |
|-------|--------|
| TypeScript compilation (zero errors) | PASS |
| 18 tools registered (9 GREEN, 3 YELLOW, 6 RED) | PASS |
| get_node_temperature via SSH returns real data | PASS |
| VMID 103 blocked (protected resource) | PASS |
| agent1 node blocked (protected resource) | PASS |
| Docker service blocked (protected resource) | PASS |
| rm -rf / blocked (command blocklist) | PASS |
| RED tier without confirmation blocked | PASS |
| BLACK tier always blocked (reboot_node) | PASS |
| Unknown tools blocked (fail-safe) | PASS |
| Tool executions logged to SQLite | PASS |
| Server starts with MCP initialization message | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed thermal zone reading on Home node**
- **Found during:** Task 2 verification
- **Issue:** `cat /sys/class/thermal/thermal_zone*/temp` uses `&&` chain; if any zone is unreadable, exit code is non-zero and subsequent commands don't run, losing the type labels
- **Fix:** Changed to `;` separator so all commands run regardless; check for empty stdout instead of exit code
- **Files modified:** jarvis-backend/src/mcp/tools/cluster.ts
- **Commit:** 699ff3f

**2. [Rule 2 - Missing Critical] Integrated SSH connection cleanup into shutdown**
- **Found during:** Task 2 (reading STATE.md blockers)
- **Issue:** STATE.md listed "closeAllConnections() should be integrated into server shutdown handler" as a pending concern
- **Fix:** Added `closeAllConnections()` call in shutdown() function before io.close()
- **Files modified:** jarvis-backend/src/index.ts
- **Commit:** 699ff3f

## Decisions Made

1. **4-tier safety with BLACK default:** Unknown tools are blocked by default. This prevents new tools from bypassing safety if they are registered without updating the tier map.

2. **Command allowlist (default-deny):** SSH commands must match an allowlist of ~50 safe read-only commands. Dangerous patterns (rm -rf, mkfs, dd) are explicitly blocklisted. This is more restrictive than necessary for a homelab but matches the safety-first architecture.

3. **Handler capture via monkey-patch:** The MCP SDK's `McpServer.tool()` method was monkey-patched to capture handler function references into a local Map. This enables `executeTool()` to call handlers directly in-process without requiring a transport layer.

4. **SSH shutdown integration:** Resolved the STATE.md blocker by integrating `closeAllConnections()` into the server's graceful shutdown handler.

## Commits

| Hash | Message |
|------|---------|
| 28365b0 | feat(01-03): build safety framework -- tiers, protected resources, input sanitization |
| 699ff3f | feat(01-03): build MCP server with 18 tools and wire into application |

## Next Phase Readiness

Phase 1 is now complete (4/4 plans). The backend has:
- Express 5 server with JWT auth and Socket.IO (01-01)
- Proxmox REST and SSH clients (01-02)
- MCP tool server with 18 tools and safety framework (01-03)
- SQLite persistence with Drizzle ORM (01-04)

Ready for Phase 2 (Dashboard) which will consume the API and MCP tools.

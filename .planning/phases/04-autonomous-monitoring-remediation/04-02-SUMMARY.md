---
phase: "04"
plan: "02"
subsystem: "autonomous-monitoring"
completed: "2026-01-26"
duration: "11 min"
tags: [runbooks, guardrails, kill-switch, blast-radius, rate-limiting, email-reporting, remediation]
requires:
  - "04-01"
provides:
  - "Remediation engine with 3 runbooks (VM restart, CT restart, node WOL)"
  - "Safety guardrails (kill switch, rate limiter, blast radius, autonomy level)"
  - "Email reporter via SSH to agent1"
  - "Monitor REST API (status, kill switch, actions, autonomy level)"
affects:
  - "04-03"
tech-stack:
  added: []
  patterns:
    - "Dependency injection for eventsNs (avoids circular imports)"
    - "Fire-and-forget runbook execution from pollers"
    - "Kill switch double-check pattern (pre-guardrail + pre-execution)"
    - "Sliding window rate limiter with in-memory Maps"
    - "Blast radius control via active remediation tracking"
key-files:
  created:
    - "src/monitor/guardrails.ts"
    - "src/monitor/runbooks.ts"
    - "src/monitor/reporter.ts"
  modified:
    - "src/monitor/poller.ts"
    - "src/monitor/index.ts"
    - "src/api/routes.ts"
    - "src/index.ts"
decisions:
  - id: "04-02-01"
    decision: "Dependency injection for eventsNs via setupMonitorRoutes(router, eventsNs) -- avoids circular import between routes.ts and index.ts"
  - id: "04-02-02"
    decision: "Kill switch double-check: once in checkGuardrails (early rejection) and once immediately before executeTool (race condition guard)"
  - id: "04-02-03"
    decision: "Escalation emails bypass 5-minute rate limit -- always sent regardless of recent email history"
  - id: "04-02-04"
    decision: "Runbook execution is fire-and-forget from pollCritical() -- unhandled rejections caught inline, never blocks the poll loop"
  - id: "04-02-05"
    decision: "Stale remediation cleanup at 10-minute timeout -- prevents blast radius deadlock from stuck remediations"
metrics:
  tasks: "2/2"
  commits: 2
---

# Phase 4 Plan 2: Remediation Engine, Guardrails, and Email Reporter Summary

**One-liner:** Runbook-driven remediation with kill switch, blast radius control, and escalation emails via agent1 SSH

## What Was Built

### Guardrails (`src/monitor/guardrails.ts`)
- **Kill switch:** Reads `autonomy.killSwitch` preference, fail-safe defaults to active if DB unavailable
- **Rate limiter:** Sliding window, 3 attempts per incident key per hour, in-memory Map with automatic cleanup
- **Blast radius:** Tracks active remediations per node, blocks concurrent multi-node remediation, 10-minute stale entry cleanup
- **Autonomy level:** Checks current level vs required level, defaults to L3_ACT_REPORT (3) if unset
- **checkGuardrails():** Runs all checks in priority order (kill switch > rate limit > blast radius > autonomy level)

### Runbooks (`src/monitor/runbooks.ts`)
- **vm-crashed-restart:** Trigger=VM_CRASHED, tool=start_vm, verify delay=15s, cooldown=60s
- **ct-crashed-restart:** Trigger=CT_CRASHED, tool=start_container, verify delay=10s, cooldown=60s
- **node-unreachable-wol:** Trigger=NODE_UNREACHABLE, tool=wake_node, verify delay=60s, cooldown=120s
- **executeRunbook():** Full pipeline with try/catch/finally, double kill switch check, verification via Proxmox API re-poll, autonomy action logging, event emission, email reporting
- **Escalation:** After 3 failed attempts, sends escalation email AND further attempts are rate-limit-blocked

### Email Reporter (`src/monitor/reporter.ts`)
- **sendRemediationEmail():** HTML table email via SSH to agent1 (192.168.1.61), 5-minute rate limit
- **sendEscalationEmail():** Red header urgent email, bypasses rate limit, includes manual investigation recommendations
- Shell-safe single quote escaping for HTML/subject in bash commands
- All errors caught -- email failure is non-fatal (warn + continue)

### Monitor REST API (added to `src/api/routes.ts`)
- **GET /api/monitor/status:** Returns `{ running, autonomyLevel, killSwitch, activeRemediations }`
- **PUT /api/monitor/killswitch:** Toggles kill switch, saves event, emits WebSocket event
- **GET /api/monitor/actions:** Returns autonomy action audit log with optional limit
- **PUT /api/monitor/autonomy-level:** Sets autonomy level (0-4, validated)
- Wired via `setupMonitorRoutes(router, eventsNs)` dependency injection -- NO circular imports

### Poller Integration (`src/monitor/poller.ts`)
- pollCritical() now creates Incident objects from detected StateChanges
- Calls executeRunbook() fire-and-forget for each state change
- Promise rejections caught inline with console.error

## Key Patterns

1. **Kill switch double-check:** checkGuardrails checks kill switch early. If operator toggles kill switch between detection and execution, the second check in executeRunbook aborts before executeTool runs.

2. **Blast radius enforcement:** Only 1 remediation active at a time across all nodes. markRemediationActive/Complete in try/finally guarantees cleanup even on error.

3. **Rate limit -> escalation cascade:** 3 attempts in 1 hour triggers escalation email. The rate limiter then naturally blocks attempt 4+, preventing infinite retry loops.

4. **Dependency injection:** eventsNs passed into setupMonitorRoutes() as a parameter, avoiding the fragile `await import('../index.js')` circular dependency pattern.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- `npx tsc --noEmit` -- zero type errors
- No circular imports confirmed: `grep -r "from.*'../index" src/api/routes.ts` returns nothing
- Blast radius test: markRemediationActive('nodeA') blocks checkGuardrails('nodeB'), markRemediationComplete('nodeA') unblocks
- Rate limiter test: 3 recordAttempt() calls, 4th checkGuardrails returns "Rate limit exceeded"
- Kill switch test: default inactive (no preference set), returns false
- All 3 runbooks found by findRunbook() for VM_CRASHED, CT_CRASHED, NODE_UNREACHABLE
- DISK_HIGH correctly returns undefined (no automated fix)

## Next Phase Readiness

Plan 04-03 (Dashboard autonomy controls) can proceed. The REST API endpoints are ready:
- GET /api/monitor/status for displaying current state
- PUT /api/monitor/killswitch for the kill switch toggle
- PUT /api/monitor/autonomy-level for the autonomy level slider
- GET /api/monitor/actions for the action history table

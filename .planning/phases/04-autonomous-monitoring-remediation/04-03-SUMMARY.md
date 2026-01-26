---
phase: "04"
plan: "03"
subsystem: "autonomous-monitoring-frontend"
completed: "2026-01-26"
duration: "~8 min"
tags: [activity-feed, kill-switch, source-filtering, remediation-ui, edex-ui]
requires:
  - "04-02"
provides:
  - "Enhanced ActivityFeed with source badges and remediation sequence styling"
  - "Source filter toggles (ALL/AUTO/ALERTS)"
  - "Kill switch toggle in TopBar with optimistic updates"
  - "Monitor API integration (status, kill switch, autonomy level, actions)"
  - "Socket-driven kill switch state sync"
affects: []
tech-stack:
  added: []
  patterns:
    - "Source badge rendering via record lookup"
    - "Remediation border color derived from event title keywords"
    - "Optimistic kill switch toggle with API revert on failure"
    - "Socket connect triggers initial monitor status fetch"
key-files:
  created: []
  modified:
    - "jarvis-ui/src/types/events.ts"
    - "jarvis-ui/src/services/api.ts"
    - "jarvis-ui/src/stores/cluster.ts"
    - "jarvis-ui/src/hooks/useEventsSocket.ts"
    - "jarvis-ui/src/components/center/ActivityFeed.tsx"
    - "jarvis-ui/src/components/layout/TopBar.tsx"
decisions:
  - id: "04-03-01"
    decision: "Source field optional on JarvisEvent for backward compatibility with events that predate the monitor system"
  - id: "04-03-02"
    decision: "Optimistic kill switch toggle -- setKillSwitch called before API, reverted on error for instant UI feedback"
  - id: "04-03-03"
    decision: "Remediation border color derived from title keywords (detected/crashed=amber, remediating=cyan, resolved=green, escalation=red)"
  - id: "04-03-04"
    decision: "Filter buttons match J/O/M mode button styling for visual consistency in eDEX-UI aesthetic"
  - id: "04-03-05"
    decision: "Monitor status fetched on socket connect (not separate polling) to avoid redundant API calls"
metrics:
  tasks: "2/2"
  commits: 2
---

# Phase 4 Plan 3: Frontend Dashboard for Autonomous Monitoring Summary

**One-liner:** Activity feed with source-aware filtering and kill switch toggle give the operator real-time visibility and one-click control over autonomous actions

## What Was Built

### Extended Types (`jarvis-ui/src/types/events.ts`)
- **source** field added to `JarvisEvent`: `'monitor' | 'user' | 'jarvis' | 'system'` (optional for backward compat)
- **MonitorStatus** interface: `{ killSwitch, autonomyLevel, running }`

### Monitor API Functions (`jarvis-ui/src/services/api.ts`)
- `getMonitorStatus(token)` -- GET /api/monitor/status
- `toggleKillSwitch(active, token)` -- PUT /api/monitor/killswitch
- `setAutonomyLevel(level, token)` -- PUT /api/monitor/autonomy-level
- `getMonitorActions(token, limit?)` -- GET /api/monitor/actions

### Cluster Store Extensions (`jarvis-ui/src/stores/cluster.ts`)
- `monitorStatus: MonitorStatus | null` state with default null
- `setMonitorStatus(status)` -- full status update
- `setKillSwitch(active)` -- optimistic kill switch update, creates default status if null

### Events Socket Hook (`jarvis-ui/src/hooks/useEventsSocket.ts`)
- Kill switch event detection: events with type `'status'` and title containing `'KILL SWITCH'` update store
- Initial monitor status fetched on socket connect via `getMonitorStatus()` API call
- Named handler functions for proper `.off()` cleanup

### Enhanced ActivityFeed (`jarvis-ui/src/components/center/ActivityFeed.tsx`)
- **Source badges:** `[AUTO]` (cyan), `[AI]` (amber), `[USER]` (muted), `[SYS]` (dim) displayed inline before event title
- **Filter bar:** ALL / AUTO / ALERTS toggle buttons with event count display (filtered/total)
  - ALL: all events
  - AUTO: `source === 'monitor'` only
  - ALERTS: `severity === 'error' || 'critical'` only
- **Remediation sequence borders:** Left border color based on event title keywords:
  - Amber: detected, crashed, unreachable
  - Cyan: remediating, acting, restarting
  - Green: verified, resolved
  - Red: escalation, failed
- Filter buttons styled identically to J/O/M mode buttons (monospace, tracked, 9px)

### TopBar Kill Switch (`jarvis-ui/src/components/layout/TopBar.tsx`)
- **AUTO button** between connection status and visual mode switcher
- Green text + green pulsing dot when autonomous actions enabled
- Red text + strikethrough + red static dot when kill switch active
- Tooltip shows full status description
- Click handler: optimistic `setKillSwitch()`, then API call, revert on error
- Uses same `StatusDot` component as connection indicator

## Key Patterns

1. **Optimistic UI:** Kill switch toggles instantly in the store before the API responds. On API failure, the previous value is restored. This prevents the user from seeing a laggy toggle.

2. **Socket-driven sync:** When another client (or the backend) toggles the kill switch, the status event arrives via WebSocket and updates the store automatically. No polling needed.

3. **Source badge lookup:** A simple `Record<string, { label, color }>` maps source values to badge display. Events without a source show no badge (backward compat).

4. **Filter as derived state:** `useMemo` computes filtered events from the full event array + active filter mode. No separate state for filtered events.

## Deviations from Plan

None -- plan executed as written.

## Verification Results

- `npx tsc --noEmit` in jarvis-ui -- zero type errors
- `npx tsc --noEmit` in jarvis-backend -- zero type errors
- `npm run build` in jarvis-ui -- succeeds (518 modules, 913KB bundle)
- Source badges render with correct color classes
- Filter buttons toggle between ALL/AUTO/ALERTS with count display
- Kill switch button shows green/red states with StatusDot
- Optimistic toggle calls API with revert on error

## Phase 4 Complete

All 3 plans in Phase 4 (Autonomous Monitoring & Remediation) are now complete:

| Plan | Description | Status |
|------|-------------|--------|
| 04-01 | Monitor detection backbone (pollers, state tracker, thresholds) | Complete |
| 04-02 | Remediation engine, guardrails, email reporter | Complete |
| 04-03 | Frontend dashboard (ActivityFeed, kill switch toggle) | Complete |

**Phase outcome:** The operator can see what Jarvis is doing autonomously in real-time, distinguish autonomous actions from manual ones, filter the activity feed, and immediately stop all autonomous actions with one click.

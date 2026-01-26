---
phase: 02-real-time-dashboard-edex-ui-visual-identity
plan: 05
subsystem: ui
tags: [xterm.js, webgl, socket.io, terminal, ssh, react, hooks]

requires:
  - phase: 02-real-time-dashboard-edex-ui-visual-identity
    provides: Terminal store, auth store, socket service (createTerminalSocket), theme colors (XTERM_THEME)
  - phase: 01-backend-foundation-safety-layer
    provides: Socket.IO /terminal namespace with SSH PTY backend
provides:
  - useTerminal hook managing xterm.js lifecycle with WebGL rendering
  - TerminalPanel component with collapse/expand and connection controls
  - TerminalView component as xterm.js mount point
  - NodeSelector dropdown for all 4 cluster nodes
affects:
  - 02-06 (boot sequence may animate terminal panel)
  - Dashboard.tsx integration (wiring after Wave 2 completes)

tech-stack:
  added: []
  patterns: [xterm-webgl-with-dom-fallback, resize-observer-fit, single-session-enforcement, display-none-state-preservation]

key-files:
  created:
    - jarvis-ui/src/hooks/useTerminal.ts
    - jarvis-ui/src/components/right/TerminalPanel.tsx
    - jarvis-ui/src/components/right/TerminalView.tsx
    - jarvis-ui/src/components/right/NodeSelector.tsx
  modified: []

key-decisions:
  - "WebGL addon with try/catch DOM fallback -- context loss disposes WebGL addon gracefully"
  - "display:none for collapsed state preserves xterm.js instance (no re-create on expand)"
  - "ResizeObserver wrapped in requestAnimationFrame to avoid loop limit errors"
  - "Single session enforced at hook level -- connect() auto-disconnects previous session"

patterns-established:
  - "xterm-webgl-with-dom-fallback: Try WebglAddon, catch to DOM renderer, handle onContextLoss"
  - "single-session-enforcement: Hook-level guard ensures only one PTY connection at a time"
  - "display-none-state-preservation: Collapse hides via CSS display, preserving terminal buffer"

duration: 3min
completed: 2026-01-26
---

# Phase 2 Plan 5: Terminal Panel Summary

**xterm.js terminal panel with WebGL rendering, Socket.IO SSH PTY sessions, and 4-node cluster selector**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-26T09:04:20Z
- **Completed:** 2026-01-26T09:07:00Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- useTerminal hook manages full xterm.js lifecycle: creation, WebGL addon with DOM fallback, Socket.IO PTY streaming, resize handling, and proper cleanup
- TerminalPanel provides collapse/expand toggle, node selector dropdown, connection status, and disconnect controls
- NodeSelector lists all 4 cluster nodes (Home, pve, agent1, agent) with IPs for display
- Single session enforcement -- selecting a new node auto-disconnects the previous session

## Task Commits

Each task was committed atomically:

1. **Task 1: Create useTerminal hook with xterm.js lifecycle and Socket.IO PTY integration** - `e3b25ab` (feat)
2. **Task 2: Build TerminalPanel, TerminalView, and NodeSelector components** - `4c4ec4f` (feat)

## Files Created
- `jarvis-ui/src/hooks/useTerminal.ts` - xterm.js lifecycle hook with WebGL, Socket.IO PTY, resize, cleanup
- `jarvis-ui/src/components/right/TerminalPanel.tsx` - Terminal container with header, controls, collapse toggle
- `jarvis-ui/src/components/right/TerminalView.tsx` - xterm.js mount point wrapper div
- `jarvis-ui/src/components/right/NodeSelector.tsx` - Dropdown to pick SSH target node

## Decisions Made
- WebGL addon loaded in try/catch with onContextLoss handler -- if WebGL unavailable or context lost, falls back to DOM renderer automatically
- Collapsed state uses display:none rather than unmounting -- preserves xterm.js terminal instance and buffer contents
- ResizeObserver callback wrapped in requestAnimationFrame to avoid ResizeObserver loop limit exceeded errors
- Single session enforced in connect() -- if already connected, disconnect() is called before establishing new connection
- Node list hardcoded as constant array (matching backend config) -- 4 nodes with names and IPs

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None -- all type checks pass. The only TSC errors come from parallel Wave 2 plans (02-03, 02-04) creating files that reference each other, which is expected during parallel execution.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- Terminal components are standalone and ready to be wired into Dashboard.tsx right column after Wave 2 completes
- xterm.css imported directly in TerminalPanel.tsx (no index.css modification needed)
- Components consume stores and services from 02-01 and socket backend from 02-02

---
*Phase: 02-real-time-dashboard-edex-ui-visual-identity*
*Completed: 2026-01-26*

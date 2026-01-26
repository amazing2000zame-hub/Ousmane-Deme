---
phase: 02-real-time-dashboard-edex-ui-visual-identity
plan: 01
subsystem: ui
tags: [react, tailwindcss-v4, zustand, socket.io, typescript, vite, theme]

requires:
  - phase: 01-backend-foundation-safety-layer
    provides: Socket.IO namespaces (/cluster, /events), JWT auth, REST API, MCP tools
provides:
  - TypeScript types for cluster data (NodeData, VMData, StorageData, QuorumData)
  - TypeScript types for events (JarvisEvent, ToolExecution)
  - Zustand stores for cluster, auth, terminal, and UI state
  - Socket.IO hooks for /cluster and /events namespace connections
  - REST API client with JWT auth and tool execution
  - Theme infrastructure (visual modes, color constants, xterm.js theme)
  - Tailwind v4 with full JARVIS amber/gold color palette
affects:
  - 02-02 (backend emitter + tool endpoint)
  - 02-03 (layout + node grid components consume stores/hooks)
  - 02-04 (center panel consumes event store)
  - 02-05 (terminal panel uses socket service + terminal store)
  - 02-06 (boot sequence uses theme modes + UI store)

tech-stack:
  added: [tailwindcss@4, @tailwindcss/vite, zustand@5, socket.io-client@4, motion@12, sonner@2, react-hotkeys-hook@5, @xterm/xterm@6, @xterm/addon-webgl@0.19, @xterm/addon-fit@0.11, @redux-devtools/extension]
  patterns: [zustand-devtools-middleware, zustand-persist-middleware, singleton-socket-factory, named-socket-handlers, staleness-tracking, event-ring-buffer]

key-files:
  created:
    - jarvis-ui/src/types/cluster.ts
    - jarvis-ui/src/types/events.ts
    - jarvis-ui/src/stores/cluster.ts
    - jarvis-ui/src/stores/auth.ts
    - jarvis-ui/src/stores/terminal.ts
    - jarvis-ui/src/stores/ui.ts
    - jarvis-ui/src/theme/modes.ts
    - jarvis-ui/src/theme/colors.ts
    - jarvis-ui/src/services/socket.ts
    - jarvis-ui/src/services/api.ts
    - jarvis-ui/src/hooks/useClusterSocket.ts
    - jarvis-ui/src/hooks/useEventsSocket.ts
  modified:
    - jarvis-ui/package.json
    - jarvis-ui/vite.config.ts
    - jarvis-ui/src/index.css
    - jarvis-ui/src/App.tsx
    - jarvis-ui/src/main.tsx
    - jarvis-ui/index.html

key-decisions:
  - "Events stored in cluster store (not separate) with 100-item ring buffer"
  - "All socket handlers use named functions for reliable .off() cleanup"
  - "Auth persist only stores token (isAuthenticated derived on hydration)"
  - "UI store persists only visualMode (not bootComplete or focusedPanel)"

patterns-established:
  - "Zustand store with devtools: create<State>()(devtools((set, get) => ({...}), { name }))"
  - "Zustand persist with partialize: persist((set) => ({...}), { name, partialize })"
  - "Socket factory pattern: createXSocket(token) returns unconnected Socket"
  - "Socket hook pattern: useEffect with named handlers, connect(), cleanup with off()+disconnect()"
  - "Staleness tracking: lastUpdate Record<string, number> updated on every setter"
  - "REST API pattern: apiCall<T>(path, options, token) with generic return type"

duration: 6min
completed: 2026-01-26
---

# Phase 2 Plan 01: Frontend Infrastructure Summary

**Tailwind v4 with JARVIS amber/gold palette, Zustand state stores with devtools/persist, Socket.IO hooks for /cluster and /events namespaces, REST API client with JWT auth**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-26T08:50:12Z
- **Completed:** 2026-01-26T08:56:12Z
- **Tasks:** 3
- **Files modified:** 18

## Accomplishments

- Upgraded Tailwind v3 to v4 with CSS-first @theme configuration and full JARVIS color palette (11 colors, 3 glow shadows, 3 font families, 2 animation keyframes)
- Installed all Phase 2 runtime and dev dependencies (12 packages including xterm.js 6, zustand 5, motion 12, socket.io-client 4)
- Created 4 Zustand stores (cluster, auth, terminal, ui) with devtools middleware and staleness tracking
- Created Socket.IO hooks that auto-connect to backend namespaces with JWT auth and push data into stores
- Created REST API client with login(), apiCall(), and executeToolApi() functions
- Created theme infrastructure with 3 visual modes (JARVIS/Ops/Minimal) and xterm.js terminal theme

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade Tailwind v3 to v4 and install all Phase 2 dependencies** - `ede9a07` (feat) -- note: committed in prior session alongside backend work
2. **Task 2: Create TypeScript types, Zustand stores, and theme infrastructure** - `30aa86f` (feat)
3. **Task 3: Create Socket.IO hooks, REST API client, and socket service** - `83f408d` (feat)

## Files Created/Modified

- `jarvis-ui/src/types/cluster.ts` - TypeScript interfaces: NodeData, VMData, StorageData, QuorumData, ClusterNode
- `jarvis-ui/src/types/events.ts` - TypeScript interfaces: JarvisEvent, ToolExecution
- `jarvis-ui/src/stores/cluster.ts` - Zustand store for nodes, VMs, storage, quorum, events with staleness tracking
- `jarvis-ui/src/stores/auth.ts` - JWT token store with localStorage persistence
- `jarvis-ui/src/stores/terminal.ts` - Terminal session state (selectedNode, collapsed)
- `jarvis-ui/src/stores/ui.ts` - Visual mode + boot state + panel focus with mode persistence
- `jarvis-ui/src/theme/modes.ts` - VisualMode type and VISUAL_MODES feature flag config
- `jarvis-ui/src/theme/colors.ts` - Color constants and XTERM_THEME for programmatic use
- `jarvis-ui/src/services/socket.ts` - Socket.IO factory: createClusterSocket, createEventsSocket, createTerminalSocket
- `jarvis-ui/src/services/api.ts` - REST client: apiCall, login, executeToolApi
- `jarvis-ui/src/hooks/useClusterSocket.ts` - Auto-connect to /cluster, push data to store, handle token expiry
- `jarvis-ui/src/hooks/useEventsSocket.ts` - Auto-connect to /events, push events to ring buffer
- `jarvis-ui/package.json` - Updated dependencies (removed Tailwind v3, added all Phase 2 deps)
- `jarvis-ui/vite.config.ts` - Added @tailwindcss/vite plugin
- `jarvis-ui/src/index.css` - Full Tailwind v4 @theme with JARVIS palette, animations, base styles
- `jarvis-ui/src/App.tsx` - Minimal placeholder confirming Tailwind v4 works
- `jarvis-ui/src/main.tsx` - Cleaned up entry point
- `jarvis-ui/index.html` - Added JetBrains Mono font

## Decisions Made

- **Events in cluster store:** Added events array and addEvent action to cluster store rather than creating a separate events store. Simplifies subscriptions since events are closely tied to cluster data.
- **Ring buffer cap at 100:** Events capped at 100 items via slice(0, 100) on prepend. Prevents memory growth on long-running dashboard sessions.
- **Named socket handlers:** All socket.on() callbacks use named functions (onConnect, onNodes, etc.) instead of anonymous arrows. Required for socket.off() to work correctly and prevent WebSocket memory leaks.
- **Auth token-only persistence:** Auth store persists only the token string. isAuthenticated is derived state set in the setter, not persisted separately.
- **XTERM_THEME in colors.ts:** Terminal theme object exported alongside color constants for xterm.js configuration in Plan 02-05.

## Deviations from Plan

None -- plan executed exactly as written.

Note: Task 1 work was already committed in a prior session (commit ede9a07) alongside backend emitter work. The files were already in the correct state, so no additional changes were needed for Task 1.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- All TypeScript types, stores, hooks, and services are in place for UI component development
- Plans 02-03 through 02-06 can import from stores/, hooks/, services/, theme/, and types/
- Build passes with zero errors (tsc --noEmit + vite build)
- Socket.IO hooks ready to connect to backend once backend emitter is running (02-02)

---
*Phase: 02-real-time-dashboard-edex-ui-visual-identity*
*Completed: 2026-01-26*

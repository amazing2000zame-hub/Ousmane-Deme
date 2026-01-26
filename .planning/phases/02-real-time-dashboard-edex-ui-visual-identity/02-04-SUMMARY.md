---
phase: 02-real-time-dashboard-edex-ui-visual-identity
plan: 04
subsystem: ui
tags: [react, zustand, tailwind, vm-controls, storage-panel, activity-feed, confirm-dialog, glow-border]

# Dependency graph
requires:
  - phase: 02-01
    provides: TypeScript types, Zustand stores, Socket.IO hooks, REST API client
  - phase: 02-02
    provides: Tool execution endpoint, real-time data emitter, terminal namespace
  - phase: 02-03
    provides: PanelFrame, StatusDot, UsageBar, StalenessWarning shared components
provides:
  - VM/Container list with start/stop/restart lifecycle controls
  - Confirmation dialog for destructive operations
  - Storage overview panel with usage bars and threshold coloring
  - Activity feed with real-time event rendering and severity highlighting
  - Center display context switcher (ActivityFeed default)
  - Enhanced GlowBorder with cyan color, visual mode awareness, className prop
affects:
  - 02-06 (Dashboard wiring -- imports VMList, StoragePanel, CenterDisplay)
  - Phase 3 (CenterDisplay will switch between ActivityFeed and Jarvis Chat)
  - Phase 5 (GlowBorder cyan variant for hybrid intelligence indicators)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Status mapping: VMData.status -> StatusDot.status via toStatusDotStatus()"
    - "Destructive action gating: ConfirmDialog before stop/restart, immediate start"
    - "GlowBorder visual mode awareness: checks VISUAL_MODES[mode].glowEffects"
    - "Event severity highlighting: GlowBorder red for error/critical events"
    - "Toast notifications for async action feedback (sonner)"

key-files:
  created:
    - jarvis-ui/src/components/left/VMList.tsx
    - jarvis-ui/src/components/left/VMCard.tsx
    - jarvis-ui/src/components/left/StoragePanel.tsx
    - jarvis-ui/src/components/center/CenterDisplay.tsx
    - jarvis-ui/src/components/center/ActivityFeed.tsx
    - jarvis-ui/src/components/shared/ConfirmDialog.tsx
    - jarvis-ui/src/components/shared/GlowBorder.tsx
  modified: []

key-decisions:
  - "VMData status mapped to StatusDot status via switch (running->online, stopped->offline, paused->warning)"
  - "GlowBorder enhanced with cyan color and visual mode checks (Plan 02-03 created basic version, 02-04 added features)"
  - "ConfirmDialog uses Escape key and backdrop click for cancel (accessibility)"
  - "ActivityFeed auto-scrolls to top on new events (newest first)"

patterns-established:
  - "Destructive action gating: all stop/restart actions require ConfirmDialog confirmation"
  - "Status mapping pattern: VM/storage statuses map to StatusDot's online/offline/warning/unknown"
  - "Component-level flash feedback: brief GlowBorder flash on action success/failure"
  - "Named exports for all components (aligned with Plan 02-03 convention)"

# Metrics
duration: 5min
completed: 2026-01-26
---

# Phase 2 Plan 4: VM Controls, Storage Panel, Activity Feed Summary

**VM/CT lifecycle controls with confirmation dialogs, storage usage visualization, and real-time activity feed with severity-highlighted events**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-26T09:04:22Z
- **Completed:** 2026-01-26T09:09:47Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- VM/Container list with sorted display (running first), start/stop/restart controls wired to MCP tool execution API
- Confirmation dialog gates destructive operations (stop/restart) while start executes immediately
- Storage panel shows all pools with UsageBar threshold coloring and capacity text
- Activity feed renders real-time events with severity icons, GlowBorder highlights for error/critical
- GlowBorder enhanced with cyan color option, visual mode awareness, and className prop
- All components type-check with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Build VMList, VMCard with lifecycle controls, and ConfirmDialog** - `2244650` (feat)
2. **Task 2: Build StoragePanel, CenterDisplay, ActivityFeed, and GlowBorder** - `6018b75` (feat, committed by parallel 02-03 agent)

## Files Created/Modified
- `jarvis-ui/src/components/left/VMList.tsx` - Sorted VM/CT list with PanelFrame and StalenessWarning
- `jarvis-ui/src/components/left/VMCard.tsx` - Individual VM card with status, actions, toast feedback, GlowBorder flash
- `jarvis-ui/src/components/left/StoragePanel.tsx` - Storage pool list with UsageBar, capacity text, threshold coloring
- `jarvis-ui/src/components/center/CenterDisplay.tsx` - Context-aware center column (ActivityFeed default)
- `jarvis-ui/src/components/center/ActivityFeed.tsx` - Real-time event feed with severity icons and GlowBorder highlights
- `jarvis-ui/src/components/shared/ConfirmDialog.tsx` - Modal confirmation with warning/danger variants, Escape/backdrop dismiss
- `jarvis-ui/src/components/shared/GlowBorder.tsx` - Enhanced glow wrapper with cyan, visual mode, className

## Decisions Made
- **VMData -> StatusDot mapping**: Created `toStatusDotStatus()` helper since StatusDot uses `online/offline/warning/unknown` while VMData uses `running/stopped/paused`. This is a clean adapter pattern.
- **GlowBorder enhancement**: Plan 02-03 created a basic GlowBorder; 02-04 enhanced it with cyan color, `VISUAL_MODES` awareness, and className prop. This is additive, not a conflict.
- **Named exports everywhere**: Aligned with Plan 02-03's convention of named exports for all components (no default exports).
- **ConfirmDialog accessibility**: Added Escape key listener and backdrop click dismiss per WCAG dialog patterns.

## Deviations from Plan

### Parallel Execution Convergence

The parallel Plan 02-03 agent preemptively created several files that were specified as 02-04 deliverables (VMCard.tsx, StoragePanel.tsx, ActivityFeed.tsx, CenterDisplay.tsx, GlowBorder.tsx). The content was identical to what 02-04 produced independently.

**Impact:** Task 2 files were already committed by 02-03's second task (`6018b75`). No additional commit needed for Task 2. Task 1 commit (`2244650`) properly added VMList.tsx, ConfirmDialog.tsx, and enhanced GlowBorder.tsx.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Parallel agent convergence eliminated redundant commits. All deliverables present and correct.

## Issues Encountered
- StatusDot from Plan 02-03 uses different status types than VMData -- resolved with `toStatusDotStatus()` mapping function
- Plan 02-03 used named exports (not default) for all shared components -- aligned all imports accordingly

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All left column components ready: NodeGrid (02-03), VMList (02-04), StoragePanel (02-04)
- Center column ActivityFeed ready, CenterDisplay provides future switch point for Phase 3 chat
- All components ready for Dashboard.tsx wiring in Plan 02-06
- GlowBorder ready for TerminalPanel integration (02-05 already uses it)

---
*Phase: 02-real-time-dashboard-edex-ui-visual-identity*
*Completed: 2026-01-26*

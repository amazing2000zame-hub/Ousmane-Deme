import { TopBar } from './TopBar';
import { NodeGrid } from '../left/NodeGrid';

/**
 * Dashboard layout shell with 3-column CSS grid.
 *
 * Section ownership across plans:
 * - Plan 02-03 (this): Creates the 3-column grid shell. Left column has NodeGrid.
 *   Center and right columns are placeholders.
 * - Plan 02-04: Adds VMList and StoragePanel to LEFT column (below NodeGrid).
 *   Replaces center placeholder with CenterDisplay. Does NOT modify right column.
 * - Plan 02-05: Replaces right placeholder with TerminalPanel.
 *   Does NOT modify left or center columns.
 * - Plan 02-06: Adds responsive breakpoints, keyboard nav, data-panel attributes.
 */
export function Dashboard() {
  return (
    <div className="flex flex-col h-screen bg-jarvis-bg">
      <TopBar />

      <div className="flex-1 grid grid-cols-[320px_1fr_380px] min-h-0">
        {/* Left column: Infrastructure panels */}
        <aside className="overflow-y-auto p-2 space-y-2">
          <NodeGrid />
        </aside>

        {/* Center column: Placeholder for CenterDisplay (Plan 02-04) */}
        <main className="overflow-y-auto border-x border-jarvis-amber/10 flex items-center justify-center">
          <span className="font-display text-jarvis-text-muted text-lg tracking-[0.3em]">
            JARVIS DISPLAY
          </span>
        </main>

        {/* Right column: Placeholder for TerminalPanel (Plan 02-05) */}
        <aside className="overflow-y-auto flex items-center justify-center">
          <span className="font-display text-jarvis-text-muted text-lg tracking-[0.3em]">
            TERMINAL
          </span>
        </aside>
      </div>
    </div>
  );
}

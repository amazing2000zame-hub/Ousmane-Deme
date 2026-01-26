import { TopBar } from './TopBar';
import { NodeGrid } from '../left/NodeGrid';
import { VMList } from '../left/VMList';
import { StoragePanel } from '../left/StoragePanel';
import { CenterDisplay } from '../center/CenterDisplay';
import TerminalPanel from '../right/TerminalPanel';
import { CostPanel } from '../right/CostPanel';
import { useKeyboardNav } from '../../hooks/useKeyboardNav';
import { useTerminalStore } from '../../stores/terminal';

export function Dashboard() {
  // Register keyboard shortcuts at Dashboard level
  useKeyboardNav();

  const isCollapsed = useTerminalStore((s) => s.isCollapsed);

  // Dynamic right column width for desktop breakpoints (0 when collapsed)
  const rightXl = isCollapsed ? '0px' : '380px';
  const rightLg = isCollapsed ? '0px' : '320px';

  return (
    <div className="flex flex-col h-screen bg-jarvis-bg">
      <TopBar />

      {/* Inject dynamic grid-template-columns for collapsed terminal state */}
      <style>{`
        @media (min-width: 1280px) {
          .jarvis-grid { grid-template-columns: 320px 1fr ${rightXl} !important; }
        }
        @media (min-width: 1024px) and (max-width: 1279px) {
          .jarvis-grid { grid-template-columns: 280px 1fr ${rightLg} !important; }
        }
      `}</style>

      {/* Responsive 3-column grid:
          Desktop (>=1280): 320px / 1fr / 380px (or 40px collapsed)
          Laptop (>=1024): 280px / 1fr / 320px (or 40px collapsed)
          Tablet (>=768): 300px / 1fr (terminal below)
          Mobile (<768): single column stacked
      */}
      <div
        className="jarvis-grid flex-1 min-h-0 grid
          max-md:grid-cols-1
          md:grid-cols-[300px_1fr]
          lg:grid-cols-[280px_1fr_320px]
          xl:grid-cols-[320px_1fr_380px]"
      >
        {/* Left column: Infrastructure panels */}
        <aside
          className="overflow-y-auto p-2 space-y-2"
          data-panel="left"
        >
          <NodeGrid />
          <VMList />
          <StoragePanel />
        </aside>

        {/* Center column: Activity feed */}
        <main
          className="overflow-y-auto border-x border-jarvis-amber/10"
          data-panel="center"
        >
          <CenterDisplay />
        </main>

        {/* Right column: Cost panel + Terminal (0-width when collapsed, stays mounted for xterm state) */}
        <aside
          className="flex flex-col min-h-0 max-md:border-t max-md:border-jarvis-amber/10 overflow-hidden"
          data-panel="right"
        >
          <div className="shrink-0 overflow-y-auto max-h-[40%]">
            <CostPanel />
          </div>
          <TerminalPanel />
        </aside>
      </div>
    </div>
  );
}

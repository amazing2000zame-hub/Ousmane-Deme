import { TopBar } from './TopBar';
import { NodeGrid } from '../left/NodeGrid';
import { VMList } from '../left/VMList';
import { StoragePanel } from '../left/StoragePanel';
import { CenterDisplay } from '../center/CenterDisplay';
import TerminalPanel from '../right/TerminalPanel';

export function Dashboard() {
  return (
    <div className="flex flex-col h-screen bg-jarvis-bg">
      <TopBar />

      <div className="flex-1 grid grid-cols-[320px_1fr_380px] min-h-0">
        {/* Left column: Infrastructure panels */}
        <aside className="overflow-y-auto p-2 space-y-2">
          <NodeGrid />
          <VMList />
          <StoragePanel />
        </aside>

        {/* Center column: Activity feed */}
        <main className="overflow-y-auto border-x border-jarvis-amber/10">
          <CenterDisplay />
        </main>

        {/* Right column: Terminal */}
        <aside className="flex flex-col min-h-0">
          <TerminalPanel />
        </aside>
      </div>
    </div>
  );
}

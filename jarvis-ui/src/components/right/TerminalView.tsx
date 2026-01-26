/** Wrapper div for the xterm.js terminal mount point */

interface TerminalViewProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export default function TerminalView({ containerRef }: TerminalViewProps) {
  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 bg-jarvis-bg rounded overflow-hidden"
    />
  );
}

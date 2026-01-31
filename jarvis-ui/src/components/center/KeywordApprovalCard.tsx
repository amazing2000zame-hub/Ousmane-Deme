import { useState } from 'react';
import { GlowBorder } from '../shared/GlowBorder';

interface KeywordApprovalCardProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  tier: string;
  keywordHint?: string;
  onApprove: (toolUseId: string, keyword: string) => void;
  onDeny: (toolUseId: string) => void;
  disabled?: boolean;
}

/**
 * Generate a human-readable action description from tool name and input params.
 */
function describeAction(toolName: string, input: Record<string, unknown>): string {
  const node = input.node as string | undefined;
  const path = input.path as string | undefined;
  const service = input.service as string | undefined;
  const packages = input.packages as string[] | undefined;
  const command = input.command as string | undefined;
  const onNode = node ? ` on ${node}` : '';

  const descriptions: Record<string, string> = {
    delete_file: `Delete ${path ?? 'file'}${onNode}`,
    execute_command: `Execute: ${command?.slice(0, 50) ?? '(command)'}${onNode}`,
    install_package: `Install packages: ${packages?.join(', ') ?? ''}${onNode}`,
    manage_service: `${input.action ?? 'manage'} ${service ?? 'service'}${onNode}`,
    reboot_node: `Reboot node ${node ?? '?'}`,
  };

  return descriptions[toolName] ?? `Execute ${toolName}`;
}

/**
 * Interactive keyword approval card for ORANGE-tier tool actions.
 * Requires the user to type a specific keyword to confirm execution.
 */
export function KeywordApprovalCard({
  toolName,
  toolInput,
  toolUseId,
  tier,
  keywordHint,
  onApprove,
  onDeny,
  disabled,
}: KeywordApprovalCardProps) {
  const [responded, setResponded] = useState<'approved' | 'denied' | null>(null);
  const [keyword, setKeyword] = useState('');
  const [showHint, setShowHint] = useState(false);

  const handleApprove = () => {
    if (!keyword.trim()) return;
    setResponded('approved');
    onApprove(toolUseId, keyword.trim());
  };

  const handleDeny = () => {
    setResponded('denied');
    onDeny(toolUseId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && keyword.trim()) {
      handleApprove();
    }
  };

  const isDisabled = disabled || responded !== null;

  // Filter out empty/undefined values for display
  const params = Object.entries(toolInput).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );

  return (
    <GlowBorder color="amber" intensity="high" active className="my-2">
      <div className="bg-jarvis-bg-panel/80 border border-orange-500/40 rounded p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-orange-400 font-display text-xs tracking-widest uppercase">
            Keyword Approval Required
          </span>
          <span className="text-[9px] font-display tracking-wider uppercase px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-400/30">
            {tier.toUpperCase()}
          </span>
        </div>

        {/* Warning banner */}
        <div className="bg-orange-500/10 border border-orange-500/20 rounded px-2 py-1.5 mb-3">
          <p className="text-orange-300/90 text-[11px] font-mono">
            This is a dangerous operation that requires keyword confirmation.
          </p>
        </div>

        {/* Action description */}
        <p className="text-jarvis-text text-sm font-mono mb-2">
          {describeAction(toolName, toolInput)}
        </p>

        {/* Tool name + params */}
        <div className="mb-3">
          <span className="text-jarvis-text-dim text-[10px] font-mono">{toolName}</span>
          {params.length > 0 && (
            <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 max-h-24 overflow-y-auto">
              {params.map(([key, val]) => (
                <div key={key} className="contents">
                  <span className="text-jarvis-text-muted text-xs font-mono">{key}:</span>
                  <span className="text-jarvis-text-dim text-xs font-mono truncate" title={String(val)}>
                    {String(val).slice(0, 100)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Response area */}
        {responded ? (
          <div
            className={`text-xs font-display tracking-wider uppercase ${
              responded === 'approved' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {responded === 'approved' ? 'Keyword Approved' : 'Denied'}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Keyword input */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isDisabled}
                placeholder="Type approval keyword..."
                className="flex-1 bg-jarvis-bg/50 border border-jarvis-text-muted/30 rounded px-2 py-1.5 text-xs font-mono text-jarvis-text placeholder:text-jarvis-text-muted/50 focus:outline-none focus:border-orange-500/50 disabled:opacity-40"
                autoFocus
              />
            </div>

            {/* Hint toggle */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowHint(!showHint)}
                className="text-[10px] text-jarvis-text-muted hover:text-jarvis-amber underline"
              >
                {showHint ? 'Hide hint' : 'Show hint'}
              </button>
              {showHint && keywordHint && (
                <span className="text-[10px] font-mono text-jarvis-text-dim">
                  Hint: {keywordHint}
                </span>
              )}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleApprove}
                disabled={isDisabled || !keyword.trim()}
                className="bg-orange-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 px-4 py-1.5 text-xs font-display tracking-wider rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                APPROVE
              </button>
              <button
                onClick={handleDeny}
                disabled={isDisabled}
                className="bg-transparent border border-jarvis-text-muted/30 text-jarvis-text-dim hover:text-jarvis-text px-4 py-1.5 text-xs font-display tracking-wider rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                DENY
              </button>
            </div>
          </div>
        )}
      </div>
    </GlowBorder>
  );
}

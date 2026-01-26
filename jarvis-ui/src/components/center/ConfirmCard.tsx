import { useState } from 'react';
import { GlowBorder } from '../shared/GlowBorder';

interface ConfirmCardProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  tier: string;
  onConfirm: (toolUseId: string) => void;
  onDeny: (toolUseId: string) => void;
  disabled?: boolean;
}

/**
 * Generate a human-readable action description from tool name and input params.
 */
function describeAction(toolName: string, input: Record<string, unknown>): string {
  const node = input.node as string | undefined;
  const vmid = input.vmid as string | number | undefined;
  const onNode = node ? ` on node ${node}` : '';

  const descriptions: Record<string, string> = {
    start_vm: `Start VM ${vmid ?? '?'}${onNode}`,
    stop_vm: `Stop VM ${vmid ?? '?'}${onNode}`,
    restart_vm: `Restart VM ${vmid ?? '?'}${onNode}`,
    start_container: `Start container ${vmid ?? '?'}${onNode}`,
    stop_container: `Stop container ${vmid ?? '?'}${onNode}`,
    restart_container: `Restart container ${vmid ?? '?'}${onNode}`,
  };

  return descriptions[toolName] ?? `Execute ${toolName}`;
}

/**
 * Interactive confirmation card for RED-tier tool actions.
 * Displays AUTHORIZE / DENY buttons and the action details.
 * After the operator responds, shows the result instead of buttons.
 */
export function ConfirmCard({
  toolName,
  toolInput,
  toolUseId,
  tier,
  onConfirm,
  onDeny,
  disabled,
}: ConfirmCardProps) {
  const [responded, setResponded] = useState<'authorized' | 'denied' | null>(null);

  const handleConfirm = () => {
    setResponded('authorized');
    onConfirm(toolUseId);
  };

  const handleDeny = () => {
    setResponded('denied');
    onDeny(toolUseId);
  };

  const isDisabled = disabled || responded !== null;

  // Filter out empty/undefined values for display
  const params = Object.entries(toolInput).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );

  return (
    <GlowBorder color="amber" intensity="medium" active className="my-2">
      <div className="bg-jarvis-bg-panel/80 border border-jarvis-amber/30 rounded p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-jarvis-orange font-display text-xs tracking-widest uppercase">
            Authorization Required
          </span>
          <span className="text-[9px] font-display tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-400/30">
            {tier.toUpperCase()}
          </span>
        </div>

        {/* Action description */}
        <p className="text-jarvis-text text-sm font-mono mb-2">
          {describeAction(toolName, toolInput)}
        </p>

        {/* Tool name + params */}
        <div className="mb-3">
          <span className="text-jarvis-text-dim text-[10px] font-mono">{toolName}</span>
          {params.length > 0 && (
            <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {params.map(([key, val]) => (
                <div key={key} className="contents">
                  <span className="text-jarvis-text-muted text-xs font-mono">{key}:</span>
                  <span className="text-jarvis-text-dim text-xs font-mono">{String(val)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Buttons or result */}
        {responded ? (
          <div
            className={`text-xs font-display tracking-wider uppercase ${
              responded === 'authorized' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {responded === 'authorized' ? 'Authorized' : 'Denied'}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={isDisabled}
              className="bg-jarvis-amber/20 border border-jarvis-amber/40 text-jarvis-amber hover:bg-jarvis-amber/30 px-4 py-1.5 text-xs font-display tracking-wider rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              AUTHORIZE
            </button>
            <button
              onClick={handleDeny}
              disabled={isDisabled}
              className="bg-transparent border border-jarvis-text-muted/30 text-jarvis-text-dim hover:text-jarvis-text px-4 py-1.5 text-xs font-display tracking-wider rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              DENY
            </button>
          </div>
        )}
      </div>
    </GlowBorder>
  );
}

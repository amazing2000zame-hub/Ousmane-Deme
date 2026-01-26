import { GlowBorder } from '../shared/GlowBorder';

interface BlockedCardProps {
  toolName: string;
  reason: string;
  tier: string;
}

/**
 * Blocked action explanation card for BLACK-tier tools.
 * Informational only -- no interactive elements.
 * Shows why the action was blocked and the tool that triggered it.
 */
export function BlockedCard({ toolName, reason, tier }: BlockedCardProps) {
  return (
    <GlowBorder color="red" intensity="low" active className="my-2">
      <div className="bg-jarvis-bg-panel/80 border border-red-400/30 rounded p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-red-400 font-display text-xs tracking-widest uppercase">
            Action Blocked
          </span>
          <span className="text-[9px] font-display tracking-wider uppercase px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-400/30">
            {tier.toUpperCase()}
          </span>
        </div>

        {/* Tool name */}
        <span className="text-jarvis-text-dim text-[10px] font-mono">{toolName}</span>

        {/* Reason */}
        {reason && (
          <p className="text-jarvis-text-dim text-xs mt-1.5 leading-relaxed">{reason}</p>
        )}
      </div>
    </GlowBorder>
  );
}

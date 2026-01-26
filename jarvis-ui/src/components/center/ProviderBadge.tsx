/**
 * Provider badge for chat messages.
 * Shows which LLM generated the response (Claude or Qwen).
 */

interface ProviderBadgeProps {
  provider: 'claude' | 'qwen';
}

const PROVIDER_CONFIG = {
  claude: {
    label: 'CLAUDE',
    color: '#D4A574',
    icon: '\u{1F9E0}', // brain emoji
  },
  qwen: {
    label: 'QWEN LOCAL',
    color: '#00D9FF',
    icon: '\u26A1', // lightning emoji
  },
} as const;

export function ProviderBadge({ provider }: ProviderBadgeProps) {
  const cfg = PROVIDER_CONFIG[provider];

  return (
    <span
      className="inline-flex items-center gap-1 font-display"
      style={{
        padding: '1px 6px',
        borderRadius: '3px',
        border: `1px solid ${cfg.color}33`,
        color: cfg.color,
        fontSize: '9px',
        letterSpacing: '0.5px',
        opacity: 0.8,
      }}
    >
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </span>
  );
}

import { memo } from 'react';
import { useClusterStore } from '../../stores/cluster';
import { StatusDot } from '../shared/StatusDot';
import type { VoiceAgentState } from '../../types/cluster';

const STATE_LABELS: Record<VoiceAgentState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  capturing: 'Capturing',
  processing: 'Processing',
  speaking: 'Speaking',
};

const STATE_COLORS: Record<VoiceAgentState, string> = {
  idle: 'text-jarvis-text-dim',
  listening: 'text-jarvis-green',
  capturing: 'text-jarvis-orange',
  processing: 'text-jarvis-amber',
  speaking: 'text-jarvis-blue',
};

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export const VoiceAgentPanel = memo(function VoiceAgentPanel() {
  const voiceAgents = useClusterStore((s) => s.voiceAgents);

  const connected = voiceAgents.filter((a) => a.connected);

  return (
    <div className="bg-jarvis-bg-card border border-jarvis-amber/10 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-display text-jarvis-amber/80 uppercase tracking-wider">
          Voice Agents
        </h3>
        <span className="text-[10px] font-mono text-jarvis-text-dim">
          {connected.length} online
        </span>
      </div>

      {voiceAgents.length === 0 ? (
        <div className="text-xs text-jarvis-text-dim font-mono py-1">
          No agents connected
        </div>
      ) : (
        <div className="space-y-1.5">
          {voiceAgents.map((agent) => (
            <div
              key={agent.agentId}
              className="flex items-center justify-between py-1"
            >
              <div className="flex items-center gap-2">
                <StatusDot
                  status={agent.connected ? 'online' : 'offline'}
                  size="sm"
                  pulse={agent.state === 'listening' || agent.state === 'capturing'}
                />
                <span className="text-xs font-mono text-jarvis-text truncate max-w-[100px]">
                  jarvis-ear
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={'text-[10px] font-mono ' + STATE_COLORS[agent.state]}>
                  {STATE_LABELS[agent.state]}
                </span>
                <span className="text-[9px] font-mono text-jarvis-text-dim">
                  {formatTimeSince(agent.lastInteractionAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

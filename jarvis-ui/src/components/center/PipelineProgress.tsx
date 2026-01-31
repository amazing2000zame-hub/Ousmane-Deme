/**
 * Pipeline progress indicator — shows current stage in the
 * Jarvis chat pipeline (routing → thinking → voice → done).
 * Appears during streaming, auto-hides when idle.
 */

import { useChatStore, type PipelineStage } from '../../stores/chat';
import { useVoiceStore } from '../../stores/voice';

interface StageConfig {
  key: PipelineStage;
  label: string;
}

const STAGES_VOICE: StageConfig[] = [
  { key: 'routing', label: 'Route' },
  { key: 'thinking', label: 'Think' },
  { key: 'synthesizing', label: 'Voice' },
  { key: 'complete', label: 'Done' },
];

const STAGES_TEXT: StageConfig[] = [
  { key: 'routing', label: 'Route' },
  { key: 'thinking', label: 'Think' },
  { key: 'complete', label: 'Done' },
];

/** Map pipeline stage to its position in the stage list */
function stageIndex(stage: PipelineStage, stages: StageConfig[]): number {
  // 'executing' is a sub-state of 'thinking'
  const mapped = stage === 'executing' ? 'thinking' : stage === 'speaking' ? 'synthesizing' : stage;
  const idx = stages.findIndex((s) => s.key === mapped);
  return idx >= 0 ? idx : -1;
}

export function PipelineProgress() {
  const pipelineStage = useChatStore((s) => s.pipelineStage);
  const pipelineDetail = useChatStore((s) => s.pipelineDetail);
  const voiceEnabled = useVoiceStore((s) => s.enabled);

  if (pipelineStage === 'idle') return null;

  const stages = voiceEnabled ? STAGES_VOICE : STAGES_TEXT;
  const activeIdx = stageIndex(pipelineStage, stages);

  // Build detail text for current stage
  let detailText = '';
  if (pipelineStage === 'routing') {
    detailText = 'Routing...';
  } else if (pipelineStage === 'thinking' && pipelineDetail) {
    detailText = pipelineDetail === 'claude' ? 'Claude (agentic)' : pipelineDetail === 'qwen' ? 'Qwen (local)' : pipelineDetail;
  } else if (pipelineStage === 'executing' && pipelineDetail) {
    detailText = pipelineDetail;
  } else if (pipelineStage === 'synthesizing') {
    detailText = 'XTTS';
  } else if (pipelineStage === 'speaking') {
    detailText = 'Playing';
  } else if (pipelineStage === 'complete') {
    detailText = 'Complete';
  }

  return (
    <div className="px-3 py-1.5 flex flex-col items-center gap-1 select-none">
      {/* Stage dots + connecting lines */}
      <div className="flex items-center gap-0">
        {stages.map((s, i) => {
          const isCompleted = activeIdx > i || pipelineStage === 'complete';
          const isActive = activeIdx === i && pipelineStage !== 'complete';
          const isFuture = activeIdx < i && pipelineStage !== 'complete';

          return (
            <div key={s.key} className="flex items-center">
              {/* Connecting line (before dot, skip first) */}
              {i > 0 && (
                <div
                  className={`h-px w-6 sm:w-10 transition-colors duration-300 ${
                    isCompleted || isActive ? 'bg-jarvis-amber/60' : 'bg-jarvis-text-muted/30'
                  }`}
                />
              )}
              {/* Dot + label column */}
              <div className="flex flex-col items-center min-w-[40px]">
                <div
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    isCompleted
                      ? 'bg-jarvis-green shadow-jarvis-glow-green-xs'
                      : isActive
                        ? 'bg-jarvis-amber shadow-jarvis-glow-xs animate-pulse'
                        : 'bg-jarvis-text-muted/40'
                  }`}
                />
                <span
                  className={`text-[9px] font-display tracking-wider mt-0.5 transition-colors duration-300 ${
                    isCompleted
                      ? 'text-jarvis-green'
                      : isActive
                        ? 'text-jarvis-amber'
                        : isFuture
                          ? 'text-jarvis-text-muted/50'
                          : 'text-jarvis-text-dim'
                  }`}
                >
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail text */}
      {detailText && pipelineStage !== 'complete' && (
        <span className="text-[9px] font-mono text-jarvis-amber-dim truncate max-w-[200px]">
          {detailText}
        </span>
      )}
    </div>
  );
}

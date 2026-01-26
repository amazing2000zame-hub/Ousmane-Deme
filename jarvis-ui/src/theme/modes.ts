export type VisualMode = 'jarvis' | 'ops' | 'minimal';

export interface VisualModeConfig {
  scanLines: boolean;
  glowEffects: boolean;
  ambientAnimations: boolean;
  borderGlow: boolean;
  bootSequence: boolean;
}

export const VISUAL_MODES: Record<VisualMode, VisualModeConfig> = {
  jarvis: {
    scanLines: true,
    glowEffects: true,
    ambientAnimations: true,
    borderGlow: true,
    bootSequence: true,
  },
  ops: {
    scanLines: false,
    glowEffects: true,
    ambientAnimations: false,
    borderGlow: true,
    bootSequence: false,
  },
  minimal: {
    scanLines: false,
    glowEffects: false,
    ambientAnimations: false,
    borderGlow: false,
    bootSequence: false,
  },
};

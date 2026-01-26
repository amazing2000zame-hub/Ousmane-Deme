/** Color token constants for programmatic use (e.g., xterm.js theme, chart colors) */

// Amber/Gold Palette
export const JARVIS_AMBER = '#ffb800';
export const JARVIS_GOLD = '#ffd866';
export const JARVIS_AMBER_DIM = '#b38200';
export const JARVIS_ORANGE = '#ff6b00';
export const JARVIS_RED = '#ff3333';
export const JARVIS_GREEN = '#33ff88';
export const JARVIS_CYAN = '#00d4ff';

// Background Layers
export const JARVIS_BG = '#0a0a0f';
export const JARVIS_BG_PANEL = '#0d0d14';
export const JARVIS_BG_CARD = '#111118';
export const JARVIS_BG_HOVER = '#16161f';

// Text
export const JARVIS_TEXT = '#e8e0d0';
export const JARVIS_TEXT_DIM = '#7a7060';
export const JARVIS_TEXT_MUTED = '#4a4540';

/** xterm.js terminal theme configuration */
export const XTERM_THEME = {
  background: JARVIS_BG,
  foreground: '#e0d9c6',
  cursor: JARVIS_AMBER,
  selectionBackground: 'rgba(255, 184, 0, 0.3)',
  black: '#0a0a0f',
  red: JARVIS_RED,
  green: JARVIS_GREEN,
  yellow: JARVIS_AMBER,
  blue: JARVIS_CYAN,
  magenta: '#c678dd',
  cyan: JARVIS_CYAN,
  white: JARVIS_TEXT,
  brightBlack: '#4a4540',
  brightRed: '#ff5555',
  brightGreen: '#50fa7b',
  brightYellow: JARVIS_GOLD,
  brightBlue: '#61afef',
  brightMagenta: '#ff79c6',
  brightCyan: '#8be9fd',
  brightWhite: '#ffffff',
} as const;

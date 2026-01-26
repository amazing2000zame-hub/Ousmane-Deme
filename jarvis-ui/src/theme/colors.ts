/** Read a CSS custom property from the document root */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Build an xterm.js theme from the current CSS custom properties.
 * Call this when creating the terminal or when the color theme changes.
 */
export function getXtermTheme() {
  const amber = cssVar('--color-jarvis-amber', '#ffb800');
  const gold = cssVar('--color-jarvis-gold', '#ffd866');
  const bg = cssVar('--color-jarvis-bg', '#0a0a0f');
  const text = cssVar('--color-jarvis-text', '#e8e0d0');
  const textMuted = cssVar('--color-jarvis-text-muted', '#4a4540');
  const red = cssVar('--color-jarvis-red', '#ff3333');
  const green = cssVar('--color-jarvis-green', '#33ff88');
  const cyan = cssVar('--color-jarvis-cyan', '#00d4ff');

  return {
    background: bg,
    foreground: text,
    cursor: amber,
    selectionBackground: `color-mix(in srgb, ${amber} 30%, transparent)`,
    black: bg,
    red,
    green,
    yellow: amber,
    blue: cyan,
    magenta: '#c678dd',
    cyan,
    white: text,
    brightBlack: textMuted,
    brightRed: '#ff5555',
    brightGreen: '#50fa7b',
    brightYellow: gold,
    brightBlue: '#61afef',
    brightMagenta: '#ff79c6',
    brightCyan: '#8be9fd',
    brightWhite: '#ffffff',
  };
}

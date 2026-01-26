import { useUIStore, type ColorTheme } from '../../stores/ui';

const THEMES: { key: ColorTheme; color: string; label: string }[] = [
  { key: 'amber', color: '#ffb800', label: 'AMB' },
  { key: 'cyan', color: '#00d4ff', label: 'CYN' },
  { key: 'green', color: '#33ff88', label: 'GRN' },
  { key: 'purple', color: '#b366ff', label: 'PRP' },
  { key: 'red', color: '#ff3333', label: 'RED' },
];

/** Hexagonal clip-path */
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

/**
 * Iron Man-inspired hexagonal theme picker arranged in a subtle arc.
 * Active theme glows and shows its label. Replaces plain dot swatches.
 */
export function RadialThemePicker() {
  const colorTheme = useUIStore((s) => s.colorTheme);
  const setColorTheme = useUIStore((s) => s.setColorTheme);

  return (
    <div className="flex items-end gap-1.5">
      {THEMES.map(({ key, color, label }, i) => {
        const isActive = colorTheme === key;
        // Subtle arc: middle items raised slightly
        const yOffset = [2, 0.5, 0, 0.5, 2][i];

        return (
          <button
            key={key}
            type="button"
            title={label}
            onClick={() => setColorTheme(key)}
            className="flex flex-col items-center transition-all duration-200"
            style={{ marginBottom: yOffset }}
          >
            {/* Hexagonal swatch */}
            <div
              className="transition-all duration-200"
              style={{
                width: isActive ? 16 : 12,
                height: isActive ? 16 : 12,
                clipPath: HEX_CLIP,
                backgroundColor: isActive ? color : 'transparent',
                border: `1.5px solid ${color}`,
                boxShadow: isActive ? `0 0 8px ${color}80, 0 0 4px ${color}40` : 'none',
                transform: isActive ? 'scale(1.2)' : 'scale(1)',
              }}
            />
            {/* Label visible only for active theme */}
            {isActive && (
              <span
                className="font-display tracking-wider mt-0.5 leading-none"
                style={{
                  fontSize: '6px',
                  color,
                  textShadow: `0 0 4px ${color}60`,
                }}
              >
                {label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

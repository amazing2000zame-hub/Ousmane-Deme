import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';

interface WireframeGlobeProps {
  size?: number;
}

/** Longitude ring angles (6 great circles, 30deg apart) */
const LONGITUDES = [0, 30, 60, 90, 120, 150];

/** Latitude ring offsets (5 parallels including equator) */
const LATITUDES = [
  { angle: 0, scale: 1, opacity: 0.5 },      // equator
  { angle: 30, scale: 0.866, opacity: 0.25 }, // 30N
  { angle: -30, scale: 0.866, opacity: 0.25 },// 30S
  { angle: 55, scale: 0.574, opacity: 0.15 }, // 55N
  { angle: -55, scale: 0.574, opacity: 0.15 },// 55S
];

/**
 * CSS 3D wireframe globe -- rings of div circles arranged in 3D space
 * and rotated continuously via CSS keyframe animation.
 * GPU-composited: only transforms are animated.
 */
export function WireframeGlobe({ size = 200 }: WireframeGlobeProps) {
  const visualMode = useUIStore((s) => s.visualMode);
  const modeConfig = VISUAL_MODES[visualMode];

  // Minimal mode: static single ring outline
  if (!modeConfig.glowEffects && !modeConfig.ambientAnimations) {
    return (
      <div
        className="rounded-full border border-jarvis-amber/20 mx-auto"
        style={{ width: size, height: size }}
      />
    );
  }

  const animationName = modeConfig.ambientAnimations ? 'globeSpin' : 'globeSpinSlow';
  const duration = modeConfig.ambientAnimations ? '20s' : '40s';

  return (
    <div
      className="relative mx-auto"
      style={{
        width: size,
        height: size,
        perspective: '800px',
      }}
    >
      {/* Glow backdrop */}
      {modeConfig.glowEffects && (
        <div
          className="absolute pointer-events-none"
          style={{
            inset: '-25%',
            background: 'radial-gradient(circle, color-mix(in srgb, var(--color-jarvis-amber) 8%, transparent), transparent 70%)',
          }}
        />
      )}

      {/* Rotating sphere container */}
      <div
        style={{
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          willChange: 'transform',
          animation: `${animationName} ${duration} linear infinite`,
        }}
      >
        {/* Longitude rings (great circles rotated around Y) */}
        {LONGITUDES.map((deg) => (
          <div
            key={`lng-${deg}`}
            className="absolute inset-0 rounded-full"
            style={{
              border: '1px solid color-mix(in srgb, var(--color-jarvis-amber) 30%, transparent)',
              transform: `rotateY(${deg}deg)`,
            }}
          />
        ))}

        {/* Latitude rings (circles at different heights, rotated to horizontal) */}
        {LATITUDES.map(({ angle, scale, opacity }) => {
          const r = size / 2;
          const absAngleRad = Math.abs(angle) * (Math.PI / 180);
          const yOffset = r * Math.sin(absAngleRad) * (angle < 0 ? 1 : -1);
          const ringSize = size * scale;
          const isEquator = angle === 0;

          return (
            <div
              key={`lat-${angle}`}
              className="absolute rounded-full"
              style={{
                width: ringSize,
                height: ringSize,
                left: (size - ringSize) / 2,
                top: (size - ringSize) / 2,
                border: isEquator
                  ? '2px solid color-mix(in srgb, var(--color-jarvis-amber) 60%, transparent)'
                  : `1px solid color-mix(in srgb, var(--color-jarvis-amber) ${Math.round(opacity * 100)}%, transparent)`,
                transform: `rotateX(90deg) translateZ(${yOffset}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

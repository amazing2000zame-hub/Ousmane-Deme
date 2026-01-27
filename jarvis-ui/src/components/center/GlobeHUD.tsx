import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';
import { WireframeGlobe } from './WireframeGlobe';
import { RadialDataRing } from './RadialDataRing';
import { QuorumIndicator } from './QuorumIndicator';
import { OrbitalMarkers } from './OrbitalMarkers';

/**
 * Iron Man 3-inspired holographic HUD centerpiece.
 * Composes the wireframe globe, radial data ring, quorum overlay,
 * and orbital VM markers into a unified HUD display.
 */
export function GlobeHUD() {
  const visualMode = useUIStore((s) => s.visualMode);
  const modeConfig = VISUAL_MODES[visualMode];

  const globeSize = 200;
  const ringSize = 300;
  const orbitRadius = 120;

  return (
    <div
      className="relative flex items-center justify-center select-none overflow-hidden"
      style={{
        minHeight: ringSize + 40,
        perspective: '800px',
      }}
    >
      {/* Radial data ring (SVG, behind globe) */}
      {visualMode !== 'minimal' && (
        <RadialDataRing radius={130} size={ringSize} />
      )}

      {/* Wireframe globe */}
      <WireframeGlobe size={globeSize} />

      {/* Quorum center overlay */}
      <QuorumIndicator />

      {/* Orbital VM markers */}
      {modeConfig.ambientAnimations && (
        <OrbitalMarkers orbitRadius={orbitRadius} />
      )}
    </div>
  );
}

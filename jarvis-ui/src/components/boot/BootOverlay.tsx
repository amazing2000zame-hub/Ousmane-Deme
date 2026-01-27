/**
 * PERF-021: Boot overlay wrapper — bundles AnimatePresence + BootSequence
 * into a lazy-loadable chunk. This keeps the `motion/react` library
 * (~40KB gzipped) out of the main bundle.
 *
 * Default export required for React.lazy().
 */

import { AnimatePresence } from 'motion/react';
import { BootSequence } from './BootSequence';

interface BootOverlayProps {
  show: boolean;
  onComplete: () => void;
}

export default function BootOverlay({ show, onComplete }: BootOverlayProps) {
  return (
    <AnimatePresence mode="wait">
      {show && <BootSequence key="boot" onComplete={onComplete} />}
    </AnimatePresence>
  );
}

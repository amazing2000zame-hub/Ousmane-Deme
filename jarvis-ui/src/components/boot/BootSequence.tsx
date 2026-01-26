import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '../../stores/ui';
import { VISUAL_MODES } from '../../theme/modes';
import { BootLine } from './BootLine';

const BOOT_LINES = [
  'J.A.R.V.I.S. v3.1 INITIALIZING...',
  'CONNECTING TO HOMECLUSTER [4 NODES]',
  'PROXMOX API ............. ONLINE',
  'SOCKET.IO REALTIME ...... ONLINE',
  'SSH TUNNEL POOL ......... READY',
  'SAFETY FRAMEWORK ........ ACTIVE [4-TIER]',
  'MCP TOOLS ............... 18 REGISTERED',
  'VISUAL IDENTITY ......... eDEX-UI',
  'SYSTEM READY',
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.18, delayChildren: 0.3 },
  },
};

interface BootSequenceProps {
  onComplete: () => void;
}

/**
 * Full-screen boot sequence overlay. Plays a typewriter-style system initialization
 * sequence with staggered line reveals, then fades out.
 *
 * Respects visual mode: if bootSequence is disabled, calls onComplete immediately.
 */
export function BootSequence({ onComplete }: BootSequenceProps) {
  const visualMode = useUIStore((s) => s.visualMode);
  const bootEnabled = VISUAL_MODES[visualMode].bootSequence;

  const stableOnComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (!bootEnabled) {
      stableOnComplete();
      return;
    }

    // Total time: stagger 9 lines * 180ms + 300ms delay + 500ms hold = ~2.9s -> use 3000ms
    const timer = setTimeout(stableOnComplete, 3000);
    return () => clearTimeout(timer);
  }, [bootEnabled, stableOnComplete]);

  if (!bootEnabled) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="boot-overlay"
        className="fixed inset-0 bg-jarvis-bg z-50 flex items-center justify-center"
        exit={{ opacity: 0, transition: { duration: 0.5 } }}
      >
        <motion.div
          className="space-y-1.5"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {BOOT_LINES.map((text, i) => (
            <BootLine key={i} text={text} index={i} />
          ))}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

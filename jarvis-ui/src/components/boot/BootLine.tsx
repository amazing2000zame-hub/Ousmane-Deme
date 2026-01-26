import { motion } from 'motion/react';

interface BootLineProps {
  text: string;
  index: number;
  delay?: number;
}

/**
 * A single line of boot text with a typewriter fade-in + slide animation.
 * Line number prefix is dimmed. Status keywords are highlighted:
 * - ONLINE / ACTIVE / READY -> green
 * - REGISTERED -> amber
 */
export function BootLine({ text, index }: BootLineProps) {
  // Detect status keywords for highlighting
  const statusMatch = text.match(/\b(ONLINE|ACTIVE|READY|REGISTERED)\b/);

  let renderedText: React.ReactNode = text;
  if (statusMatch) {
    const keyword = statusMatch[0];
    const idx = text.lastIndexOf(keyword);
    const before = text.slice(0, idx);
    const colorClass =
      keyword === 'ONLINE' || keyword === 'ACTIVE' || keyword === 'READY'
        ? 'text-jarvis-green'
        : 'text-jarvis-amber';
    renderedText = (
      <>
        {before}
        <span className={colorClass}>{text.slice(idx)}</span>
      </>
    );
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: -20 },
        visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
      }}
      className="font-mono text-sm text-jarvis-amber flex"
    >
      <span className="text-jarvis-text-dim mr-3 select-none">
        [{String(index).padStart(2, '0')}]
      </span>
      <span>{renderedText}</span>
    </motion.div>
  );
}

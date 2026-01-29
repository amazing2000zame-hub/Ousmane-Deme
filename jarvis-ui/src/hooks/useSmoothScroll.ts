import { useCallback, useRef } from 'react';
import type { VariableSizeList } from 'react-window';

/**
 * Hook to provide smooth scrolling animation for react-window VariableSizeList.
 * 
 * react-window does not have built-in smooth scrolling, so this hook
 * implements it using requestAnimationFrame with easing.
 */

interface SmoothScrollOptions {
  duration?: number; // Duration in ms (default: 300)
  easing?: (t: number) => number; // Easing function (default: easeOutCubic)
}

export function useSmoothScroll(listRef: React.RefObject<VariableSizeList | null>) {
  const animationRef = useRef<number | null>(null);

  // Easing function: cubic ease-out for natural deceleration
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  };

  /**
   * Smoothly scroll to a specific item index.
   * 
   * @param index - Item index to scroll to
   * @param align - Alignment ('start', 'center', 'end')
   * @param options - Duration and easing function
   */
  const scrollToItem = useCallback((
    index: number,
    align: 'start' | 'center' | 'end' = 'end',
    options: SmoothScrollOptions = {}
  ) => {
    const { duration = 300, easing = easeOutCubic } = options;
    
    // Cancel any ongoing animation
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    const list = listRef.current;
    if (!list) return;

    // Get current scroll offset from the list state
    const startOffset = (list as any).state.scrollOffset || 0;
    
    // Calculate target offset by temporarily scrolling to get the position
    // (react-window doesn't expose a direct way to get item offset calculation)
    list.scrollToItem(index, align);
    const targetOffset = (list as any).state.scrollOffset || 0;
    
    // If already at target or very close, no need to animate
    if (Math.abs(targetOffset - startOffset) < 5) {
      return;
    }
    
    // Reset to start position for animation
    list.scrollTo(startOffset);

    // Animate smoothly using requestAnimationFrame
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easing(progress);
      
      const currentOffset = startOffset + (targetOffset - startOffset) * easedProgress;
      list.scrollTo(currentOffset);
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);
  }, [listRef]);

  /**
   * Cancel any ongoing smooth scroll animation.
   */
  const cancelScroll = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  return { scrollToItem, cancelScroll };
}

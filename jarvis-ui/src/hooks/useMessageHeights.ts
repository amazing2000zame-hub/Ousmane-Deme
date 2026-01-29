import { useCallback, useRef } from 'react';
import type { ChatMessage } from '../stores/chat';

/**
 * Hook to track and cache measured heights for chat messages.
 * 
 * Provides:
 * - estimate(): Generate height estimate before measurement
 * - get(): Retrieve cached height or default
 * - set(): Store measured height
 * - clear(): Reset all cached heights
 */
interface MessageHeights {
  get: (messageId: string) => number;
  set: (messageId: string, height: number) => void;
  estimate: (message: ChatMessage) => number;
  clear: () => void;
}

export function useMessageHeights(): MessageHeights {
  const heightsRef = useRef<Map<string, number>>(new Map());

  const estimate = useCallback((message: ChatMessage): number => {
    // Return cached height if available
    const cached = heightsRef.current.get(message.id);
    if (cached) return cached;

    // Estimate based on content
    let baseHeight = 60; // Role label + bubble padding + margins (mb-3)
    
    // Text content estimation (rough: 20px per line, ~80 chars per line)
    if (message.content) {
      const lines = Math.max(1, Math.ceil(message.content.length / 80));
      baseHeight += lines * 20;
    }
    
    // Tool calls estimation (each card ~100-120px depending on type)
    if (message.toolCalls && message.toolCalls.length > 0) {
      // Add spacing if there's text content too
      if (message.content) {
        baseHeight += 8; // mt-2 gap
      }
      baseHeight += message.toolCalls.length * 110;
    }
    
    return baseHeight;
  }, []);

  const get = useCallback((messageId: string): number => {
    return heightsRef.current.get(messageId) || 100; // Default fallback
  }, []);

  const set = useCallback((messageId: string, height: number) => {
    heightsRef.current.set(messageId, height);
  }, []);

  const clear = useCallback(() => {
    heightsRef.current.clear();
  }, []);

  return { get, set, estimate, clear };
}

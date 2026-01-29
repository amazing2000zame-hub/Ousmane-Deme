import { useCallback, useEffect, useRef, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useChatStore } from '../../stores/chat';
import { useVoiceStore } from '../../stores/voice';
import { useVoice } from '../../hooks/useVoice';
import { useMessageHeights } from '../../hooks/useMessageHeights';
import { useSmoothScroll } from '../../hooks/useSmoothScroll';
import { wasProgressiveUsedForSession, resetProgressiveUsed, isProgressiveActive } from '../../audio/progressive-queue';
import { ChatInput } from './ChatInput';
import { ChatMessage } from './ChatMessage';
import { AudioVisualizer } from './AudioVisualizer';
import { PipelineProgress } from './PipelineProgress';

/**
 * Main chat interface with virtualized message list for smooth scrolling through 100+ messages.
 * Uses react-window VariableSizeList to render only visible messages.
 * 
 * Phase 25 (Chat Virtualization): Replaced flat list with virtual scrolling while preserving
 * all existing functionality (auto-scroll, streaming, manual scroll detection, voice integration).
 */
export function ChatPanel() {
  const { sendMessage, confirmTool } = useChatSocket();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const streamingContent = useChatStore((s) => s.streamingContent);
  
  // Virtual scrolling refs and state
  const listRef = useRef<List>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  
  const prevStreamingRef = useRef(false);

  const voiceEnabled = useVoiceStore((s) => s.enabled);
  const autoPlay = useVoiceStore((s) => s.autoPlay);
  const isPlaying = useVoiceStore((s) => s.isPlaying);
  const { speak, stop } = useVoice();

  // Virtualization hooks
  const messageHeights = useMessageHeights();
  const { scrollToItem } = useSmoothScroll(listRef);

  const handleConfirm = useCallback(
    (toolUseId: string) => confirmTool(toolUseId, true),
    [confirmTool],
  );
  const handleDeny = useCallback(
    (toolUseId: string) => confirmTool(toolUseId, false),
    [confirmTool],
  );

  const handleSpeak = useCallback(
    (text: string, messageId: string) => {
      const state = useVoiceStore.getState();
      if (state.isPlaying && state.playingMessageId === messageId) {
        stop();
      } else {
        speak(text, messageId);
      }
    },
    [speak, stop],
  );

  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!userScrolledUpRef.current && listRef.current && messages.length > 0) {
      scrollToItem(messages.length - 1, 'end');
    }
  }, [messages.length, streamingContent, scrollToItem]);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && voiceEnabled && autoPlay) {
      if (wasProgressiveUsedForSession()) {
        resetProgressiveUsed();
        return;
      }

      if (isProgressiveActive()) {
        return;
      }

      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant?.content) {
        speak(lastAssistant.content, lastAssistant.id);
      }
    }
  }, [isStreaming, voiceEnabled, autoPlay, messages, speak]);

  const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const message = messages[index];
    const isStreamingMessage = message.id === streamingMessageId;
    
    return (
      <div
        style={style}
        data-message-id={message.id}
        ref={(el) => {
          if (el) {
            const rect = el.getBoundingClientRect();
            const height = rect.height;
            const currentHeight = messageHeights.get(message.id);
            
            if (Math.abs(height - currentHeight) > 5) {
              messageHeights.set(message.id, height);
              listRef.current?.resetAfterIndex(index);
            }
          }
        }}
      >
        <ChatMessage
          message={message}
          displayContent={isStreamingMessage ? streamingContent : undefined}
          onConfirm={handleConfirm}
          onDeny={handleDeny}
          onSpeak={handleSpeak}
        />
      </div>
    );
  }, [messages, streamingMessageId, streamingContent, messageHeights, handleConfirm, handleDeny, handleSpeak]);

  const getItemSize = useCallback((index: number) => {
    return messageHeights.estimate(messages[index]);
  }, [messages, messageHeights]);

  const handleScroll = useCallback((info: { scrollDirection: 'forward' | 'backward'; scrollOffset: number; scrollUpdateWasRequested: boolean }) => {
    if (!info.scrollUpdateWasRequested) {
      const list = listRef.current;
      if (list) {
        const listState = (list as any).state;
        const { scrollOffset } = listState;
        const scrollHeight = (list as any)._getEstimatedTotalSize?.() || 0;
        const atBottom = scrollHeight - scrollOffset - containerHeight < 100;
        userScrolledUpRef.current = !atBottom;
      }
    }
  }, [containerHeight]);

  return (
    <div className="flex flex-col h-full">
      {voiceEnabled && isPlaying && (
        <AudioVisualizer />
      )}

      <div ref={containerRef} className="flex-1 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="font-display text-jarvis-text-dim text-sm tracking-wider">
              Ready to assist, sir.
            </span>
          </div>
        ) : (
          <List
            ref={listRef}
            height={containerHeight}
            itemCount={messages.length}
            itemSize={getItemSize}
            width="100%"
            overscanCount={5}
            onScroll={handleScroll}
            className="px-3 py-3"
          >
            {Row}
          </List>
        )}
      </div>

      <PipelineProgress />

      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}

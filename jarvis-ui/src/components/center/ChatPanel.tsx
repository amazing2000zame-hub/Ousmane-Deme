import { useCallback, useEffect, useRef } from 'react';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useChatStore } from '../../stores/chat';
import { useVoiceStore } from '../../stores/voice';
import { useVoice } from '../../hooks/useVoice';
import { wasProgressiveUsedForSession, resetProgressiveUsed, isProgressiveActive } from '../../audio/progressive-queue';
import { ChatInput } from './ChatInput';
import { ChatMessage } from './ChatMessage';
import { AudioVisualizer } from './AudioVisualizer';
import { PipelineProgress } from './PipelineProgress';

/**
 * Main chat interface -- message list with auto-scroll and text input.
 * Connects to the backend /chat namespace via useChatSocket hook.
 * Integrates TTS voice playback with auto-play on response completion.
 *
 * PERF-09/10: Uses streamingContent for O(1) streaming display,
 * React.memo ChatMessage for selective re-renders, and throttled auto-scroll.
 */
export function ChatPanel() {
  const { sendMessage, confirmTool } = useChatSocket();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevStreamingRef = useRef(false);

  const voiceEnabled = useVoiceStore((s) => s.enabled);
  const autoPlay = useVoiceStore((s) => s.autoPlay);
  const isPlaying = useVoiceStore((s) => s.isPlaying);
  const { speak, stop } = useVoice();

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
      // If this message is already playing, stop it
      if (state.isPlaying && state.playingMessageId === messageId) {
        stop();
      } else {
        speak(text, messageId);
      }
    },
    [speak, stop],
  );

  // PERF-10: Track if user has scrolled up manually
  const userScrolledUpRef = useRef(false);

  // Phase 32: Close inline content with Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const store = useChatStore.getState();
        store.clearInlineCamera();
        store.clearInlineWebpage();
        store.clearInlineVideo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    userScrolledUpRef.current = !atBottom;
  }, []);

  // PERF-10: Auto-scroll — fires on new messages and streaming content updates (~2/sec via RAF),
  // but respects manual scroll-up
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, streamingContent]);

  // Auto-play TTS when streaming stops (response complete).
  // PERF-04: Skip monolithic speak if the streaming voice pipeline already
  // delivered audio progressively during this response.
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && voiceEnabled && autoPlay) {
      // If progressive audio was used (even if already finalized), skip
      // monolithic speak — the dual-track pipeline already handled playback.
      if (wasProgressiveUsedForSession()) {
        resetProgressiveUsed();
        return;
      }

      // If progressive session is still active (audio chunks still arriving),
      // skip monolithic speak to prevent double-play.
      if (isProgressiveActive()) {
        return;
      }

      // Fallback: monolithic speak for the complete response
      // (only runs when voiceMode wasn't active during streaming)
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant?.content) {
        speak(lastAssistant.content, lastAssistant.id);
      }
    }
  }, [isStreaming, voiceEnabled, autoPlay, messages, speak]);

  return (
    <div className="flex flex-col h-full">
      {/* Audio visualizer bar (shown when playing) */}
      {voiceEnabled && isPlaying && (
        <AudioVisualizer />
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="font-display text-jarvis-text-dim text-sm tracking-wider">
              Ready to assist, sir.
            </span>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                displayContent={msg.id === streamingMessageId ? streamingContent : undefined}
                onConfirm={handleConfirm}
                onDeny={handleDeny}
                onSpeak={handleSpeak}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Pipeline progress indicator */}
      <PipelineProgress />

      {/* Input area */}
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}

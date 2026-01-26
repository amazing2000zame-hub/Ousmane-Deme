import { useCallback, useEffect, useRef } from 'react';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useChatStore } from '../../stores/chat';
import { useVoiceStore } from '../../stores/voice';
import { useVoice } from '../../hooks/useVoice';
import { ChatInput } from './ChatInput';
import { ChatMessage } from './ChatMessage';
import { AudioVisualizer } from './AudioVisualizer';

/**
 * Main chat interface -- message list with auto-scroll and text input.
 * Connects to the backend /chat namespace via useChatSocket hook.
 * Integrates TTS voice playback with auto-play on response completion.
 */
export function ChatPanel() {
  const { sendMessage, confirmTool } = useChatSocket();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  // Auto-scroll to bottom when messages change or tokens stream in
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-play TTS when streaming stops (response complete)
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && voiceEnabled && autoPlay) {
      // Find the last assistant message
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
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
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
                onConfirm={handleConfirm}
                onDeny={handleDeny}
                onSpeak={handleSpeak}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}

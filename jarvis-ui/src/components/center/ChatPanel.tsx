import { useCallback, useEffect, useRef } from 'react';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useChatStore } from '../../stores/chat';
import { ChatInput } from './ChatInput';
import { ChatMessage } from './ChatMessage';

/**
 * Main chat interface -- message list with auto-scroll and text input.
 * Connects to the backend /chat namespace via useChatSocket hook.
 */
export function ChatPanel() {
  const { sendMessage, confirmTool } = useChatSocket();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleConfirm = useCallback(
    (toolUseId: string) => confirmTool(toolUseId, true),
    [confirmTool],
  );
  const handleDeny = useCallback(
    (toolUseId: string) => confirmTool(toolUseId, false),
    [confirmTool],
  );

  // Auto-scroll to bottom when messages change or tokens stream in
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
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
              <ChatMessage key={msg.id} message={msg} onConfirm={handleConfirm} onDeny={handleDeny} />
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

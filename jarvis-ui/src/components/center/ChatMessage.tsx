import type { ChatMessage as ChatMessageType, ToolCall } from '../../stores/chat';
import { BlockedCard } from './BlockedCard';
import { ConfirmCard } from './ConfirmCard';
import { ToolStatusCard } from './ToolStatusCard';

interface ChatMessageProps {
  message: ChatMessageType;
  onConfirm?: (toolUseId: string) => void;
  onDeny?: (toolUseId: string) => void;
}

function ToolCallRenderer({
  tool,
  onConfirm,
  onDeny,
}: {
  tool: ToolCall;
  onConfirm?: (toolUseId: string) => void;
  onDeny?: (toolUseId: string) => void;
}) {
  if (tool.status === 'confirmation_needed') {
    return (
      <ConfirmCard
        toolName={tool.name}
        toolInput={tool.input}
        toolUseId={tool.toolUseId}
        tier={tool.tier}
        onConfirm={onConfirm ?? (() => {})}
        onDeny={onDeny ?? (() => {})}
      />
    );
  }

  if (tool.status === 'blocked') {
    return (
      <BlockedCard
        toolName={tool.name}
        reason={tool.reason ?? 'This action has been blocked by the safety framework.'}
        tier={tool.tier}
      />
    );
  }

  return (
    <ToolStatusCard
      name={tool.name}
      status={tool.status}
      result={tool.result}
      isError={tool.isError}
    />
  );
}

export function ChatMessage({ message, onConfirm, onDeny }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isEmptyAssistant =
    !isUser && message.content === '' && (!message.toolCalls || message.toolCalls.length === 0);

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3`}>
      {/* Role label */}
      <span
        className={`text-[9px] font-display tracking-wider uppercase mb-0.5 px-1 ${
          isUser ? 'text-jarvis-amber-dim' : 'text-cyan-400'
        }`}
      >
        {isUser ? 'YOU' : 'JARVIS'}
      </span>

      {/* Message bubble */}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-jarvis-amber/10 border border-jarvis-amber/20'
            : 'bg-jarvis-bg-card border border-jarvis-amber/10'
        }`}
      >
        {/* Text content */}
        {message.content ? (
          <p
            className={`text-sm text-jarvis-text whitespace-pre-wrap break-words ${!isUser ? 'font-mono' : ''}`}
          >
            {message.content}
          </p>
        ) : isEmptyAssistant ? (
          <span className="text-sm font-mono text-jarvis-text animate-pulse">_</span>
        ) : null}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={message.content ? 'mt-2' : ''}>
            {message.toolCalls.map((tc) => (
              <ToolCallRenderer
                key={tc.toolUseId}
                tool={tc}
                onConfirm={onConfirm}
                onDeny={onDeny}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

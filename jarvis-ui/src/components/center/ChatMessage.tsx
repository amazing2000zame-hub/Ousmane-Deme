import { memo } from 'react';
import type { ChatMessage as ChatMessageType, ToolCall } from '../../stores/chat';
import { useVoiceStore } from '../../stores/voice';
import { BlockedCard } from './BlockedCard';
import { ConfirmCard } from './ConfirmCard';
import { ToolStatusCard } from './ToolStatusCard';
import { ProviderBadge } from './ProviderBadge';
import { VoicePlayButton } from './VoicePlayButton';

interface ChatMessageProps {
  message: ChatMessageType;
  /** PERF-07: Override content for the streaming message (from streamingContent store). */
  displayContent?: string;
  onConfirm?: (toolUseId: string) => void;
  onDeny?: (toolUseId: string) => void;
  onSpeak?: (text: string, messageId: string) => void;
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

/**
 * PERF-09: Wrapped in React.memo — non-streaming messages skip re-render
 * when the parent ChatPanel updates due to streamingContent changes.
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  displayContent,
  onConfirm,
  onDeny,
  onSpeak,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const text = displayContent ?? message.content;
  const isEmptyAssistant =
    !isUser && text === '' && (!message.toolCalls || message.toolCalls.length === 0);
  const voiceEnabled = useVoiceStore((s) => s.enabled);
  const isPlaying = useVoiceStore((s) => s.isPlaying);
  const playingMessageId = useVoiceStore((s) => s.playingMessageId);
  const isThisPlaying = isPlaying && playingMessageId === message.id;

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-3`}>
      {/* Role label + provider badge + voice button */}
      <div className="flex items-center gap-1.5 mb-0.5 px-1">
        <span
          className={`text-[9px] font-display tracking-wider uppercase ${
            isUser ? 'text-jarvis-amber-dim' : 'text-cyan-400'
          }`}
        >
          {isUser ? 'YOU' : 'JARVIS'}
        </span>
        {!isUser && message.provider && (
          <ProviderBadge provider={message.provider} />
        )}
        {!isUser && voiceEnabled && text && (
          <VoicePlayButton
            isPlaying={isThisPlaying}
            onPlay={() => onSpeak?.(text, message.id)}
          />
        )}
      </div>

      {/* Message bubble */}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-jarvis-amber/10 border border-jarvis-amber/20'
            : 'bg-jarvis-bg-card border border-jarvis-amber/10'
        }`}
      >
        {/* Text content */}
        {text ? (
          <p
            className={`text-sm text-jarvis-text whitespace-pre-wrap break-words ${!isUser ? 'font-mono' : ''}`}
          >
            {text}
          </p>
        ) : isEmptyAssistant ? (
          <span className="text-sm font-mono text-jarvis-text animate-pulse">_</span>
        ) : null}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={text ? 'mt-2' : ''}>
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
});

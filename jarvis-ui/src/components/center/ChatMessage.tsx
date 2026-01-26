import type { ChatMessage as ChatMessageType, ToolCall } from '../../stores/chat';

interface ChatMessageProps {
  message: ChatMessageType;
}

function ToolCallCard({ tool }: { tool: ToolCall }) {
  const statusIndicator = () => {
    switch (tool.status) {
      case 'executing':
        return (
          <span className="flex items-center gap-1.5 text-jarvis-amber text-[10px] font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-jarvis-amber animate-pulse" />
            Executing {tool.name}...
          </span>
        );
      case 'done':
        return (
          <span className="flex items-center gap-1.5 text-green-400 text-[10px] font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
            Completed
            {tool.result && (
              <span className="text-jarvis-text-muted ml-1 truncate max-w-[200px]">
                {tool.result.slice(0, 100)}
              </span>
            )}
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1.5 text-red-400 text-[10px] font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
            Failed
            {tool.result && (
              <span className="text-red-400/70 ml-1 truncate max-w-[200px]">
                {tool.result.slice(0, 100)}
              </span>
            )}
          </span>
        );
      case 'confirmation_needed':
        return (
          <span className="flex items-center gap-1.5 text-jarvis-amber text-[10px] font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-jarvis-amber" />
            AWAITING AUTHORIZATION
          </span>
        );
      case 'blocked':
        return (
          <span className="flex items-center gap-1.5 text-red-400 text-[10px] font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
            BLOCKED{tool.reason ? ` - ${tool.reason}` : ''}
          </span>
        );
      case 'confirmed':
        return (
          <span className="flex items-center gap-1.5 text-green-400 text-[10px] font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
            Authorized
          </span>
        );
      case 'denied':
        return (
          <span className="flex items-center gap-1.5 text-red-400 text-[10px] font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
            Denied
          </span>
        );
    }
  };

  const borderColor =
    tool.status === 'confirmation_needed'
      ? 'border-jarvis-amber/40'
      : tool.status === 'blocked' || tool.status === 'error' || tool.status === 'denied'
        ? 'border-red-400/30'
        : 'border-jarvis-amber/10';

  return (
    <div className={`my-1 px-2 py-1.5 rounded border ${borderColor} bg-jarvis-bg-panel/50`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-jarvis-text-dim">{tool.name}</span>
        {statusIndicator()}
      </div>
    </div>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isEmptyAssistant = !isUser && message.content === '' && (!message.toolCalls || message.toolCalls.length === 0);

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
          <p className={`text-sm text-jarvis-text whitespace-pre-wrap break-words ${!isUser ? 'font-mono' : ''}`}>
            {message.content}
          </p>
        ) : isEmptyAssistant ? (
          <span className="text-sm font-mono text-jarvis-text animate-pulse">_</span>
        ) : null}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={message.content ? 'mt-2' : ''}>
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.toolUseId} tool={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

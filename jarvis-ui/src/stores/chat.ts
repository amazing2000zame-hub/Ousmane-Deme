import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/** crypto.randomUUID() requires secure context (HTTPS). Fallback for HTTP. */
const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  toolUseId: string;
  status: 'executing' | 'done' | 'error' | 'confirmation_needed' | 'confirmed' | 'denied' | 'blocked';
  tier: string;
  result?: string;
  isError?: boolean;
  reason?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  provider?: 'claude' | 'qwen';
}

interface ChatState {
  messages: ChatMessage[];
  sessionId: string;
  isStreaming: boolean;
  streamingMessageId: string | null;
  /** PERF-07: Streaming text held separately — O(1) token append, no messages.map */
  streamingContent: string;

  // Actions
  sendMessage: (content: string) => void;
  startStreaming: (messageId: string) => void;
  appendStreamToken: (text: string) => void;
  stopStreaming: () => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (toolUseId: string, update: Partial<ToolCall>) => void;
  updateLastMessageProvider: (provider: 'claude' | 'qwen') => void;
  clearChat: () => void;
  newSession: () => void;
}

export const useChatStore = create<ChatState>()(
  devtools(
    (set, get) => ({
      messages: [],
      sessionId: uid(),
      isStreaming: false,
      streamingMessageId: null,
      streamingContent: '',

      sendMessage: (content) => {
        const message: ChatMessage = {
          id: uid(),
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        set(
          (state) => ({ messages: [...state.messages, message] }),
          false,
          'chat/sendMessage',
        );
      },

      startStreaming: (messageId) => {
        const assistantMessage: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: [],
        };
        set(
          (state) => ({
            messages: [...state.messages, assistantMessage],
            isStreaming: true,
            streamingMessageId: messageId,
            streamingContent: '',
          }),
          false,
          'chat/startStreaming',
        );
      },

      /**
       * PERF-07: O(1) token append — updates only the streamingContent string.
       * No messages.map traversal during streaming. Content is written to the
       * message array once when stopStreaming is called.
       */
      appendStreamToken: (text) => {
        set(
          (state) => ({ streamingContent: state.streamingContent + text }),
          false,
          'chat/appendStreamToken',
        );
      },

      /**
       * Finalize streaming: copy accumulated streamingContent into the message
       * array (one-time O(n)), then clear streaming state.
       */
      stopStreaming: () => {
        const { streamingMessageId, streamingContent } = get();
        if (streamingMessageId && streamingContent) {
          set(
            (state) => ({
              messages: state.messages.map((m) =>
                m.id === streamingMessageId
                  ? { ...m, content: streamingContent }
                  : m,
              ),
              isStreaming: false,
              streamingMessageId: null,
              streamingContent: '',
            }),
            false,
            'chat/stopStreaming',
          );
        } else {
          set(
            { isStreaming: false, streamingMessageId: null, streamingContent: '' },
            false,
            'chat/stopStreaming',
          );
        }
      },

      addToolCall: (toolCall) => {
        const { streamingMessageId } = get();
        if (!streamingMessageId) return;
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === streamingMessageId
                ? { ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] }
                : m,
            ),
          }),
          false,
          'chat/addToolCall',
        );
      },

      updateToolCall: (toolUseId, update) => {
        const { streamingMessageId } = get();
        if (!streamingMessageId) return;
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === streamingMessageId
                ? {
                    ...m,
                    toolCalls: (m.toolCalls ?? []).map((tc) =>
                      tc.toolUseId === toolUseId ? { ...tc, ...update } : tc,
                    ),
                  }
                : m,
            ),
          }),
          false,
          'chat/updateToolCall',
        );
      },

      updateLastMessageProvider: (provider) => {
        set(
          (state) => {
            const msgs = [...state.messages];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].role === 'assistant') {
                msgs[i] = { ...msgs[i], provider };
                break;
              }
            }
            return { messages: msgs };
          },
          false,
          'chat/updateLastMessageProvider',
        );
      },

      clearChat: () =>
        set({ messages: [], streamingContent: '' }, false, 'chat/clearChat'),

      newSession: () =>
        set(
          { messages: [], sessionId: uid(), isStreaming: false, streamingMessageId: null, streamingContent: '' },
          false,
          'chat/newSession',
        ),
    }),
    { name: 'chat-store' },
  ),
);

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/** uid() requires secure context (HTTPS). Fallback for HTTP. */
const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? uid()
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
}

interface ChatState {
  messages: ChatMessage[];
  sessionId: string;
  isStreaming: boolean;
  streamingMessageId: string | null;

  // Actions
  sendMessage: (content: string) => void;
  startStreaming: (messageId: string) => void;
  appendStreamToken: (text: string) => void;
  stopStreaming: () => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (toolUseId: string, update: Partial<ToolCall>) => void;
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
          }),
          false,
          'chat/startStreaming',
        );
      },

      appendStreamToken: (text) => {
        const { streamingMessageId } = get();
        if (!streamingMessageId) return;
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === streamingMessageId
                ? { ...m, content: m.content + text }
                : m,
            ),
          }),
          false,
          'chat/appendStreamToken',
        );
      },

      stopStreaming: () =>
        set(
          { isStreaming: false, streamingMessageId: null },
          false,
          'chat/stopStreaming',
        ),

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

      clearChat: () =>
        set({ messages: [] }, false, 'chat/clearChat'),

      newSession: () =>
        set(
          { messages: [], sessionId: uid(), isStreaming: false, streamingMessageId: null },
          false,
          'chat/newSession',
        ),
    }),
    { name: 'chat-store' },
  ),
);

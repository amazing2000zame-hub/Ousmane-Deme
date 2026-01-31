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
  status: 'executing' | 'done' | 'error' | 'confirmation_needed' | 'confirmed' | 'denied' | 'blocked' | 'keyword_needed' | 'keyword_approved';
  tier: string;
  result?: string;
  isError?: boolean;
  reason?: string;
  /** For keyword_needed: hint shown to user */
  keywordHint?: string;
}

export interface InlineCamera {
  camera: string;
  timestamp: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

export interface SearchResults {
  query: string;
  results: SearchResult[];
  timestamp: string;
}

export interface InlineWebpage {
  url: string;
  title: string;
  timestamp: string;
}

export interface InlineVideo {
  type: 'youtube' | 'direct';
  videoId?: string;
  url?: string;
  title: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  provider?: 'claude' | 'qwen';
  inlineCamera?: InlineCamera;
  searchResults?: SearchResults;
  inlineWebpage?: InlineWebpage;
  inlineVideo?: InlineVideo;
}

/** Pipeline stages for the progress indicator */
export type PipelineStage = 'idle' | 'routing' | 'thinking' | 'executing' | 'synthesizing' | 'speaking' | 'complete';

interface ChatState {
  messages: ChatMessage[];
  sessionId: string;
  isStreaming: boolean;
  streamingMessageId: string | null;
  /** PERF-07: Streaming text held separately — O(1) token append, no messages.map */
  streamingContent: string;
  /** Current pipeline stage for progress indicator */
  pipelineStage: PipelineStage;
  /** Detail text for the current stage (e.g. provider name, tool name) */
  pipelineDetail: string;

  // Actions
  sendMessage: (content: string) => void;
  startStreaming: (messageId: string) => void;
  appendStreamToken: (text: string) => void;
  stopStreaming: () => void;
  addToolCall: (toolCall: ToolCall) => void;
  updateToolCall: (toolUseId: string, update: Partial<ToolCall>) => void;
  updateLastMessageProvider: (provider: 'claude' | 'qwen') => void;
  setPipelineStage: (stage: PipelineStage, detail?: string) => void;
  setInlineCamera: (camera: InlineCamera) => void;
  clearInlineCamera: () => void;
  setSearchResults: (results: SearchResults) => void;
  setInlineWebpage: (webpage: InlineWebpage) => void;
  clearInlineWebpage: () => void;
  setInlineVideo: (video: InlineVideo) => void;
  clearInlineVideo: () => void;
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
      pipelineStage: 'idle' as PipelineStage,
      pipelineDetail: '',

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
            pipelineStage: 'routing' as PipelineStage,
            pipelineDetail: '',
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
              pipelineStage: 'complete' as PipelineStage,
              pipelineDetail: '',
            }),
            false,
            'chat/stopStreaming',
          );
        } else {
          set(
            { isStreaming: false, streamingMessageId: null, streamingContent: '', pipelineStage: 'complete' as PipelineStage, pipelineDetail: '' },
            false,
            'chat/stopStreaming',
          );
        }
        // Auto-clear pipeline after brief display
        setTimeout(() => {
          set({ pipelineStage: 'idle' as PipelineStage, pipelineDetail: '' }, false, 'chat/pipelineIdle');
        }, 2000);
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

      setInlineCamera: (camera) => {
        // Find the last assistant message to attach the camera to
        const { messages, streamingMessageId } = get();
        const targetId = streamingMessageId || messages.filter(m => m.role === 'assistant').pop()?.id;
        if (!targetId) return;
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === targetId ? { ...m, inlineCamera: camera } : m,
            ),
          }),
          false,
          'chat/setInlineCamera',
        );
      },

      clearInlineCamera: () => {
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.inlineCamera ? { ...m, inlineCamera: undefined } : m,
            ),
          }),
          false,
          'chat/clearInlineCamera',
        );
      },

      setSearchResults: (results) => {
        const { messages, streamingMessageId } = get();
        const targetId = streamingMessageId || messages.filter(m => m.role === 'assistant').pop()?.id;
        if (!targetId) return;
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === targetId ? { ...m, searchResults: results } : m,
            ),
          }),
          false,
          'chat/setSearchResults',
        );
      },

      setInlineWebpage: (webpage) => {
        const { messages, streamingMessageId } = get();
        const targetId = streamingMessageId || messages.filter(m => m.role === 'assistant').pop()?.id;
        if (!targetId) return;
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === targetId ? { ...m, inlineWebpage: webpage } : m,
            ),
          }),
          false,
          'chat/setInlineWebpage',
        );
      },

      clearInlineWebpage: () => {
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.inlineWebpage ? { ...m, inlineWebpage: undefined } : m,
            ),
          }),
          false,
          'chat/clearInlineWebpage',
        );
      },

      setInlineVideo: (video) => {
        const { messages, streamingMessageId } = get();
        const targetId = streamingMessageId || messages.filter(m => m.role === 'assistant').pop()?.id;
        if (!targetId) return;
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === targetId ? { ...m, inlineVideo: video } : m,
            ),
          }),
          false,
          'chat/setInlineVideo',
        );
      },

      clearInlineVideo: () => {
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.inlineVideo ? { ...m, inlineVideo: undefined } : m,
            ),
          }),
          false,
          'chat/clearInlineVideo',
        );
      },

      setPipelineStage: (stage, detail = '') =>
        set({ pipelineStage: stage, pipelineDetail: detail }, false, 'chat/setPipelineStage'),

      clearChat: () =>
        set({ messages: [], streamingContent: '', pipelineStage: 'idle' as PipelineStage, pipelineDetail: '' }, false, 'chat/clearChat'),

      newSession: () =>
        set(
          { messages: [], sessionId: uid(), isStreaming: false, streamingMessageId: null, streamingContent: '', pipelineStage: 'idle' as PipelineStage, pipelineDetail: '' },
          false,
          'chat/newSession',
        ),
    }),
    { name: 'chat-store' },
  ),
);

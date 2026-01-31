import { useCallback, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { createChatSocket } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useChatStore } from '../stores/chat';
import { useVoiceStore } from '../stores/voice';
import { useMetricsStore } from '../stores/metrics';
import {
  startProgressiveSession,
  queueAudioChunk,
  markStreamDone,
  stopProgressive,
  playAcknowledgmentImmediate,
} from '../audio/progressive-queue';

/** crypto.randomUUID() requires secure context (HTTPS). Fallback for HTTP. */
const uid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

interface ChatSocketActions {
  sendMessage: (message: string) => void;
  confirmTool: (toolUseId: string, confirmed: boolean) => void;
}

/**
 * Hook that manages the Socket.IO /chat namespace connection.
 * Connects when authenticated, bridges chat events to the Zustand chat store.
 * Returns sendMessage and confirmTool actions for the UI.
 *
 * PERF-08: Tokens are buffered and flushed via requestAnimationFrame
 * to batch ~10 events/sec into ~2 state updates/sec.
 */
export function useChatSocket(): ChatSocketActions {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = createChatSocket(token);
    socketRef.current = socket;

    // PERF-08: RAF-batched token buffer
    let tokenBuffer = '';
    let rafId: number | null = null;

    function flushTokens() {
      rafId = null;
      if (tokenBuffer) {
        useChatStore.getState().appendStreamToken(tokenBuffer);
        tokenBuffer = '';
      }
    }

    // --- Named handlers for all /chat events ---

    function onStage(data: { sessionId: string; stage: string; detail: string }) {
      void data.sessionId;
      const store = useChatStore.getState();
      store.setPipelineStage(data.stage as 'routing' | 'thinking' | 'synthesizing', data.detail);
    }

    function onToken(data: { sessionId: string; text: string }) {
      void data.sessionId;
      tokenBuffer += data.text;
      if (rafId === null) {
        rafId = requestAnimationFrame(flushTokens);
      }
    }

    function onToolUse(data: {
      sessionId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      toolUseId: string;
      tier: string;
    }) {
      void data.sessionId;
      // Flush pending tokens before tool call so text order is preserved
      if (tokenBuffer) flushTokens();
      const store = useChatStore.getState();
      store.addToolCall({
        name: data.toolName,
        input: data.toolInput,
        toolUseId: data.toolUseId,
        status: 'executing',
        tier: data.tier,
      });
      // Pipeline: mark executing with tool name
      store.setPipelineStage('executing', data.toolName);
    }

    function onToolResult(data: {
      sessionId: string;
      toolUseId: string;
      result: string;
      isError: boolean;
    }) {
      void data.sessionId;
      const store = useChatStore.getState();
      store.updateToolCall(data.toolUseId, {
        status: data.isError ? 'error' : 'done',
        result: data.result,
        isError: data.isError,
      });
      // Pipeline: back to thinking after tool completes
      store.setPipelineStage('thinking', '');
    }

    function onConfirmNeeded(data: {
      sessionId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      toolUseId: string;
      tier: string;
    }) {
      void data.sessionId;
      useChatStore.getState().addToolCall({
        name: data.toolName,
        input: data.toolInput,
        toolUseId: data.toolUseId,
        status: 'confirmation_needed',
        tier: data.tier,
      });
    }

    function onBlocked(data: {
      sessionId: string;
      toolName: string;
      reason: string;
      tier: string;
    }) {
      void data.sessionId;
      useChatStore.getState().addToolCall({
        name: data.toolName,
        input: {},
        toolUseId: uid(),
        status: 'blocked',
        tier: data.tier,
        reason: data.reason,
      });
    }

    // PERF-03/04: Progressive XTTS voice pipeline (local JARVIS voice only)
    let progressiveSessionStarted = false;

    // chat:sentence — start the session so we're ready for audio chunks
    function onSentence(data: { sessionId: string; index: number; text: string }) {
      const voiceState = useVoiceStore.getState();
      if (!voiceState.enabled || !voiceState.autoPlay) return;

      if (!progressiveSessionStarted) {
        progressiveSessionStarted = true;
        const messageId = useChatStore.getState().streamingMessageId;
        if (messageId) {
          startProgressiveSession(data.sessionId, messageId);
        }
      }
    }

    // chat:audio_chunk — XTTS audio plays progressively as chunks arrive
    let firstAudioChunkReceived = false;
    function onAudioChunk(data: {
      sessionId: string;
      index: number;
      contentType: string;
      audio: ArrayBuffer;
    }) {
      const voiceState = useVoiceStore.getState();
      if (!voiceState.enabled || !voiceState.autoPlay) return;

      // If somehow we got audio before a sentence event, start the session
      if (!progressiveSessionStarted) {
        progressiveSessionStarted = true;
        const messageId = useChatStore.getState().streamingMessageId;
        if (messageId) {
          startProgressiveSession(data.sessionId, messageId);
        }
      }

      // Pipeline: mark speaking on first audio chunk
      if (!firstAudioChunkReceived) {
        firstAudioChunkReceived = true;
        useChatStore.getState().setPipelineStage('speaking', '');
      }

      queueAudioChunk(data.sessionId, data.audio, data.contentType, data.index);
    }

    function onAudioDone(data: { sessionId: string; totalChunks: number }) {
      markStreamDone(data.sessionId);
    }

    function onDone(data: { sessionId: string; usage?: unknown; provider?: string; cost?: number }) {
      // Flush any remaining buffered tokens before finalizing
      if (tokenBuffer) flushTokens();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      const store = useChatStore.getState();
      if (data.provider === 'claude' || data.provider === 'qwen') {
        store.updateLastMessageProvider(data.provider);
      }
      store.stopStreaming();

      // Reset progressive flag for next message
      progressiveSessionStarted = false;
      firstAudioChunkReceived = false;
    }

    function onChatError(data: { sessionId: string; error: string }) {
      // Flush any remaining buffered tokens
      if (tokenBuffer) flushTokens();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      const store = useChatStore.getState();
      if (store.streamingMessageId) {
        store.appendStreamToken(`\n\n[Error: ${data.error}]`);
      }
      store.stopStreaming();

      // Reset progressive state on error
      progressiveSessionStarted = false;
      firstAudioChunkReceived = false;
      stopProgressive();
    }

    function onTiming(data: { sessionId: string; timing: any }) {
      const metricsStore = useMetricsStore.getState();
      metricsStore.addTiming(data.sessionId, data.timing);
    }

    function onConnectError(err: Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('token') || msg.includes('expired') || msg.includes('unauthorized')) {
        logout();
      }
    }

    // Handle inline camera display in chat
    function onShowLiveFeed(data: { camera: string; timestamp: string }) {
      console.log('[Chat] Received show_live_feed:', data.camera);
      useChatStore.getState().setInlineCamera(data);
    }

    // Handle closing inline camera
    function onCloseLiveFeed() {
      console.log('[Chat] Received close_live_feed');
      useChatStore.getState().clearInlineCamera();
    }

    // Phase 32: Web browsing and video socket handlers
    function onShowSearchResults(data: {
      query: string;
      results: Array<{ title: string; url: string; snippet: string; engine?: string }>;
      timestamp: string;
    }) {
      console.log('[Chat] Received search results:', data.query);
      useChatStore.getState().setSearchResults(data);
    }

    function onShowWebpage(data: { url: string; title: string; timestamp: string }) {
      console.log('[Chat] Received show_webpage:', data.url);
      useChatStore.getState().setInlineWebpage(data);
    }

    function onCloseWebpage() {
      console.log('[Chat] Received close_webpage');
      useChatStore.getState().clearInlineWebpage();
    }

    function onShowVideo(data: {
      type: 'youtube' | 'direct';
      videoId?: string;
      url?: string;
      title: string;
      timestamp: string;
    }) {
      console.log('[Chat] Received show_video:', data.type, data.videoId || data.url);
      useChatStore.getState().setInlineVideo(data);
    }

    function onCloseVideo() {
      console.log('[Chat] Received close_video');
      useChatStore.getState().clearInlineVideo();
    }

    // Handle voice acknowledgment (plays immediately before tool execution)
    function onAcknowledge(data: {
      sessionId: string;
      phrase: string;
      contentType: string;
      audio: string;  // base64 encoded
    }) {
      console.log('[Chat] Received acknowledgment:', data.phrase);

      // Decode base64 to ArrayBuffer
      const binaryString = atob(data.audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Play immediately, don't wait
      playAcknowledgmentImmediate(bytes.buffer, data.contentType);
    }

    socket.on('chat:stage', onStage);
    socket.on('chat:token', onToken);
    socket.on('chat:tool_use', onToolUse);
    socket.on('chat:tool_result', onToolResult);
    socket.on('chat:confirm_needed', onConfirmNeeded);
    socket.on('chat:blocked', onBlocked);
    socket.on('chat:done', onDone);
    socket.on('chat:timing', onTiming);
    socket.on('chat:error', onChatError);
    socket.on('chat:sentence', onSentence);
    socket.on('chat:audio_chunk', onAudioChunk);
    socket.on('chat:audio_done', onAudioDone);
    socket.on('chat:show_live_feed', onShowLiveFeed);
    socket.on('chat:close_live_feed', onCloseLiveFeed);
    socket.on('chat:acknowledge', onAcknowledge);
    socket.on('chat:show_search_results', onShowSearchResults);
    socket.on('chat:show_webpage', onShowWebpage);
    socket.on('chat:close_webpage', onCloseWebpage);
    socket.on('chat:show_video', onShowVideo);
    socket.on('chat:close_video', onCloseVideo);
    socket.on('connect_error', onConnectError);

    socket.connect();

    return () => {
      // PERF-08: Flush remaining tokens on cleanup
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (tokenBuffer) {
        useChatStore.getState().appendStreamToken(tokenBuffer);
        tokenBuffer = '';
      }

      // Stop progressive playback on cleanup
      stopProgressive();

      socket.off('chat:stage', onStage);
      socket.off('chat:token', onToken);
      socket.off('chat:tool_use', onToolUse);
      socket.off('chat:tool_result', onToolResult);
      socket.off('chat:confirm_needed', onConfirmNeeded);
      socket.off('chat:blocked', onBlocked);
      socket.off('chat:done', onDone);
      socket.off('chat:timing', onTiming);
      socket.off('chat:error', onChatError);
      socket.off('chat:sentence', onSentence);
      socket.off('chat:audio_chunk', onAudioChunk);
      socket.off('chat:audio_done', onAudioDone);
      socket.off('chat:show_live_feed', onShowLiveFeed);
      socket.off('chat:close_live_feed', onCloseLiveFeed);
      socket.off('chat:acknowledge', onAcknowledge);
      socket.off('chat:show_search_results', onShowSearchResults);
      socket.off('chat:show_webpage', onShowWebpage);
      socket.off('chat:close_webpage', onCloseWebpage);
      socket.off('chat:show_video', onShowVideo);
      socket.off('chat:close_video', onCloseVideo);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, logout]);

  const sendMessage = useCallback((message: string) => {
    const store = useChatStore.getState();
    store.sendMessage(message);
    const messageId = uid();
    store.startStreaming(messageId);
    socketRef.current?.emit('chat:send', {
      sessionId: store.sessionId,
      message,
      voiceMode: useVoiceStore.getState().enabled,
    });
  }, []);

  const confirmTool = useCallback((toolUseId: string, confirmed: boolean) => {
    const store = useChatStore.getState();
    store.updateToolCall(toolUseId, {
      status: confirmed ? 'confirmed' : 'denied',
    });
    socketRef.current?.emit('chat:confirm', {
      sessionId: store.sessionId,
      toolUseId,
      confirmed,
    });
  }, []);

  return { sendMessage, confirmTool };
}

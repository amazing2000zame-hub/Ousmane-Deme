import { useCallback, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { createChatSocket } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useChatStore } from '../stores/chat';

interface ChatSocketActions {
  sendMessage: (message: string) => void;
  confirmTool: (toolUseId: string, confirmed: boolean) => void;
}

/**
 * Hook that manages the Socket.IO /chat namespace connection.
 * Connects when authenticated, bridges chat events to the Zustand chat store.
 * Returns sendMessage and confirmTool actions for the UI.
 */
export function useChatSocket(): ChatSocketActions {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = createChatSocket(token);
    socketRef.current = socket;

    // --- Named handlers for all /chat events ---

    function onToken(data: { sessionId: string; text: string }) {
      void data.sessionId;
      useChatStore.getState().appendStreamToken(data.text);
    }

    function onToolUse(data: {
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
        status: 'executing',
        tier: data.tier,
      });
    }

    function onToolResult(data: {
      sessionId: string;
      toolUseId: string;
      result: string;
      isError: boolean;
    }) {
      void data.sessionId;
      useChatStore.getState().updateToolCall(data.toolUseId, {
        status: data.isError ? 'error' : 'done',
        result: data.result,
        isError: data.isError,
      });
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
        toolUseId: crypto.randomUUID(),
        status: 'blocked',
        tier: data.tier,
        reason: data.reason,
      });
    }

    function onDone(_data: { sessionId: string; usage?: unknown }) {
      useChatStore.getState().stopStreaming();
    }

    function onChatError(data: { sessionId: string; error: string }) {
      const store = useChatStore.getState();
      // Append error text to the streaming message before stopping
      if (store.streamingMessageId) {
        store.appendStreamToken(`\n\n[Error: ${data.error}]`);
      }
      store.stopStreaming();
    }

    function onConnectError(err: Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('token') || msg.includes('expired') || msg.includes('unauthorized')) {
        logout();
      }
    }

    socket.on('chat:token', onToken);
    socket.on('chat:tool_use', onToolUse);
    socket.on('chat:tool_result', onToolResult);
    socket.on('chat:confirm_needed', onConfirmNeeded);
    socket.on('chat:blocked', onBlocked);
    socket.on('chat:done', onDone);
    socket.on('chat:error', onChatError);
    socket.on('connect_error', onConnectError);

    socket.connect();

    return () => {
      socket.off('chat:token', onToken);
      socket.off('chat:tool_use', onToolUse);
      socket.off('chat:tool_result', onToolResult);
      socket.off('chat:confirm_needed', onConfirmNeeded);
      socket.off('chat:blocked', onBlocked);
      socket.off('chat:done', onDone);
      socket.off('chat:error', onChatError);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, logout]);

  const sendMessage = useCallback((message: string) => {
    const store = useChatStore.getState();
    store.sendMessage(message);
    const messageId = crypto.randomUUID();
    store.startStreaming(messageId);
    socketRef.current?.emit('chat:send', {
      sessionId: store.sessionId,
      message,
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

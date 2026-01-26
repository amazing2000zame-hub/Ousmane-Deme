import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import type { Socket } from 'socket.io-client';
import { createTerminalSocket } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useTerminalStore } from '../stores/terminal';
import { XTERM_THEME } from '../theme/colors';

/**
 * Hook that manages the full xterm.js terminal lifecycle including
 * WebGL rendering, Socket.IO connection for PTY data, and resize handling.
 *
 * Call once per terminal mount point. Enforces single session --
 * calling connect() while already connected disconnects the previous session.
 */
export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
): {
  connect: (nodeName: string) => void;
  disconnect: () => void;
  isConnected: boolean;
} {
  const token = useAuthStore((s) => s.token);
  const isConnected = useTerminalStore((s) => s.isConnected);
  const selectNode = useTerminalStore((s) => s.selectNode);
  const setConnected = useTerminalStore((s) => s.setConnected);

  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const dataDisposableRef = useRef<{ dispose(): void } | null>(null);
  const resizeDisposableRef = useRef<{ dispose(): void } | null>(null);

  // ── Terminal creation ──────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 14,
      theme: XTERM_THEME,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    // Initial fit
    fitAddon.fit();

    // Try WebGL renderer with fallback to DOM
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        webglAddonRef.current = null;
      });
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch {
      // WebGL not available -- fall back to DOM renderer (default)
    }

    // Welcome message
    terminal.writeln('J.A.R.V.I.S. Terminal v3.1');
    terminal.writeln('Select a node to connect...');
    terminal.writeln('');

    // ResizeObserver for auto-fitting
    const observer = new ResizeObserver(() => {
      // requestAnimationFrame avoids ResizeObserver loop limit errors
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore fit errors during disposal
        }
      });
    });
    observer.observe(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    resizeObserverRef.current = observer;

    return () => {
      // Disconnect socket if connected
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      // Dispose listeners
      dataDisposableRef.current?.dispose();
      dataDisposableRef.current = null;
      resizeDisposableRef.current?.dispose();
      resizeDisposableRef.current = null;

      // Dispose observer
      observer.disconnect();
      resizeObserverRef.current = null;

      // Dispose addons and terminal
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
      terminalRef.current = null;

      setConnected(false);
    };
    // containerRef is a ref -- stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Disconnect ─────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Dispose terminal-side listeners from previous session
    dataDisposableRef.current?.dispose();
    dataDisposableRef.current = null;
    resizeDisposableRef.current?.dispose();
    resizeDisposableRef.current = null;

    const terminal = terminalRef.current;
    if (terminal) {
      terminal.clear();
      terminal.writeln('\r\nDisconnected.');
    }

    setConnected(false);
  }, [setConnected]);

  // ── Connect ────────────────────────────────────────────────────────
  const connect = useCallback(
    (nodeName: string) => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal || !fitAddon || !token) return;

      // Enforce single session -- disconnect previous if active
      if (socketRef.current) {
        disconnect();
      }

      // Clear and show connecting message
      terminal.clear();
      terminal.writeln(`\r\nConnecting to \x1b[33m${nodeName}\x1b[0m...`);

      const socket = createTerminalSocket(token);
      socketRef.current = socket;

      // Server output -> terminal display
      socket.on('data', (data: string) => {
        terminal.write(data);
      });

      // Keyboard input -> server
      const onDataDisposable = terminal.onData((data: string) => {
        if (socket.connected) {
          socket.emit('data', data);
        }
      });
      dataDisposableRef.current = onDataDisposable;

      // Terminal resize -> PTY resize
      const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
        if (socket.connected) {
          socket.emit('resize', { cols, rows });
        }
      });
      resizeDisposableRef.current = onResizeDisposable;

      // Session ended by server
      socket.on('exit', () => {
        disconnect();
      });

      // Error from server
      socket.on('error', (msg: string) => {
        terminal.writeln(`\r\n\x1b[31mError: ${msg}\x1b[0m`);
      });

      // Connected -- send initial dimensions
      socket.on('connect', () => {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          socket.emit('resize', { cols: dims.cols, rows: dims.rows });
        }
      });

      socket.connect();
      socket.emit('start', { node: nodeName });

      // Update store
      setConnected(true);
      selectNode(nodeName);
    },
    [token, disconnect, setConnected, selectNode],
  );

  return { connect, disconnect, isConnected };
}

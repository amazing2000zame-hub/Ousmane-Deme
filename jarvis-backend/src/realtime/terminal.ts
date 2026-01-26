/**
 * SSH PTY session management over the /terminal Socket.IO namespace.
 *
 * Protocol:
 *  1. Client connects with JWT auth (same middleware as other namespaces)
 *  2. Client emits `start` with { node: string } (e.g., "Home", "pve")
 *  3. Server resolves node name to IP, creates SSH connection via pool
 *  4. Server opens PTY shell and pipes data bidirectionally
 *  5. On disconnect or `stop` event, shell is closed (pooled SSH connection preserved)
 *
 * Safety: Terminal access is human-operated and does NOT go through the MCP
 * safety layer. All nodes are accessible since this is the operator's direct access.
 */

import type { Namespace, Socket } from 'socket.io';
import type { ClientChannel } from 'ssh2';
import { getSSHConnection } from '../clients/ssh.js';
import { config, type ClusterNode } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShellSession {
  shell: ClientChannel;
  node: string;
  cleaned: boolean;
}

interface StartPayload {
  node: string;
}

interface ResizePayload {
  cols: number;
  rows: number;
}

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

/** Active shell sessions keyed by socket.id */
const sessions = new Map<string, ShellSession>();

// ---------------------------------------------------------------------------
// Session cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up a shell session for a given socket ID.
 * Closes the shell channel but does NOT dispose the pooled SSH connection.
 */
function cleanupSession(socketId: string): void {
  const session = sessions.get(socketId);
  if (!session || session.cleaned) return;

  session.cleaned = true;

  try {
    session.shell.close();
  } catch {
    // Ignore errors during cleanup -- shell may already be closed
  }

  sessions.delete(socketId);
}

// ---------------------------------------------------------------------------
// Node resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a node name (case-insensitive) to its IP address.
 * Returns null if the node is not found.
 */
function resolveNodeHost(nodeName: string): ClusterNode | null {
  return (
    config.clusterNodes.find(
      (n: ClusterNode) => n.name.toLowerCase() === nodeName.toLowerCase(),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Shell session creation
// ---------------------------------------------------------------------------

/**
 * Create a new PTY shell session for the given socket and node.
 */
async function createShellSession(
  socket: Socket,
  nodeName: string,
): Promise<void> {
  // Resolve node name to IP
  const node = resolveNodeHost(nodeName);
  if (!node) {
    const available = config.clusterNodes
      .map((n: ClusterNode) => n.name)
      .join(', ');
    socket.emit('error', {
      message: `Unknown node: "${nodeName}". Available: ${available}`,
    });
    return;
  }

  // Get SSH connection from pool
  let ssh;
  try {
    ssh = await getSSHConnection(node.host);
  } catch (err) {
    socket.emit('error', {
      message: `SSH connection to ${node.name} (${node.host}) failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return;
  }

  // Request PTY shell
  let shell: ClientChannel;
  try {
    shell = await ssh.requestShell({
      term: 'xterm-256color',
      cols: 80,
      rows: 24,
    });
  } catch (err) {
    // Do NOT dispose the pooled SSH connection -- just report the error
    socket.emit('error', {
      message: `Failed to open shell on ${node.name}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return;
  }

  // Store session
  const session: ShellSession = {
    shell,
    node: node.name,
    cleaned: false,
  };
  sessions.set(socket.id, session);

  // Pipe shell output -> client
  shell.on('data', (data: Buffer) => {
    if (!session.cleaned) {
      socket.emit('data', data.toString('utf-8'));
    }
  });

  // Handle stderr (some shells send data on stderr too)
  shell.stderr.on('data', (data: Buffer) => {
    if (!session.cleaned) {
      socket.emit('data', data.toString('utf-8'));
    }
  });

  // Handle shell close/exit
  shell.on('close', () => {
    if (!session.cleaned) {
      socket.emit('exit', { code: 0, node: node.name });
      cleanupSession(socket.id);
    }
  });

  // Handle shell errors
  shell.on('error', (err: Error) => {
    if (!session.cleaned) {
      socket.emit('error', {
        message: `Shell error on ${node.name}: ${err.message}`,
      });
      cleanupSession(socket.id);
    }
  });

  // Notify client that the session is ready
  socket.emit('ready', { node: node.name, host: node.host });

  console.log(
    `[Terminal] Shell session opened: socket=${socket.id} node=${node.name}`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register connection handlers on the /terminal Socket.IO namespace.
 *
 * Each connected socket can:
 *  - emit `start` { node: string } to open a shell
 *  - emit `data` (string) to send input to the shell
 *  - emit `resize` { cols, rows } to resize the PTY
 *  - emit `stop` to close the current session
 *  - disconnect to automatically clean up the session
 */
export function setupTerminalHandlers(terminalNs: Namespace): void {
  terminalNs.on('connection', (socket: Socket) => {
    console.log(`[Terminal] Client connected: ${socket.id}`);

    // ---- start: open a shell session ----
    socket.on('start', async (payload: StartPayload) => {
      const nodeName = payload?.node;
      if (!nodeName || typeof nodeName !== 'string') {
        socket.emit('error', { message: 'Node name is required in start payload' });
        return;
      }

      // Close existing session if any (one session per socket)
      if (sessions.has(socket.id)) {
        cleanupSession(socket.id);
      }

      await createShellSession(socket, nodeName);
    });

    // ---- data: keyboard input from client ----
    socket.on('data', (data: string) => {
      const session = sessions.get(socket.id);
      if (session && !session.cleaned) {
        try {
          session.shell.write(data);
        } catch {
          // Shell write failed -- likely disconnected
          cleanupSession(socket.id);
        }
      }
    });

    // ---- resize: PTY window resize ----
    socket.on('resize', (payload: ResizePayload) => {
      const session = sessions.get(socket.id);
      if (session && !session.cleaned && payload?.cols && payload?.rows) {
        try {
          session.shell.setWindow(payload.rows, payload.cols, 0, 0);
        } catch {
          // Ignore resize errors
        }
      }
    });

    // ---- stop: close the current session ----
    socket.on('stop', () => {
      cleanupSession(socket.id);
    });

    // ---- disconnect: clean up everything ----
    socket.on('disconnect', (reason: string) => {
      console.log(
        `[Terminal] Client disconnected: ${socket.id} (${reason})`,
      );
      cleanupSession(socket.id);
    });
  });

  console.log('[Terminal] SSH PTY handler registered on /terminal namespace');
}

/**
 * Get the count of active terminal sessions (for monitoring/debugging).
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

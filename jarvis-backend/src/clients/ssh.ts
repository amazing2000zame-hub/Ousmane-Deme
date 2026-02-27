import { NodeSSH } from 'node-ssh';
import { config, type ClusterNode } from '../config.js';

/**
 * SSH client with connection pooling for cluster node command execution.
 *
 * Maintains one persistent SSH connection per host. Connections are
 * lazily created and automatically reconnected if they go stale.
 *
 * All connections use key-based auth (root user, ed25519 key).
 */

// -------------------------------------------------------------------- Types

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

// -------------------------------------------------------------------- Pool

/** Persistent connection pool: host IP -> NodeSSH instance */
const pool = new Map<string, NodeSSH>();

/** Connect timeout in milliseconds */
const CONNECT_TIMEOUT = 10_000;

/** Default command execution timeout in milliseconds */
const DEFAULT_EXEC_TIMEOUT = 30_000;

/**
 * Get (or create) a pooled SSH connection to the given host.
 * If the existing connection is dead, it is replaced with a new one.
 */
export async function getSSHConnection(host: string): Promise<NodeSSH> {
  const existing = pool.get(host);

  if (existing?.isConnected()) {
    return existing;
  }

  // Dispose stale connection if any
  if (existing) {
    existing.dispose();
    pool.delete(host);
  }

  const ssh = new NodeSSH();

  try {
    await ssh.connect({
      host,
      username: 'root',
      privateKeyPath: config.sshKeyPath,
      readyTimeout: CONNECT_TIMEOUT,
    });
  } catch (err: unknown) {
    throw new Error(
      `SSH connect to ${host} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  pool.set(host, ssh);
  return ssh;
}

/**
 * Execute a command on a cluster node by IP address.
 *
 * @param host - IP address of the target node
 * @param command - Shell command to execute
 * @param timeout - Command timeout in ms (default 30s)
 */
export async function execOnNode(
  host: string,
  command: string,
  timeout?: number,
): Promise<ExecResult> {
  const execTimeout = timeout ?? DEFAULT_EXEC_TIMEOUT;

  let ssh: NodeSSH;
  try {
    ssh = await getSSHConnection(host);
  } catch (err) {
    // Connection failure already has a nice message
    throw err;
  }

  try {
    const resultPromise = ssh.execCommand(command);

    // Apply timeout externally since ssh2 ExecOptions doesn't support timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Command timed out after ${execTimeout}ms`)), execTimeout);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    };
  } catch (err: unknown) {
    // On exec failure, dispose the connection so next call reconnects
    ssh.dispose();
    pool.delete(host);

    throw new Error(
      `SSH exec on ${host} failed (command: ${command.slice(0, 80)}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Resolve a node name (e.g. "Home", "pve") to its IP address,
 * then execute a command on it.
 *
 * @param nodeName - Cluster node name (case-sensitive, matches config)
 * @param command - Shell command to execute
 * @param timeout - Command timeout in ms (default 30s)
 */
export async function execOnNodeByName(
  nodeName: string,
  command: string,
  timeout?: number,
): Promise<ExecResult> {
  const node = config.clusterNodes.find(
    (n: ClusterNode) => n.name.toLowerCase() === nodeName.toLowerCase(),
  );
  if (!node) {
    const available = config.clusterNodes
      .map((n: ClusterNode) => n.name)
      .join(', ');
    throw new Error(
      `Unknown node name "${nodeName}". Available: ${available}`,
    );
  }

  return execOnNode(node.host, command, timeout);
}

/**
 * Close and dispose all pooled SSH connections.
 * Call during graceful shutdown.
 */
export function closeAllConnections(): void {
  for (const [host, ssh] of pool.entries()) {
    try {
      ssh.dispose();
    } catch {
      // Ignore disposal errors during shutdown
    }
    pool.delete(host);
  }
}

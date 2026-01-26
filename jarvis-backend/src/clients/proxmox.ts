import { config, type ClusterNode } from '../config.js';

/**
 * Proxmox VE REST API client with token authentication.
 *
 * Each instance connects to a single PVE node via HTTPS on port 8006.
 * Self-signed TLS is accepted via NODE_TLS_REJECT_UNAUTHORIZED=0
 * (set in Docker Compose environment, no per-request agent needed).
 *
 * API token auth does NOT require CSRF tokens for write operations.
 */

export interface ProxmoxClientOptions {
  host: string;
  port?: number;
  tokenId: string;
  tokenSecret: string;
}

export class ProxmoxClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly host: string;
  private readonly timeoutMs: number;

  constructor(opts: ProxmoxClientOptions) {
    const port = opts.port ?? 8006;
    this.host = opts.host;
    this.baseUrl = `https://${opts.host}:${port}/api2/json`;
    this.headers = {
      Authorization: `PVEAPIToken=${opts.tokenId}=${opts.tokenSecret}`,
      'Content-Type': 'application/json',
    };
    this.timeoutMs = 15_000;
  }

  // ------------------------------------------------------------------ Generic
  /**
   * GET a PVE API path. Unwraps the `{ data: T }` envelope.
   */
  async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        throw new Error(
          `PVE GET ${this.host}${path} failed: ${res.status} ${res.statusText} -- ${body}`,
        );
      }

      const json = (await res.json()) as { data: T };
      return json.data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`PVE GET ${this.host}${path} timed out after ${this.timeoutMs}ms`);
      }
      if (err instanceof Error && err.message.startsWith('PVE')) {
        throw err; // already our error
      }
      throw new Error(
        `PVE GET ${this.host}${path} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST to a PVE API path. Unwraps the `{ data: T }` envelope.
   */
  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(
          `PVE POST ${this.host}${path} failed: ${res.status} ${res.statusText} -- ${text}`,
        );
      }

      const json = (await res.json()) as { data: T };
      return json.data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`PVE POST ${this.host}${path} timed out after ${this.timeoutMs}ms`);
      }
      if (err instanceof Error && err.message.startsWith('PVE')) {
        throw err;
      }
      throw new Error(
        `PVE POST ${this.host}${path} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ Domain: Cluster
  /** List all nodes in the cluster. */
  async getNodes(): Promise<unknown[]> {
    return this.get<unknown[]>('/nodes');
  }

  /** Get detailed status for a specific node. */
  async getNodeStatus(node: string): Promise<unknown> {
    return this.get<unknown>(`/nodes/${encodeURIComponent(node)}/status`);
  }

  /** Get cluster-wide resources. Optionally filter by type (vm, storage, node). */
  async getClusterResources(type?: string): Promise<unknown[]> {
    const query = type ? `?type=${encodeURIComponent(type)}` : '';
    return this.get<unknown[]>(`/cluster/resources${query}`);
  }

  /** Get cluster status (nodes + quorum info). */
  async getClusterStatus(): Promise<unknown[]> {
    return this.get<unknown[]>('/cluster/status');
  }

  /** Get storage for a specific node. */
  async getNodeStorage(node: string): Promise<unknown[]> {
    return this.get<unknown[]>(`/nodes/${encodeURIComponent(node)}/storage`);
  }

  /** Get recent tasks across the cluster. */
  async getRecentTasks(limit?: number): Promise<unknown[]> {
    const n = limit ?? 50;
    return this.get<unknown[]>(`/cluster/tasks?limit=${n}`);
  }

  // ------------------------------------------------------------------ Domain: VM (QEMU)
  /** Start a QEMU VM. Returns UPID string. */
  async startVM(node: string, vmid: number): Promise<string> {
    return this.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`);
  }

  /** Stop a QEMU VM (hard stop). */
  async stopVM(node: string, vmid: number): Promise<string> {
    return this.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`);
  }

  /** Reboot a QEMU VM (ACPI reboot). */
  async rebootVM(node: string, vmid: number): Promise<string> {
    return this.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reboot`);
  }

  /** Shutdown a QEMU VM (ACPI shutdown). */
  async shutdownVM(node: string, vmid: number): Promise<string> {
    return this.post<string>(`/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/shutdown`);
  }

  // ------------------------------------------------------------------ Domain: Container (LXC)
  /** Start an LXC container. */
  async startCT(node: string, vmid: number): Promise<string> {
    return this.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/start`);
  }

  /** Stop an LXC container. */
  async stopCT(node: string, vmid: number): Promise<string> {
    return this.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/stop`);
  }

  /** Reboot an LXC container. */
  async rebootCT(node: string, vmid: number): Promise<string> {
    return this.post<string>(`/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/reboot`);
  }
}

// -------------------------------------------------------------------- Instances

/**
 * Pre-built client instances -- one per cluster node.
 * Key = node name (e.g. "Home"), Value = ProxmoxClient.
 */
export const proxmoxClients = new Map<string, ProxmoxClient>(
  config.clusterNodes.map((n: ClusterNode) => [
    n.name,
    new ProxmoxClient({
      host: n.host,
      tokenId: config.pveTokenId,
      tokenSecret: config.pveTokenSecret,
    }),
  ]),
);

/**
 * Return a client suitable for cluster-wide queries.
 * Uses the first configured node (Home / 192.168.1.50).
 */
export function getAnyClient(): ProxmoxClient {
  const first = config.clusterNodes[0];
  const client = proxmoxClients.get(first.name);
  if (!client) {
    throw new Error(`No Proxmox client for node "${first.name}"`);
  }
  return client;
}

/**
 * Return the client for a specific node name (case-sensitive).
 */
export function getClientForNode(nodeName: string): ProxmoxClient {
  const client = proxmoxClients.get(nodeName);
  if (!client) {
    const available = Array.from(proxmoxClients.keys()).join(', ');
    throw new Error(
      `No Proxmox client for node "${nodeName}". Available: ${available}`,
    );
  }
  return client;
}

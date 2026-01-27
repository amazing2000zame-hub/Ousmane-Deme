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
        headers: body
          ? this.headers
          : { Authorization: this.headers.Authorization },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(
          `PVE POST ${this.host}${path} failed: ${res.status} ${res.statusText} -- ${text}`,
        );
      }

      const text = await res.text();
      if (!text) return undefined as T;
      try {
        const json = JSON.parse(text) as { data: T };
        return json.data;
      } catch {
        return text as T;
      }
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

// -------------------------------------------------------------------- Cache
/**
 * Shared API response cache with configurable TTL per resource type.
 * Prevents duplicate API calls from emitter, monitor, and MCP tools
 * that all request the same data within seconds of each other.
 *
 * PERF-011: 5s TTL for nodes/VMs, 15s TTL for storage
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const apiCache = new Map<string, CacheEntry<unknown>>();

/** TTL in ms per cache key prefix */
const CACHE_TTL: Record<string, number> = {
  'cluster:resources:node': 5_000,
  'cluster:resources:vm': 5_000,
  'cluster:resources:storage': 15_000,
  'cluster:resources': 5_000,
  'cluster:status': 5_000,
  'node:storage': 15_000,
  'cluster:tasks': 10_000,
};

function getCacheTTL(key: string): number {
  for (const [prefix, ttl] of Object.entries(CACHE_TTL)) {
    if (key.startsWith(prefix)) return ttl;
  }
  return 5_000; // default 5s
}

function getCached<T>(key: string): T | undefined {
  const entry = apiCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > getCacheTTL(key)) {
    apiCache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  apiCache.set(key, { data, timestamp: Date.now() });
}

/** Clear all cached entries (e.g. after a write operation). */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (key.startsWith(prefix)) apiCache.delete(key);
  }
}

// -------------------------------------------------------------------- Cached domain methods

/**
 * Get cluster resources with caching.
 * Used by emitter, monitor, and MCP tools -- deduplicates concurrent calls.
 */
export async function getCachedClusterResources(type?: string): Promise<unknown[]> {
  const key = type ? `cluster:resources:${type}` : 'cluster:resources';
  const cached = getCached<unknown[]>(key);
  if (cached) return cached;

  const client = getAnyClient();
  const data = await client.getClusterResources(type);
  setCache(key, data);
  return data;
}

/** Get cluster status with caching. */
export async function getCachedClusterStatus(): Promise<unknown[]> {
  const cached = getCached<unknown[]>('cluster:status');
  if (cached) return cached;

  const client = getAnyClient();
  const data = await client.getClusterStatus();
  setCache('cluster:status', data);
  return data;
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

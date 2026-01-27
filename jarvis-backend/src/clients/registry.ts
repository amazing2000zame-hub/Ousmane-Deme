/**
 * Project registry client with cached SSH access.
 *
 * Fetches the central project registry from agent1 via SSH,
 * caches results for 5 minutes, and provides typed accessors
 * for project lookup by name, node, or ID.
 *
 * Uses only the existing SSH client (no new dependencies).
 */

import { execOnNode } from './ssh.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistryProject {
  id: string;
  name: string;
  path: string;
  node: string;
  type: string;
  markers: string[];
  lastModified: string;
  description: string;
  status: string;
  version?: string;
  notFoundCount: number;
}

export interface Registry {
  version: string;
  lastUpdated: string;
  projects: RegistryProject[];
  lastScan: {
    timestamp: string;
    nodesScanned: string[];
    errors: string[];
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** agent1 IP address */
const AGENT1_HOST = '192.168.1.61';

/** Path to registry JSON on agent1 */
const REGISTRY_PATH = '/opt/cluster-agents/file-organizer/data/registry.json';

let cachedRegistry: Registry | null = null;
let cacheTimestamp = 0;

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the project registry from agent1 via SSH.
 * Returns cached data if still within TTL.
 *
 * @param forceRefresh - Bypass cache and fetch fresh data
 */
export async function getRegistry(forceRefresh = false): Promise<Registry> {
  const now = Date.now();

  // Return cached data if valid
  if (!forceRefresh && cachedRegistry && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedRegistry;
  }

  // Fetch via SSH
  const result = await execOnNode(
    AGENT1_HOST,
    `cat ${REGISTRY_PATH}`,
    15_000,
  );

  if (result.code !== 0) {
    // If we have stale cache, return it rather than failing
    if (cachedRegistry) {
      return cachedRegistry;
    }
    throw new Error(
      `Failed to fetch project registry from agent1: ${result.stderr || `exit code ${result.code}`}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    if (cachedRegistry) {
      return cachedRegistry;
    }
    throw new Error('Failed to parse project registry JSON from agent1');
  }

  const registry = parsed as Registry;

  // Validate minimal structure
  if (!Array.isArray(registry.projects)) {
    if (cachedRegistry) {
      return cachedRegistry;
    }
    throw new Error('Invalid registry format: missing projects array');
  }

  cachedRegistry = registry;
  cacheTimestamp = now;
  return registry;
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Get all active projects, sorted alphabetically by name.
 */
export async function getProjects(): Promise<RegistryProject[]> {
  const registry = await getRegistry();
  return registry.projects
    .filter(p => p.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find a project by name (case-insensitive).
 * Returns null if not found.
 */
export async function getProjectByName(name: string): Promise<RegistryProject | null> {
  const registry = await getRegistry();
  const lower = name.toLowerCase();
  return registry.projects.find(
    p => p.name.toLowerCase() === lower && p.status === 'active',
  ) ?? null;
}

/**
 * Get all active projects on a specific node (case-insensitive node match).
 */
export async function getProjectsByNode(nodeName: string): Promise<RegistryProject[]> {
  const registry = await getRegistry();
  const lower = nodeName.toLowerCase();
  return registry.projects
    .filter(p => p.node.toLowerCase() === lower && p.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Search projects by name or description (case-insensitive substring match).
 */
export async function searchProjects(query: string): Promise<RegistryProject[]> {
  const registry = await getRegistry();
  const lower = query.toLowerCase();
  return registry.projects
    .filter(p =>
      p.status === 'active' && (
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower) ||
        p.type.toLowerCase().includes(lower)
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a project name to its node and path.
 * Throws if project not found.
 */
export async function resolveProject(name: string): Promise<{ node: string; path: string; project: RegistryProject }> {
  const project = await getProjectByName(name);
  if (!project) {
    const all = await getProjects();
    const names = all.map(p => p.name).join(', ');
    throw new Error(
      `Project "${name}" not found. Available projects: ${names}`,
    );
  }
  return {
    node: project.node,
    path: project.path,
    project,
  };
}

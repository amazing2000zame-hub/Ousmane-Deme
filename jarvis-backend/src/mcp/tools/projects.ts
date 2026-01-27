/**
 * 4 read-only project intelligence tools.
 *
 * All tools are GREEN tier (auto-execute, no confirmation needed).
 * Secret files (.env, private keys, credentials) are blocked via
 * the secrets safety module before any content is returned.
 *
 * list_projects uses the cached registry client.
 * get_project_structure, read_project_file, and search_project_files
 * use SSH (remote nodes) or Node.js fs APIs (local Home node).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getProjects, resolveProject, type RegistryProject } from '../../clients/registry.js';
import { execOnNodeByName } from '../../clients/ssh.js';
import { isSecretFile, isSecretFileSync } from '../../safety/secrets.js';
import { sanitizePath } from '../../safety/paths.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SSH command timeout */
const SSH_TIMEOUT_MS = 15_000;

/** The local node name (filesystem accessed directly, no SSH) */
const LOCAL_NODE = 'Home';

/** Max file size for read_project_file (1 MB) */
const MAX_READ_BYTES = 1_048_576;

/** Max search results to return */
const MAX_SEARCH_RESULTS = 100;

/** Map registry node names (lowercase) to config node names */
const NODE_NAME_MAP: Record<string, string> = {
  home: 'Home',
  pve: 'pve',
  agent1: 'agent1',
  agent: 'agent',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a registry node name to the config node name.
 * Registry uses lowercase ("home"), config uses mixed case ("Home").
 */
function resolveNodeName(registryNode: string): string {
  return NODE_NAME_MAP[registryNode.toLowerCase()] ?? registryNode;
}

/**
 * Check if a node is the local (Home) node.
 */
function isLocalNode(configNode: string): boolean {
  return configNode === LOCAL_NODE;
}

/**
 * Escape a string for safe use in a shell command.
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Format a project as a full card (flat sorted list presentation).
 */
function formatProjectCard(p: RegistryProject): string {
  const lines: string[] = [];
  lines.push(`${p.name}`);
  lines.push(`  Node: ${p.node}`);
  lines.push(`  Type: ${p.type}`);
  lines.push(`  Path: ${p.path}`);
  if (p.description) {
    lines.push(`  Desc: ${p.description}`);
  }
  if (p.version) {
    lines.push(`  Version: ${p.version}`);
  }
  lines.push(`  Last Modified: ${p.lastModified}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// registerProjectTools
// ---------------------------------------------------------------------------

/**
 * Register all 4 project intelligence tools on the MCP server.
 */
export function registerProjectTools(server: McpServer): void {

  // 1. list_projects -- list all projects from the registry
  server.tool(
    'list_projects',
    'List all indexed projects across the cluster with name, node, type, path, and description',
    {
      filter: z.string().optional().describe('Optional text filter to search project names, descriptions, or types'),
    },
    async ({ filter }) => {
      try {
        let projects: RegistryProject[];

        if (filter && filter.trim()) {
          // Import searchProjects for filtered queries
          const { searchProjects } = await import('../../clients/registry.js');
          projects = await searchProjects(filter.trim());
        } else {
          projects = await getProjects();
        }

        if (projects.length === 0) {
          const msg = filter
            ? `No projects found matching "${filter}".`
            : 'No projects found in the registry.';
          return {
            content: [{ type: 'text' as const, text: msg }],
          };
        }

        // Format as flat sorted list with full cards
        const header = filter
          ? `Found ${projects.length} project${projects.length === 1 ? '' : 's'} matching "${filter}":`
          : `${projects.length} projects across the cluster:`;

        const cards = projects.map(formatProjectCard);
        const output = [header, '', ...cards].join('\n');

        return {
          content: [{ type: 'text' as const, text: output }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing projects: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );

  // 2. get_project_structure -- directory tree of a project
  server.tool(
    'get_project_structure',
    'Show the directory tree of a project by name, displaying folders and files with sizes',
    {
      project: z.string().describe('Project name from the registry (e.g., "jarvis-ui", "file-organizer")'),
      maxDepth: z.number().optional().default(3).describe('Maximum depth of directory traversal (default: 3)'),
    },
    async ({ project: projectName, maxDepth }) => {
      try {
        const { node, path: projectPath, project } = await resolveProject(projectName);
        const configNode = resolveNodeName(node);

        // Build tree using find command (works on both local and remote)
        let treeOutput: string;

        if (isLocalNode(configNode)) {
          treeOutput = await getLocalProjectTree(projectPath, maxDepth);
        } else {
          treeOutput = await getRemoteProjectTree(configNode, projectPath, maxDepth);
        }

        const header = [
          `${project.name} (${project.type}) on ${project.node}`,
          `Path: ${project.path}`,
          '',
        ].join('\n');

        return {
          content: [{ type: 'text' as const, text: header + treeOutput }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );

  // 3. read_project_file -- read a source file from a project
  server.tool(
    'read_project_file',
    'Read the contents of a source file from a project. Blocks sensitive files (.env, private keys, credentials).',
    {
      project: z.string().describe('Project name from the registry'),
      file: z.string().describe('Relative file path within the project (e.g., "src/index.ts", "package.json")'),
    },
    async ({ project: projectName, file: relativeFile }) => {
      try {
        const { node, path: projectPath, project } = await resolveProject(projectName);
        const configNode = resolveNodeName(node);
        const fullPath = path.join(projectPath, relativeFile);

        // Secret file check
        const secretCheck = await isSecretFile(fullPath, 'read_project_file');
        if (secretCheck.blocked) {
          return {
            content: [{ type: 'text' as const, text: secretCheck.reason! }],
            isError: true,
          };
        }

        // Path sanitization (prevents traversal outside project)
        const pathCheck = await sanitizePath(fullPath, projectPath);
        if (!pathCheck.safe) {
          return {
            content: [{
              type: 'text' as const,
              text: pathCheck.reason ?? "I can't access that file path.",
            }],
            isError: true,
          };
        }

        // Read file content
        let content: string;

        if (isLocalNode(configNode)) {
          const stat = await fs.stat(pathCheck.resolvedPath!);
          if (stat.size > MAX_READ_BYTES) {
            return {
              content: [{
                type: 'text' as const,
                text: `File is too large to display (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum is 1 MB.`,
              }],
              isError: true,
            };
          }
          content = await fs.readFile(pathCheck.resolvedPath!, 'utf-8');
        } else {
          // Check size first
          const sizeResult = await execOnNodeByName(
            configNode,
            `stat -c%s ${shellEscape(fullPath)}`,
            SSH_TIMEOUT_MS,
          );
          if (sizeResult.code === 0) {
            const size = parseInt(sizeResult.stdout.trim(), 10);
            if (size > MAX_READ_BYTES) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `File is too large to display (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 1 MB.`,
                }],
                isError: true,
              };
            }
          }

          const result = await execOnNodeByName(
            configNode,
            `cat ${shellEscape(fullPath)}`,
            SSH_TIMEOUT_MS,
          );
          if (result.code !== 0) {
            throw new Error(result.stderr || `Failed to read file (exit code ${result.code})`);
          }
          content = result.stdout;
        }

        // Detect file extension for language hint
        const ext = path.extname(relativeFile).slice(1);
        const header = `${project.name}/${relativeFile} (${configNode}:${fullPath})`;

        return {
          content: [{
            type: 'text' as const,
            text: `${header}\n${'─'.repeat(Math.min(header.length, 80))}\n${content}`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );

  // 4. search_project_files -- grep across project files
  server.tool(
    'search_project_files',
    'Search for a text pattern across all files in a project using grep. Returns matching lines with file paths.',
    {
      project: z.string().describe('Project name from the registry'),
      pattern: z.string().describe('Search pattern (regular expression supported)'),
      fileFilter: z.string().optional().describe('Optional file extension filter (e.g., "ts", "py", "json")'),
    },
    async ({ project: projectName, pattern, fileFilter }) => {
      try {
        const { node, path: projectPath, project } = await resolveProject(projectName);
        const configNode = resolveNodeName(node);

        // Build grep command
        const includeFlag = fileFilter ? `--include='*.${fileFilter}'` : '';
        const grepCmd = [
          'grep -rn',
          '--binary-files=without-match',
          '--color=never',
          '-m 200',             // max 200 matches per file
          includeFlag,
          '--exclude-dir=node_modules',
          '--exclude-dir=.git',
          '--exclude-dir=dist',
          '--exclude-dir=build',
          '--exclude-dir=__pycache__',
          '--exclude-dir=.venv',
          '--exclude-dir=venv',
          `-- ${shellEscape(pattern)}`,
          shellEscape(projectPath),
        ].filter(Boolean).join(' ');

        let grepOutput: string;

        if (isLocalNode(configNode)) {
          // Run grep locally via child_process
          const { execSync } = await import('node:child_process');
          try {
            grepOutput = execSync(grepCmd, {
              encoding: 'utf-8',
              timeout: SSH_TIMEOUT_MS,
              maxBuffer: 5 * 1024 * 1024,
            });
          } catch (err: any) {
            // grep returns exit code 1 for no matches
            if (err.status === 1) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `No matches found for "${pattern}" in ${project.name}.`,
                }],
              };
            }
            throw err;
          }
        } else {
          const result = await execOnNodeByName(configNode, grepCmd, SSH_TIMEOUT_MS);
          if (result.code === 1) {
            return {
              content: [{
                type: 'text' as const,
                text: `No matches found for "${pattern}" in ${project.name}.`,
              }],
            };
          }
          if (result.code !== 0 && result.code !== 1) {
            throw new Error(result.stderr || `grep failed (exit code ${result.code})`);
          }
          grepOutput = result.stdout;
        }

        // Post-process: strip project path prefix, filter secrets, limit results
        const lines = grepOutput.split('\n').filter(Boolean);
        const filtered: string[] = [];

        for (const line of lines) {
          // Extract file path from grep output (path:linenum:content)
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) continue;
          const filePath = line.substring(0, colonIdx);

          // Skip secret files in results
          if (isSecretFileSync(filePath)) continue;

          // Strip project path prefix for cleaner output
          const relativeLine = line.startsWith(projectPath)
            ? line.substring(projectPath.length + 1)
            : line;
          filtered.push(relativeLine);

          if (filtered.length >= MAX_SEARCH_RESULTS) break;
        }

        if (filtered.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No matches found for "${pattern}" in ${project.name} (some results may have been filtered for security).`,
            }],
          };
        }

        const header = `${filtered.length} match${filtered.length === 1 ? '' : 'es'} for "${pattern}" in ${project.name}:`;
        const truncated = lines.length > MAX_SEARCH_RESULTS
          ? `\n... (showing first ${MAX_SEARCH_RESULTS} of ${lines.length} matches)`
          : '';

        return {
          content: [{
            type: 'text' as const,
            text: header + '\n\n' + filtered.join('\n') + truncated,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error searching project: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/**
 * Generate a project tree view on the local filesystem.
 * Uses recursive readdir, filters secrets and noise, respects maxDepth.
 */
async function getLocalProjectTree(projectPath: string, maxDepth: number): Promise<string> {
  const lines: string[] = [projectPath];
  await walkLocal(projectPath, '', maxDepth, 0, lines);
  return lines.join('\n');
}

async function walkLocal(
  basePath: string,
  prefix: string,
  maxDepth: number,
  currentDepth: number,
  lines: string[],
): Promise<void> {
  if (currentDepth >= maxDepth) return;

  let entries;
  try {
    entries = await fs.readdir(basePath, { withFileTypes: true });
  } catch {
    return;
  }

  // Filter and sort
  const filtered = entries.filter(e => {
    if (isNoiseEntry(e.name)) return false;
    if (isSkipDirectory(e.name) && e.isDirectory()) return false;
    if (isSecretFileSync(path.join(basePath, e.name))) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const isLast = i === filtered.length - 1;
    const connector = isLast ? '\\-- ' : '+-- ';
    const childPrefix = isLast ? '    ' : '|   ';

    if (entry.isDirectory()) {
      lines.push(`${prefix}${connector}${entry.name}/`);
      await walkLocal(
        path.join(basePath, entry.name),
        prefix + childPrefix,
        maxDepth,
        currentDepth + 1,
        lines,
      );
    } else {
      lines.push(`${prefix}${connector}${entry.name}`);
    }
  }
}

/**
 * Generate a project tree view on a remote node via SSH find command.
 */
async function getRemoteProjectTree(
  nodeName: string,
  projectPath: string,
  maxDepth: number,
): Promise<string> {
  // Use find with maxdepth, exclude common noise directories
  const cmd = [
    'find',
    shellEscape(projectPath),
    `-maxdepth ${maxDepth}`,
    '-not -path', "'*/.git/*'",
    '-not -path', "'*/.git'",
    '-not -path', "'*/node_modules/*'",
    '-not -path', "'*/node_modules'",
    '-not -path', "'*/dist/*'",
    '-not -path', "'*/__pycache__/*'",
    '-not -path', "'*/.venv/*'",
    '-not -path', "'*/venv/*'",
    '-not -name', "'.DS_Store'",
    '-not -name', "'Thumbs.db'",
    '2>/dev/null',
    '| sort',
  ].join(' ');

  const result = await execOnNodeByName(nodeName, cmd, SSH_TIMEOUT_MS);

  if (result.code !== 0 && !result.stdout.trim()) {
    throw new Error(result.stderr || `find failed on ${nodeName}`);
  }

  // Parse find output into a tree
  const paths = result.stdout.trim().split('\n').filter(Boolean);
  if (paths.length === 0) {
    return '(empty project directory)';
  }

  // Filter out secret files
  const filtered = paths.filter(p => !isSecretFileSync(p));

  // Build indented tree from sorted paths
  const lines: string[] = [projectPath];
  const projectPrefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';

  for (const fullPath of filtered) {
    if (fullPath === projectPath) continue;
    const relative = fullPath.startsWith(projectPrefix)
      ? fullPath.substring(projectPrefix.length)
      : fullPath;
    if (!relative) continue;

    const depth = relative.split('/').length - 1;
    const indent = '  '.repeat(depth);
    const name = path.basename(relative);
    const isDir = fullPath.endsWith('/') || filtered.some(p =>
      p !== fullPath && p.startsWith(fullPath + '/'),
    );

    lines.push(`${indent}${isDir ? name + '/' : name}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const NOISE_FILES = new Set([
  '.DS_Store', '.Spotlight-V100', '.Trashes',
  'Thumbs.db', 'desktop.ini', '.fseventsd',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build',
  '__pycache__', '.venv', 'venv', '.next',
  '.nuxt', 'coverage', '.nyc_output',
]);

function isNoiseEntry(name: string): boolean {
  return NOISE_FILES.has(name) || name.startsWith('._');
}

function isSkipDirectory(name: string): boolean {
  return SKIP_DIRS.has(name);
}

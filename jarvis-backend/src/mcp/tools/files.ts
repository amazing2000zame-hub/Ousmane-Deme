/**
 * 2 read-only file operation tools -- directory listing and file info.
 *
 * list_directory and get_file_info are GREEN tier (auto-execute, no
 * confirmation needed). Both enforce path sanitization via sanitizePath()
 * before any filesystem access.
 *
 * Local (Home node) operations use Node.js fs APIs directly.
 * Remote operations use SSH via execOnNodeByName().
 *
 * Every handler is wrapped in try/catch and returns MCP content format.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeNodeName } from '../../safety/sanitize.js';
import { sanitizePath, logSafetyAudit } from '../../safety/paths.js';
import { execOnNodeByName } from '../../clients/ssh.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files that are platform noise and should always be excluded */
const NOISE_FILES = new Set([
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  'Thumbs.db',
  'desktop.ini',
  '.fseventsd',
]);

/** Prefix for macOS AppleDouble resource fork files */
const APPLE_DOUBLE_PREFIX = '._';

/** SSH command timeout for remote operations */
const SSH_TIMEOUT_MS = 15_000;

/** The local node name (filesystem accessed directly, no SSH) */
const LOCAL_NODE = 'Home';

// ---------------------------------------------------------------------------
// Helpers: formatting
// ---------------------------------------------------------------------------

/**
 * Format a byte count into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${units[i]}`;
}

/**
 * Check if a filename is a noise file that should be excluded.
 */
function isNoiseFile(name: string): boolean {
  return NOISE_FILES.has(name) || name.startsWith(APPLE_DOUBLE_PREFIX);
}

// ---------------------------------------------------------------------------
// Helpers: local directory listing
// ---------------------------------------------------------------------------

interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  itemCount?: number; // for directories
}

/**
 * List a directory on the local filesystem using Node.js APIs.
 */
async function listLocalDirectory(
  dirPath: string,
  showHidden: boolean,
): Promise<DirEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: DirEntry[] = [];

  for (const entry of entries) {
    // Filter noise files
    if (isNoiseFile(entry.name)) continue;

    // Filter hidden files if requested
    if (!showHidden && entry.name.startsWith('.')) continue;

    let type: DirEntry['type'];
    let size = 0;
    let itemCount: number | undefined;

    if (entry.isSymbolicLink()) {
      type = 'symlink';
      try {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        size = stat.size;
        if (stat.isDirectory()) {
          type = 'directory';
          try {
            const children = await fs.readdir(path.join(dirPath, entry.name));
            itemCount = children.length;
          } catch {
            itemCount = undefined;
          }
        }
      } catch {
        // Broken symlink -- report as symlink with 0 size
        type = 'symlink';
      }
    } else if (entry.isDirectory()) {
      type = 'directory';
      try {
        const children = await fs.readdir(path.join(dirPath, entry.name));
        itemCount = children.length;
      } catch {
        itemCount = undefined;
      }
    } else {
      type = 'file';
      try {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        size = stat.size;
      } catch {
        size = 0;
      }
    }

    results.push({ name: entry.name, type, size, itemCount });
  }

  // Sort: directories first, then files, alphabetically within each group
  results.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

// ---------------------------------------------------------------------------
// Helpers: remote directory listing
// ---------------------------------------------------------------------------

/**
 * List a directory on a remote node by parsing `ls -la --block-size=1` output.
 */
async function listRemoteDirectory(
  nodeName: string,
  dirPath: string,
  showHidden: boolean,
): Promise<DirEntry[]> {
  // Use ls -la --block-size=1 for consistent byte sizes
  const cmd = `ls -la --block-size=1 ${shellEscape(dirPath)}`;
  const result = await execOnNodeByName(nodeName, cmd, SSH_TIMEOUT_MS);

  if (result.code !== 0) {
    throw new Error(result.stderr || `ls failed with exit code ${result.code}`);
  }

  const entries: DirEntry[] = [];
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    // Skip header line ("total NNN") and empty lines
    if (!line.trim() || line.startsWith('total ')) continue;

    // Parse ls -la output:
    // drwxr-xr-x  5 root root  4096 Jan 25 12:00 dirname
    // -rw-r--r--  1 root root  1234 Jan 25 12:00 filename
    // lrwxrwxrwx  1 root root    15 Jan 25 12:00 link -> target
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;

    const perms = parts[0];
    const size = parseInt(parts[4], 10) || 0;
    // Name is everything from parts[8] onward (handles spaces in filenames)
    let name = parts.slice(8).join(' ');

    // Handle symlink arrows
    const arrowIdx = name.indexOf(' -> ');
    if (arrowIdx !== -1) {
      name = name.substring(0, arrowIdx);
    }

    // Skip . and ..
    if (name === '.' || name === '..') continue;

    // Filter noise files
    if (isNoiseFile(name)) continue;

    // Filter hidden files if requested
    if (!showHidden && name.startsWith('.')) continue;

    let type: DirEntry['type'];
    if (perms.startsWith('d')) {
      type = 'directory';
    } else if (perms.startsWith('l')) {
      type = 'symlink';
    } else {
      type = 'file';
    }

    entries.push({ name, type, size });
  }

  // For directories, get item counts with a second SSH call
  const dirs = entries.filter(e => e.type === 'directory');
  if (dirs.length > 0 && dirs.length <= 30) {
    // Build a single command to count items in all directories
    const countCmd = dirs
      .map(d => `echo "$(ls -1A ${shellEscape(path.join(dirPath, d.name))} 2>/dev/null | wc -l) ${d.name}"`)
      .join(' && ');

    try {
      const countResult = await execOnNodeByName(nodeName, countCmd, SSH_TIMEOUT_MS);
      if (countResult.code === 0) {
        for (const countLine of countResult.stdout.split('\n')) {
          const trimmed = countLine.trim();
          if (!trimmed) continue;
          const spaceIdx = trimmed.indexOf(' ');
          if (spaceIdx === -1) continue;
          const count = parseInt(trimmed.substring(0, spaceIdx), 10);
          const dirName = trimmed.substring(spaceIdx + 1);
          const entry = dirs.find(d => d.name === dirName);
          if (entry && !isNaN(count)) {
            entry.itemCount = count;
          }
        }
      }
    } catch {
      // Item counts are optional -- proceed without them
    }
  }

  // Sort: directories first, then files, alphabetically within each group
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

/**
 * Escape a string for safe use in a shell command.
 * Uses single-quote wrapping with interior quote escaping.
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Helpers: tree-view formatting
// ---------------------------------------------------------------------------

/**
 * Format directory entries as a tree-view string.
 *
 * If entries exceed maxItems, summarize: show all directories with item
 * counts, show first 20 files, then a summary line.
 */
function formatTreeView(
  dirPath: string,
  entries: DirEntry[],
  maxItems: number,
): string {
  const lines: string[] = [dirPath];

  const directories = entries.filter(e => e.type === 'directory');
  const files = entries.filter(e => e.type !== 'directory');

  if (entries.length <= maxItems) {
    // Full listing
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const prefix = i === entries.length - 1 ? '\\-- ' : '+-- ';
      lines.push(prefix + formatEntry(e));
    }
  } else {
    // Summarized listing
    // Show all directories with item counts
    for (const d of directories) {
      lines.push('+-- ' + formatEntry(d));
    }

    // Show first 20 files
    const shownFiles = files.slice(0, 20);
    for (let i = 0; i < shownFiles.length; i++) {
      const isLast = i === shownFiles.length - 1 && files.length <= 20;
      const prefix = isLast ? '\\-- ' : '+-- ';
      lines.push(prefix + formatEntry(shownFiles[i]));
    }

    // Summary for remaining files
    if (files.length > 20) {
      lines.push(`\\-- ... and ${files.length - 20} more files`);
    }

    lines.push('');
    lines.push(`(${entries.length} total items: ${directories.length} directories, ${files.length} files)`);
  }

  return lines.join('\n');
}

/**
 * Format a single directory entry for tree-view display.
 */
function formatEntry(e: DirEntry): string {
  if (e.type === 'directory') {
    const count = e.itemCount !== undefined ? ` (${e.itemCount} items)` : '';
    return `${e.name}/${count}`;
  }
  if (e.type === 'symlink') {
    return `${e.name} -> (symlink, ${formatBytes(e.size)})`;
  }
  return `${e.name} (${formatBytes(e.size)})`;
}

// ---------------------------------------------------------------------------
// Helpers: local file info
// ---------------------------------------------------------------------------

interface FileInfo {
  name: string;
  path: string;
  node: string;
  type: string;
  size: string;
  sizeBytes: number;
  permissions: string;
  modified: string;
  isSymlink: boolean;
}

/**
 * Get file metadata from the local filesystem.
 */
async function getLocalFileInfo(filePath: string, nodeName: string): Promise<FileInfo> {
  const lstat = await fs.lstat(filePath);
  const stat = await fs.stat(filePath);
  const isSymlink = lstat.isSymbolicLink();

  let type: string;
  if (stat.isDirectory()) {
    type = 'directory';
  } else if (stat.isFile()) {
    type = 'file';
  } else if (stat.isBlockDevice()) {
    type = 'block device';
  } else if (stat.isCharacterDevice()) {
    type = 'character device';
  } else if (stat.isFIFO()) {
    type = 'FIFO';
  } else if (stat.isSocket()) {
    type = 'socket';
  } else {
    type = 'unknown';
  }

  // Convert mode to permission string (e.g., "rwxr-xr-x")
  const mode = stat.mode;
  const perms = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ].join('');

  return {
    name: path.basename(filePath),
    path: filePath,
    node: nodeName,
    type,
    size: formatBytes(stat.size),
    sizeBytes: stat.size,
    permissions: perms,
    modified: stat.mtime.toISOString(),
    isSymlink,
  };
}

/**
 * Get file metadata from a remote node via SSH stat command.
 */
async function getRemoteFileInfo(nodeName: string, filePath: string): Promise<FileInfo> {
  const cmd = `stat --format='%s %F %A %Y %n' ${shellEscape(filePath)} && test -L ${shellEscape(filePath)} && echo SYMLINK || echo REGULAR`;
  const result = await execOnNodeByName(nodeName, cmd, SSH_TIMEOUT_MS);

  if (result.code !== 0) {
    throw new Error(result.stderr || `stat failed with exit code ${result.code}`);
  }

  const lines = result.stdout.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('Unexpected stat output format');
  }

  // Parse stat output: "size type permissions mtime_epoch name"
  const statLine = lines[0];
  const parts = statLine.split(' ');
  if (parts.length < 5) {
    throw new Error('Unexpected stat output format');
  }

  const sizeBytes = parseInt(parts[0], 10) || 0;
  const fileType = parts.slice(1, -2).join(' '); // "regular file", "directory", etc.
  const permsStr = parts[parts.length - 2];
  // Epoch might have leading characters from the format
  const epochStr = parts.find(p => /^\d{10,}$/.test(p));
  const epoch = epochStr ? parseInt(epochStr, 10) : 0;
  const isSymlink = lines[lines.length - 1].trim() === 'SYMLINK';

  // Normalize type
  let type: string;
  if (fileType.includes('directory')) {
    type = 'directory';
  } else if (fileType.includes('regular')) {
    type = 'file';
  } else if (fileType.includes('symbolic')) {
    type = 'symlink';
  } else {
    type = fileType;
  }

  return {
    name: path.basename(filePath),
    path: filePath,
    node: nodeName,
    type,
    size: formatBytes(sizeBytes),
    sizeBytes,
    permissions: permsStr.slice(1), // Remove leading type char (d, -, l)
    modified: epoch ? new Date(epoch * 1000).toISOString() : 'unknown',
    isSymlink,
  };
}

// ---------------------------------------------------------------------------
// registerFileTools
// ---------------------------------------------------------------------------

/**
 * Register all 2 file operation tools on the MCP server.
 */
export function registerFileTools(server: McpServer): void {

  // 1. list_directory -- tree-view directory listing with sizes
  server.tool(
    'list_directory',
    'List the contents of a directory on any cluster node with a tree-view format',
    {
      node: z.string().describe('Cluster node name (Home, pve, agent1, agent). Use "Home" for the local node.'),
      path: z.string().describe('Absolute directory path to list'),
      showHidden: z.boolean().optional().default(true).describe('Show dotfiles (default: true)'),
      maxItems: z.number().optional().default(50).describe('Max items before summarizing (default: 50)'),
    },
    async ({ node, path: userPath, showHidden, maxItems }) => {
      try {
        // Sanitize node name
        const safeName = sanitizeNodeName(node);

        // Sanitize path
        const pathCheck = await sanitizePath(userPath);
        if (!pathCheck.safe) {
          await logSafetyAudit('protected_path_blocked', {
            tool: 'list_directory',
            node: safeName,
            path: userPath,
            reason: pathCheck.reason,
          });
          return {
            content: [{
              type: 'text' as const,
              text: pathCheck.reason ?? "I can't access that path.",
            }],
            isError: true,
          };
        }

        const resolvedPath = pathCheck.resolvedPath!;
        const isLocal = safeName === LOCAL_NODE;

        // Get directory entries
        let entries: DirEntry[];
        if (isLocal) {
          entries = await listLocalDirectory(resolvedPath, showHidden);
        } else {
          entries = await listRemoteDirectory(safeName, resolvedPath, showHidden);
        }

        // Format as tree view
        const treeOutput = formatTreeView(resolvedPath, entries, maxItems);

        return {
          content: [{
            type: 'text' as const,
            text: treeOutput,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing directory: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );

  // 2. get_file_info -- detailed file/directory metadata
  server.tool(
    'get_file_info',
    'Get detailed metadata about a file or directory on any cluster node',
    {
      node: z.string().describe('Cluster node name (Home, pve, agent1, agent)'),
      path: z.string().describe('Absolute file or directory path'),
    },
    async ({ node, path: userPath }) => {
      try {
        // Sanitize node name
        const safeName = sanitizeNodeName(node);

        // Sanitize path
        const pathCheck = await sanitizePath(userPath);
        if (!pathCheck.safe) {
          await logSafetyAudit('protected_path_blocked', {
            tool: 'get_file_info',
            node: safeName,
            path: userPath,
            reason: pathCheck.reason,
          });
          return {
            content: [{
              type: 'text' as const,
              text: pathCheck.reason ?? "I can't access that path.",
            }],
            isError: true,
          };
        }

        const resolvedPath = pathCheck.resolvedPath!;
        const isLocal = safeName === LOCAL_NODE;

        // Get file info
        let info: FileInfo;
        if (isLocal) {
          info = await getLocalFileInfo(resolvedPath, safeName);
        } else {
          info = await getRemoteFileInfo(safeName, resolvedPath);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(info, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error getting file info: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );
}

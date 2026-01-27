/**
 * Disk space checking for file operations.
 *
 * Provides local disk space checks via fs.statfs() and remote checks
 * via SSH (stat -f). Used to pre-validate that sufficient space exists
 * before writing files or downloading content.
 *
 * Uses only Node.js built-ins (node:fs/promises, node:path) plus
 * the existing execOnNodeByName SSH client.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execOnNodeByName } from '../clients/ssh.js';

// ---------------------------------------------------------------------------
// Disk space result
// ---------------------------------------------------------------------------

export interface DiskSpaceResult {
  /** Whether available space meets the requirement */
  sufficient: boolean;
  /** Available bytes on the filesystem */
  availableBytes: number;
  /** Human-readable available space (e.g., "2.4 GB") */
  availableHuman: string;
  /** Human-readable required space (e.g., "500.0 MB") */
  requiredHuman: string;
}

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

/**
 * Format a byte count to a human-readable string.
 *
 * @param bytes - Number of bytes to format
 * @returns Formatted string with appropriate unit (B, KB, MB, GB, TB)
 *
 * @example
 * formatBytes(1024)       // "1.0 KB"
 * formatBytes(1536000)    // "1.5 MB"
 * formatBytes(0)          // "0 B"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const index = Math.min(i, units.length - 1);

  if (index === 0) return `${bytes} B`;

  const value = bytes / Math.pow(k, index);
  return `${value.toFixed(1)} ${units[index]}`;
}

// ---------------------------------------------------------------------------
// checkDiskSpace (local)
// ---------------------------------------------------------------------------

/**
 * Check whether sufficient disk space is available at a local path.
 *
 * Uses `fs.statfs()` (Node.js 18.15+) to query filesystem stats
 * without spawning a subprocess.
 *
 * @param targetPath - The path where data will be written
 * @param requiredBytes - How many bytes need to be written
 */
export async function checkDiskSpace(
  targetPath: string,
  requiredBytes: number,
): Promise<DiskSpaceResult> {
  const dir = path.dirname(targetPath);

  const stats = await fs.statfs(dir);
  const availableBytes = stats.bsize * stats.bavail;

  return {
    sufficient: availableBytes >= requiredBytes,
    availableBytes,
    availableHuman: formatBytes(availableBytes),
    requiredHuman: formatBytes(requiredBytes),
  };
}

// ---------------------------------------------------------------------------
// checkRemoteDiskSpace (via SSH)
// ---------------------------------------------------------------------------

/**
 * Check whether sufficient disk space is available on a remote cluster node.
 *
 * Uses SSH to run `stat -f` on the remote filesystem, parsing the output
 * to calculate available space.
 *
 * @param node - Cluster node name (e.g., "Home", "pve", "agent1")
 * @param targetPath - The remote path where data will be written
 * @param requiredBytes - How many bytes need to be written
 */
export async function checkRemoteDiskSpace(
  node: string,
  targetPath: string,
  requiredBytes: number,
): Promise<DiskSpaceResult> {
  const dir = path.dirname(targetPath);

  // stat -f -c '%a %S' prints: available_blocks block_size
  const result = await execOnNodeByName(
    node,
    `stat -f -c '%a %S' ${JSON.stringify(dir)}`,
  );

  if (result.code !== 0) {
    throw new Error(
      `Failed to check disk space on ${node}:${dir} -- ${result.stderr || 'stat command failed'}`,
    );
  }

  const parts = result.stdout.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error(
      `Unexpected stat output on ${node}: "${result.stdout.trim()}"`,
    );
  }

  const availableBlocks = parseInt(parts[0], 10);
  const blockSize = parseInt(parts[1], 10);

  if (isNaN(availableBlocks) || isNaN(blockSize)) {
    throw new Error(
      `Failed to parse stat output on ${node}: "${result.stdout.trim()}"`,
    );
  }

  const availableBytes = availableBlocks * blockSize;

  return {
    sufficient: availableBytes >= requiredBytes,
    availableBytes,
    availableHuman: formatBytes(availableBytes),
    requiredHuman: formatBytes(requiredBytes),
  };
}

/**
 * 3 file transfer tools -- download, copy, and cross-node transfer.
 *
 * download_file, copy_file, and transfer_file are YELLOW tier (auto-execute
 * with logging). All enforce path sanitization via sanitizePath(), and
 * download_file additionally validates URLs via validateUrl() for SSRF
 * protection.
 *
 * Local (Home node) operations use Node.js fs APIs directly.
 * Remote operations use SSH/SFTP via getSSHConnection() and execOnNodeByName().
 *
 * Every handler is wrapped in try/catch and returns MCP content format.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createWriteStream } from 'node:fs';
import { unlink, stat, mkdir, access, copyFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve, basename, dirname, extname, join } from 'node:path';

import { sanitizeNodeName } from '../../safety/sanitize.js';
import { sanitizePath, logSafetyAudit } from '../../safety/paths.js';
import { validateUrl } from '../../safety/urls.js';
import { checkDiskSpace, checkRemoteDiskSpace, formatBytes } from '../../safety/disk.js';
import { execOnNodeByName, getSSHConnection } from '../../clients/ssh.js';
import { config } from '../../config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The IP of the local node where the backend runs */
const LOCAL_NODE_HOST = '192.168.1.50';

/** SSH command timeout for remote operations */
const SSH_TIMEOUT_MS = 15_000;

/** Maximum auto-rename attempts before giving up */
const MAX_RENAME_ATTEMPTS = 100;

/** Size threshold above which we ask for confirmation (500 MB) */
const LARGE_FILE_THRESHOLD = 524_288_000;

/** Absolute hard cap for downloads (10 GB) */
const HARD_CAP_BYTES = 10_737_418_240;

/** Temporary file prefix for downloads */
const TEMP_PREFIX = '/tmp/jarvis-download-';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a node name to its host IP address.
 * Throws if the node is not found in the cluster config.
 */
function resolveNodeHost(nodeName: string): string {
  const node = config.clusterNodes.find(n => n.name === nodeName);
  if (!node) {
    const available = config.clusterNodes.map(n => n.name).join(', ');
    throw new Error(`Unknown node "${nodeName}". Available: ${available}`);
  }
  return node.host;
}

/**
 * Returns true if the given node name refers to the local node (Home).
 */
function isLocalNode(nodeName: string): boolean {
  return resolveNodeHost(nodeName) === LOCAL_NODE_HOST;
}

/**
 * Escape a string for safe use in a shell command.
 */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Get a unique filename in a LOCAL directory by appending (1), (2), etc.
 * Returns the final full path. Caps at MAX_RENAME_ATTEMPTS.
 */
async function getUniqueFilenameLocal(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name);

  try {
    await access(candidate);
  } catch {
    // File doesn't exist -- use the original name
    return candidate;
  }

  // File exists -- try numbered variants
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length);

  for (let i = 1; i <= MAX_RENAME_ATTEMPTS; i++) {
    candidate = join(dir, `${base}(${i})${ext}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }

  throw new Error(`Could not find a unique filename after ${MAX_RENAME_ATTEMPTS} attempts for "${name}" in ${dir}`);
}

/**
 * Get a unique filename on a REMOTE node by checking existence via SSH.
 * Returns the final full path. Caps at MAX_RENAME_ATTEMPTS.
 */
async function getUniqueFilenameRemote(
  nodeName: string,
  dir: string,
  name: string,
): Promise<string> {
  let candidate = join(dir, name);

  const checkResult = await execOnNodeByName(nodeName, `test -f ${shellEscape(candidate)} && echo EXISTS || echo FREE`, SSH_TIMEOUT_MS);
  if (checkResult.stdout.trim() === 'FREE') {
    return candidate;
  }

  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length);

  for (let i = 1; i <= MAX_RENAME_ATTEMPTS; i++) {
    candidate = join(dir, `${base}(${i})${ext}`);
    const result = await execOnNodeByName(
      nodeName,
      `test -f ${shellEscape(candidate)} && echo EXISTS || echo FREE`,
      SSH_TIMEOUT_MS,
    );
    if (result.stdout.trim() === 'FREE') {
      return candidate;
    }
  }

  throw new Error(`Could not find a unique filename after ${MAX_RENAME_ATTEMPTS} attempts for "${name}" on ${nodeName}:${dir}`);
}

// ---------------------------------------------------------------------------
// registerTransferTools
// ---------------------------------------------------------------------------

/**
 * Register all 3 file transfer tools on the MCP server.
 */
export function registerTransferTools(server: McpServer): void {

  // -------------------------------------------------------------------------
  // 1. download_file -- download from a public URL with SSRF protection
  // -------------------------------------------------------------------------
  server.tool(
    'download_file',
    'Download a file from a public URL to a cluster node (YELLOW tier, SSRF-protected)',
    {
      url: z.string().describe('Public URL to download from (http/https only)'),
      destNode: z.string().optional().default('Home').describe('Destination cluster node (default: Home)'),
      destPath: z.string().describe('Absolute destination file path (e.g., /root/downloads/file.tar.gz)'),
    },
    async ({ url, destNode, destPath }) => {
      try {
        const safeName = sanitizeNodeName(destNode);

        // 1. Validate URL (SSRF protection)
        const urlCheck = await validateUrl(url);
        if (!urlCheck.safe) {
          await logSafetyAudit('ssrf_blocked', {
            tool: 'download_file',
            url,
            reason: urlCheck.reason,
          });
          return {
            content: [{ type: 'text' as const, text: urlCheck.reason ?? 'URL rejected by safety filter.' }],
            isError: true,
          };
        }

        // 2. Sanitize destination path
        const pathCheck = await sanitizePath(destPath);
        if (!pathCheck.safe) {
          await logSafetyAudit('protected_path_blocked', {
            tool: 'download_file',
            node: safeName,
            path: destPath,
            reason: pathCheck.reason,
          });
          return {
            content: [{ type: 'text' as const, text: pathCheck.reason ?? "I can't write to that path." }],
            isError: true,
          };
        }

        const resolvedDest = pathCheck.resolvedPath!;
        const destDir = dirname(resolvedDest);
        const destName = basename(resolvedDest);
        const local = isLocalNode(safeName);

        // 3. Ensure destination directory exists
        if (local) {
          await mkdir(destDir, { recursive: true });
        } else {
          await execOnNodeByName(safeName, `mkdir -p ${shellEscape(destDir)}`, SSH_TIMEOUT_MS);
        }

        // 4. HEAD request for Content-Length
        let contentLength: number | null = null;
        try {
          const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
          const clHeader = headRes.headers.get('content-length');
          if (clHeader) {
            contentLength = parseInt(clHeader, 10);
            if (isNaN(contentLength)) contentLength = null;
          }
        } catch {
          // HEAD request failed -- proceed without pre-check
        }

        // 5. Large file confirmation (> 500 MB)
        if (contentLength !== null && contentLength > LARGE_FILE_THRESHOLD) {
          return {
            content: [{
              type: 'text' as const,
              text: `The file is ${formatBytes(contentLength)}. That's a large download. Should I proceed?`,
            }],
          };
        }

        // 6. Disk space pre-check
        if (contentLength !== null) {
          const requiredBytes = contentLength;
          const diskCheck = local
            ? await checkDiskSpace(resolvedDest, requiredBytes)
            : await checkRemoteDiskSpace(safeName, resolvedDest, requiredBytes);

          if (!diskCheck.sufficient) {
            await logSafetyAudit('disk_space_refused', {
              tool: 'download_file',
              node: safeName,
              path: resolvedDest,
              required: diskCheck.requiredHuman,
              available: diskCheck.availableHuman,
            });
            return {
              content: [{
                type: 'text' as const,
                text: `Not enough disk space. Need ${diskCheck.requiredHuman}, only ${diskCheck.availableHuman} available on ${safeName}.`,
              }],
              isError: true,
            };
          }
        }

        // 7. Download with streaming
        const maxBytes = contentLength !== null
          ? Math.ceil(contentLength * 1.1)
          : HARD_CAP_BYTES;

        // Determine the local path to download to
        let localDownloadPath: string;
        let isTemp = false;

        if (local) {
          // Direct download to local destination (handle auto-rename)
          localDownloadPath = await getUniqueFilenameLocal(destDir, destName);
        } else {
          // Download to temp, then SFTP to remote
          localDownloadPath = `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          isTemp = true;
        }

        let bytesWritten = 0;
        let downloadSuccess = false;

        // Retry logic: one retry on network error
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(url, { redirect: 'follow' });
            if (!response.ok) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Download failed: HTTP ${response.status} ${response.statusText}`,
                }],
                isError: true,
              };
            }

            if (!response.body) {
              return {
                content: [{ type: 'text' as const, text: 'Download failed: no response body.' }],
                isError: true,
              };
            }

            // Stream the download
            bytesWritten = 0;
            const readable = Readable.fromWeb(response.body as any);
            const writable = createWriteStream(localDownloadPath);

            // Track bytes and enforce limit
            readable.on('data', (chunk: Buffer) => {
              bytesWritten += chunk.length;
              if (bytesWritten > maxBytes) {
                readable.destroy(new Error(`Download exceeded size limit (${formatBytes(maxBytes)})`));
              }
            });

            await pipeline(readable, writable);
            downloadSuccess = true;
            break;
          } catch (err) {
            // Clean up partial file on error
            try {
              await unlink(localDownloadPath);
            } catch {
              // Ignore cleanup errors
            }

            // Retry on network errors (not HTTP errors), only on first attempt
            if (attempt === 0 && err instanceof Error && !err.message.startsWith('Download failed:')) {
              continue;
            }

            // Final failure
            return {
              content: [{
                type: 'text' as const,
                text: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
              }],
              isError: true,
            };
          }
        }

        if (!downloadSuccess) {
          return {
            content: [{ type: 'text' as const, text: 'Download failed after retry.' }],
            isError: true,
          };
        }

        // 8. Transfer to remote if needed
        let finalPath = localDownloadPath;

        if (isTemp) {
          try {
            const host = resolveNodeHost(safeName);
            const ssh = await getSSHConnection(host);
            const remoteFinalPath = await getUniqueFilenameRemote(safeName, destDir, destName);
            await ssh.putFile(localDownloadPath, remoteFinalPath);
            finalPath = remoteFinalPath;
          } catch (err) {
            return {
              content: [{
                type: 'text' as const,
                text: `Downloaded but failed to transfer to ${safeName}: ${err instanceof Error ? err.message : String(err)}`,
              }],
              isError: true,
            };
          } finally {
            try {
              await unlink(localDownloadPath);
            } catch {
              // Ignore temp cleanup errors
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Downloaded ${formatBytes(bytesWritten)} to ${safeName}:${finalPath}`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 2. copy_file -- copy a file within the same node
  // -------------------------------------------------------------------------
  server.tool(
    'copy_file',
    'Copy a file between directories on the same cluster node (YELLOW tier)',
    {
      node: z.string().describe('Cluster node where the file is located'),
      sourcePath: z.string().describe('Absolute source file path'),
      destPath: z.string().describe('Absolute destination file path'),
    },
    async ({ node, sourcePath, destPath }) => {
      try {
        const safeName = sanitizeNodeName(node);

        // 1. Sanitize both paths
        const srcCheck = await sanitizePath(sourcePath);
        if (!srcCheck.safe) {
          await logSafetyAudit('protected_path_blocked', {
            tool: 'copy_file',
            node: safeName,
            path: sourcePath,
            reason: srcCheck.reason,
          });
          return {
            content: [{ type: 'text' as const, text: srcCheck.reason ?? "I can't read that path." }],
            isError: true,
          };
        }

        const dstCheck = await sanitizePath(destPath);
        if (!dstCheck.safe) {
          await logSafetyAudit('protected_path_blocked', {
            tool: 'copy_file',
            node: safeName,
            path: destPath,
            reason: dstCheck.reason,
          });
          return {
            content: [{ type: 'text' as const, text: dstCheck.reason ?? "I can't write to that path." }],
            isError: true,
          };
        }

        const resolvedSrc = srcCheck.resolvedPath!;
        const resolvedDst = dstCheck.resolvedPath!;
        const dstDir = dirname(resolvedDst);
        const dstName = basename(resolvedDst);
        const local = isLocalNode(safeName);

        if (local) {
          // Local copy
          // Get source file size
          const srcStat = await stat(resolvedSrc);
          const size = srcStat.size;

          // Check disk space
          const diskCheck = await checkDiskSpace(resolvedDst, size);
          if (!diskCheck.sufficient) {
            return {
              content: [{
                type: 'text' as const,
                text: `Not enough disk space. Need ${diskCheck.requiredHuman}, only ${diskCheck.availableHuman} available on ${safeName}.`,
              }],
              isError: true,
            };
          }

          // Ensure destination directory exists
          await mkdir(dstDir, { recursive: true });

          // Handle auto-rename
          const finalPath = await getUniqueFilenameLocal(dstDir, dstName);

          // Copy the file
          await copyFile(resolvedSrc, finalPath);

          return {
            content: [{
              type: 'text' as const,
              text: `Copied ${basename(resolvedSrc)} to ${finalPath} on ${safeName} (${formatBytes(size)})`,
            }],
          };
        } else {
          // Remote copy via SSH
          // Get source file size
          const sizeResult = await execOnNodeByName(
            safeName,
            `stat --format='%s' ${shellEscape(resolvedSrc)}`,
            SSH_TIMEOUT_MS,
          );
          if (sizeResult.code !== 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `Source file not found: ${sizeResult.stderr || `stat failed on ${safeName}:${resolvedSrc}`}`,
              }],
              isError: true,
            };
          }
          const size = parseInt(sizeResult.stdout.trim(), 10) || 0;

          // Check remote disk space
          const diskCheck = await checkRemoteDiskSpace(safeName, resolvedDst, size);
          if (!diskCheck.sufficient) {
            return {
              content: [{
                type: 'text' as const,
                text: `Not enough disk space. Need ${diskCheck.requiredHuman}, only ${diskCheck.availableHuman} available on ${safeName}.`,
              }],
              isError: true,
            };
          }

          // Ensure destination directory exists
          await execOnNodeByName(safeName, `mkdir -p ${shellEscape(dstDir)}`, SSH_TIMEOUT_MS);

          // Handle auto-rename
          const finalPath = await getUniqueFilenameRemote(safeName, dstDir, dstName);

          // Copy via SSH cp command
          const cpResult = await execOnNodeByName(
            safeName,
            `cp ${shellEscape(resolvedSrc)} ${shellEscape(finalPath)}`,
            SSH_TIMEOUT_MS,
          );
          if (cpResult.code !== 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `Copy failed: ${cpResult.stderr || 'cp command failed'}`,
              }],
              isError: true,
            };
          }

          return {
            content: [{
              type: 'text' as const,
              text: `Copied ${basename(resolvedSrc)} to ${finalPath} on ${safeName} (${formatBytes(size)})`,
            }],
          };
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 3. transfer_file -- transfer a file between cluster nodes via SFTP
  // -------------------------------------------------------------------------
  server.tool(
    'transfer_file',
    'Transfer a file between cluster nodes via SSH/SFTP (YELLOW tier)',
    {
      sourceNode: z.string().describe('Source cluster node'),
      sourcePath: z.string().describe('Absolute source file path on source node'),
      destNode: z.string().describe('Destination cluster node'),
      destPath: z.string().describe('Absolute destination file path on destination node'),
    },
    async ({ sourceNode, sourcePath, destNode, destPath }) => {
      try {
        const safeSrcNode = sanitizeNodeName(sourceNode);
        const safeDstNode = sanitizeNodeName(destNode);

        // 1. Sanitize both paths
        const srcCheck = await sanitizePath(sourcePath);
        if (!srcCheck.safe) {
          await logSafetyAudit('protected_path_blocked', {
            tool: 'transfer_file',
            node: safeSrcNode,
            path: sourcePath,
            reason: srcCheck.reason,
          });
          return {
            content: [{ type: 'text' as const, text: srcCheck.reason ?? "I can't read that path." }],
            isError: true,
          };
        }

        const dstCheck = await sanitizePath(destPath);
        if (!dstCheck.safe) {
          await logSafetyAudit('protected_path_blocked', {
            tool: 'transfer_file',
            node: safeDstNode,
            path: destPath,
            reason: dstCheck.reason,
          });
          return {
            content: [{ type: 'text' as const, text: dstCheck.reason ?? "I can't write to that path." }],
            isError: true,
          };
        }

        const resolvedSrc = srcCheck.resolvedPath!;
        const resolvedDst = dstCheck.resolvedPath!;
        const dstDir = dirname(resolvedDst);
        const dstName = basename(resolvedDst);

        // 2. Same-node transfer: delegate to cp logic
        if (safeSrcNode === safeDstNode) {
          const local = isLocalNode(safeSrcNode);

          if (local) {
            const srcStat = await stat(resolvedSrc);
            const size = srcStat.size;

            const diskCheck = await checkDiskSpace(resolvedDst, size);
            if (!diskCheck.sufficient) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Not enough disk space. Need ${diskCheck.requiredHuman}, only ${diskCheck.availableHuman} available on ${safeSrcNode}.`,
                }],
                isError: true,
              };
            }

            await mkdir(dstDir, { recursive: true });
            const finalPath = await getUniqueFilenameLocal(dstDir, dstName);
            await copyFile(resolvedSrc, finalPath);

            return {
              content: [{
                type: 'text' as const,
                text: `Copied ${basename(resolvedSrc)} to ${finalPath} on ${safeSrcNode} (${formatBytes(size)})`,
              }],
            };
          } else {
            // Remote same-node copy
            const sizeResult = await execOnNodeByName(
              safeSrcNode,
              `stat --format='%s' ${shellEscape(resolvedSrc)}`,
              SSH_TIMEOUT_MS,
            );
            if (sizeResult.code !== 0) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Source file not found: ${sizeResult.stderr || `stat failed on ${safeSrcNode}:${resolvedSrc}`}`,
                }],
                isError: true,
              };
            }
            const size = parseInt(sizeResult.stdout.trim(), 10) || 0;

            const diskCheck = await checkRemoteDiskSpace(safeSrcNode, resolvedDst, size);
            if (!diskCheck.sufficient) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Not enough disk space. Need ${diskCheck.requiredHuman}, only ${diskCheck.availableHuman} available on ${safeSrcNode}.`,
                }],
                isError: true,
              };
            }

            await execOnNodeByName(safeSrcNode, `mkdir -p ${shellEscape(dstDir)}`, SSH_TIMEOUT_MS);
            const finalPath = await getUniqueFilenameRemote(safeSrcNode, dstDir, dstName);

            const cpResult = await execOnNodeByName(
              safeSrcNode,
              `cp ${shellEscape(resolvedSrc)} ${shellEscape(finalPath)}`,
              SSH_TIMEOUT_MS,
            );
            if (cpResult.code !== 0) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Copy failed: ${cpResult.stderr || 'cp command failed'}`,
                }],
                isError: true,
              };
            }

            return {
              content: [{
                type: 'text' as const,
                text: `Copied ${basename(resolvedSrc)} to ${finalPath} on ${safeSrcNode} (${formatBytes(size)})`,
              }],
            };
          }
        }

        // 3. Cross-node transfer via SFTP with Home as intermediary
        const srcLocal = isLocalNode(safeSrcNode);
        const dstLocal = isLocalNode(safeDstNode);

        // Get source file size
        let size: number;
        if (srcLocal) {
          const srcStat = await stat(resolvedSrc);
          size = srcStat.size;
        } else {
          const sizeResult = await execOnNodeByName(
            safeSrcNode,
            `stat --format='%s' ${shellEscape(resolvedSrc)}`,
            SSH_TIMEOUT_MS,
          );
          if (sizeResult.code !== 0) {
            return {
              content: [{
                type: 'text' as const,
                text: `Source file not found on ${safeSrcNode}: ${sizeResult.stderr || 'stat failed'}`,
              }],
              isError: true,
            };
          }
          size = parseInt(sizeResult.stdout.trim(), 10) || 0;
        }

        // Check disk space on destination
        const diskCheck = dstLocal
          ? await checkDiskSpace(resolvedDst, size)
          : await checkRemoteDiskSpace(safeDstNode, resolvedDst, size);

        if (!diskCheck.sufficient) {
          return {
            content: [{
              type: 'text' as const,
              text: `Not enough disk space on ${safeDstNode}. Need ${diskCheck.requiredHuman}, only ${diskCheck.availableHuman} available.`,
            }],
            isError: true,
          };
        }

        // Ensure destination directory exists
        if (dstLocal) {
          await mkdir(dstDir, { recursive: true });
        } else {
          await execOnNodeByName(safeDstNode, `mkdir -p ${shellEscape(dstDir)}`, SSH_TIMEOUT_MS);
        }

        // Determine the local temp path for intermediary
        const tempPath = `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
          // Step A: Get file to local (Home)
          let localFilePath: string;

          if (srcLocal) {
            // Source is already local -- use directly
            localFilePath = resolvedSrc;
          } else {
            // SFTP get from remote source to local temp
            const srcHost = resolveNodeHost(safeSrcNode);
            const srcSsh = await getSSHConnection(srcHost);
            await srcSsh.getFile(tempPath, resolvedSrc);
            localFilePath = tempPath;
          }

          // Step B: Put file to destination
          if (dstLocal) {
            // Destination is local -- copy from local/temp to final path
            const finalPath = await getUniqueFilenameLocal(dstDir, dstName);
            await copyFile(localFilePath, finalPath);

            return {
              content: [{
                type: 'text' as const,
                text: `Transferred ${basename(resolvedSrc)} from ${safeSrcNode} to ${safeDstNode}:${finalPath} (${formatBytes(size)})`,
              }],
            };
          } else {
            // SFTP put from local to remote destination
            const dstHost = resolveNodeHost(safeDstNode);
            const dstSsh = await getSSHConnection(dstHost);
            const finalPath = await getUniqueFilenameRemote(safeDstNode, dstDir, dstName);
            await dstSsh.putFile(localFilePath, finalPath);

            return {
              content: [{
                type: 'text' as const,
                text: `Transferred ${basename(resolvedSrc)} from ${safeSrcNode} to ${safeDstNode}:${finalPath} (${formatBytes(size)})`,
              }],
            };
          }
        } finally {
          // Clean up temp file if we created one
          if (!srcLocal) {
            try {
              await unlink(tempPath);
            } catch {
              // Ignore cleanup errors
            }
          }
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}

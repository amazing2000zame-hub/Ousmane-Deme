/**
 * Path sanitization for file operations.
 *
 * Prevents path traversal attacks, blocks access to protected system
 * directories, and validates all paths against an allowlist of safe
 * base directories. Symlink targets are resolved and re-validated.
 *
 * Uses only Node.js built-ins: node:path, node:fs/promises.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { memoryStore } from '../db/memory.js';

// ---------------------------------------------------------------------------
// Allowed and protected path lists
// ---------------------------------------------------------------------------

/**
 * Directories that file operations are permitted to target.
 * Any resolved path must start with one of these prefixes.
 */
export const ALLOWED_BASE_DIRS: readonly string[] = [
  '/root',
  '/opt',
  '/tmp',
  '/home',
  '/mnt',
  '/var/lib',
  '/srv',
  '/var/log',
] as const;

/**
 * Paths that are always blocked, regardless of allowlist membership.
 * Matched via startsWith -- trailing slash means "this directory and everything inside".
 */
export const PROTECTED_PATHS: readonly string[] = [
  '/etc/pve/priv/',
  '/root/.ssh/',
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/proc/',
  '/sys/',
  '/dev/',
  '/boot/',
  '/etc/pve/local/',
] as const;

// ---------------------------------------------------------------------------
// Path sanitization result
// ---------------------------------------------------------------------------

export interface PathSanitizeResult {
  /** Whether the path is safe to access */
  safe: boolean;
  /** The resolved absolute path (only set when safe=true) */
  resolvedPath?: string;
  /** Human-readable denial reason (only set when safe=false) */
  reason?: string;
}

// ---------------------------------------------------------------------------
// sanitizePath
// ---------------------------------------------------------------------------

/**
 * Validate and sanitize a user-provided file path.
 *
 * Steps:
 *  1. URL-decode the input
 *  2. Resolve to an absolute path (relative to baseDir or /)
 *  3. Check against PROTECTED_PATHS (prefix match)
 *  4. If baseDir given, ensure resolved path is within that base
 *  5. Check resolved path starts with one of ALLOWED_BASE_DIRS
 *  6. If path exists on disk, resolve symlinks and re-validate
 *  7. For non-existent paths, validate the parent directory's realpath
 *
 * @param userPath - The path provided by the user (may be relative, URL-encoded, etc.)
 * @param baseDir - Optional base directory to constrain the path within
 */
export async function sanitizePath(
  userPath: string,
  baseDir?: string,
): Promise<PathSanitizeResult> {
  // Step 1: Decode URL encoding
  let decoded: string;
  try {
    decoded = decodeURIComponent(userPath);
  } catch {
    return { safe: false, reason: "I can't access that path -- it contains invalid encoding." };
  }

  // Step 2: Resolve to absolute path
  const base = baseDir ?? '/';
  const resolved = path.resolve(base, decoded);

  // Step 3: Check against protected paths
  const protectedMatch = checkProtected(resolved);
  if (protectedMatch) {
    await logSafetyAudit('protected_path_blocked', {
      userPath,
      resolved,
      protectedMatch,
    });
    return { safe: false, reason: `I can't access ${resolved} -- that path is protected.` };
  }

  // Step 4: If baseDir specified, validate containment
  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
      await logSafetyAudit('path_traversal_blocked', {
        userPath,
        resolved,
        baseDir: resolvedBase,
      });
      return {
        safe: false,
        reason: `I can't access ${resolved} -- it's outside the allowed directory.`,
      };
    }
  }

  // Step 5: Check against ALLOWED_BASE_DIRS
  if (!isInAllowedDir(resolved)) {
    await logSafetyAudit('path_traversal_blocked', {
      userPath,
      resolved,
      reason: 'outside_allowed_base_dirs',
    });
    return {
      safe: false,
      reason: `I can't access ${resolved} -- it's outside the allowed directories.`,
    };
  }

  // Step 6: Symlink resolution
  try {
    const stats = await fs.stat(resolved);
    if (stats) {
      // Path exists -- resolve symlinks and re-validate
      const realPath = await fs.realpath(resolved);
      const realProtected = checkProtected(realPath);
      if (realProtected) {
        await logSafetyAudit('protected_path_blocked', {
          userPath,
          resolved,
          realPath,
          protectedMatch: realProtected,
          via: 'symlink_resolution',
        });
        return {
          safe: false,
          reason: `I can't access ${resolved} -- it resolves to a protected path.`,
        };
      }
      if (!isInAllowedDir(realPath)) {
        await logSafetyAudit('path_traversal_blocked', {
          userPath,
          resolved,
          realPath,
          reason: 'symlink_outside_allowed_dirs',
        });
        return {
          safe: false,
          reason: `I can't access ${resolved} -- it resolves outside the allowed directories.`,
        };
      }
      return { safe: true, resolvedPath: realPath };
    }
  } catch {
    // Path doesn't exist -- validate parent directory instead (Step 7)
    const parentDir = path.dirname(resolved);
    try {
      const realParent = await fs.realpath(parentDir);
      const parentProtected = checkProtected(realParent);
      if (parentProtected) {
        await logSafetyAudit('protected_path_blocked', {
          userPath,
          resolved,
          realParent,
          protectedMatch: parentProtected,
          via: 'parent_symlink_resolution',
        });
        return {
          safe: false,
          reason: `I can't create files in ${parentDir} -- it resolves to a protected path.`,
        };
      }
      if (!isInAllowedDir(realParent)) {
        await logSafetyAudit('path_traversal_blocked', {
          userPath,
          resolved,
          realParent,
          reason: 'parent_symlink_outside_allowed_dirs',
        });
        return {
          safe: false,
          reason: `I can't create files in ${parentDir} -- it resolves outside the allowed directories.`,
        };
      }
      // Parent is safe -- construct final path using the real parent
      const filename = path.basename(resolved);
      return { safe: true, resolvedPath: path.join(realParent, filename) };
    } catch {
      // Parent doesn't exist either -- just return the resolved path
      // (caller will get ENOENT when they try to use it)
      return { safe: true, resolvedPath: resolved };
    }
  }

  return { safe: true, resolvedPath: resolved };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a path matches any protected path prefix.
 * Returns the matched protected path, or null if no match.
 */
function checkProtected(absPath: string): string | null {
  for (const pp of PROTECTED_PATHS) {
    // For paths ending with "/" (directories), use startsWith
    // For exact file paths (no trailing slash), match exactly or as prefix
    if (pp.endsWith('/')) {
      if (absPath.startsWith(pp) || absPath === pp.slice(0, -1)) {
        return pp;
      }
    } else {
      if (absPath === pp || absPath.startsWith(pp + path.sep)) {
        return pp;
      }
    }
  }
  return null;
}

/**
 * Check if a path falls under one of the allowed base directories.
 */
function isInAllowedDir(absPath: string): boolean {
  return ALLOWED_BASE_DIRS.some(
    (dir) => absPath === dir || absPath.startsWith(dir + path.sep),
  );
}

// ---------------------------------------------------------------------------
// Safety audit logging
// ---------------------------------------------------------------------------

/** Action types for safety audit events */
export type SafetyAuditAction =
  | 'path_traversal_blocked'
  | 'ssrf_blocked'
  | 'protected_path_blocked'
  | 'disk_space_refused'
  | 'secret_file_blocked';

/**
 * Log a safety-relevant event to the events table for audit purposes.
 *
 * These logs persist beyond the current chat session, providing a
 * permanent record of blocked attempts for security review.
 *
 * @param action - The type of safety event
 * @param details - Structured details about what was blocked and why
 */
export async function logSafetyAudit(
  action: SafetyAuditAction,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    memoryStore.saveEvent({
      type: 'action',
      severity: 'warning',
      source: 'system',
      summary: `SAFETY: ${action} -- ${JSON.stringify(details).slice(0, 200)}`,
      details: JSON.stringify({ action, ...details }),
    });
  } catch {
    // Never crash on logging failure
  }
}

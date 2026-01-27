/**
 * Secret file blocking for project intelligence tools.
 *
 * Prevents reading sensitive files (.env, private keys, credentials,
 * git config, etc.) through project browsing tools. Pattern-based
 * matching on filenames and path segments.
 *
 * All blocked attempts are logged to the safety audit trail.
 */

import path from 'node:path';
import { logSafetyAudit } from './paths.js';

// ---------------------------------------------------------------------------
// Blocked filename patterns (case-insensitive, matched against basename)
// ---------------------------------------------------------------------------

/**
 * Exact filenames that are always blocked (case-insensitive).
 */
const BLOCKED_FILENAMES: readonly string[] = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.env.staging',
  '.env.test',
  '.env.example',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.pgpass',
  '.my.cnf',
  '.s3cfg',
  'credentials',
  'credentials.json',
  'service-account.json',
  'service_account.json',
  'keyfile.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'vault.json',
  'vault.yaml',
  'vault.yml',
  '.htpasswd',
  'shadow',
  'master.key',
  'token.json',
] as const;

/**
 * Filename patterns (startsWith or endsWith, case-insensitive).
 */
const BLOCKED_FILENAME_PATTERNS: readonly { type: 'startsWith' | 'endsWith'; value: string }[] = [
  { type: 'startsWith', value: '.env.' },
  { type: 'endsWith', value: '_rsa' },
  { type: 'endsWith', value: '_rsa.pub' },
  { type: 'endsWith', value: '_ed25519' },
  { type: 'endsWith', value: '_ed25519.pub' },
  { type: 'endsWith', value: '_ecdsa' },
  { type: 'endsWith', value: '_dsa' },
  { type: 'endsWith', value: '.pem' },
  { type: 'endsWith', value: '.key' },
  { type: 'endsWith', value: '.p12' },
  { type: 'endsWith', value: '.pfx' },
  { type: 'endsWith', value: '.jks' },
  { type: 'endsWith', value: '.keystore' },
] as const;

// ---------------------------------------------------------------------------
// Blocked path segments (any segment in the path triggers a block)
// ---------------------------------------------------------------------------

/**
 * Directory names that indicate sensitive content.
 * If any segment of the path matches, the file is blocked.
 */
const BLOCKED_PATH_SEGMENTS: readonly string[] = [
  '.git',
  '.ssh',
  '.gnupg',
  '.docker',
  '.kube',
  '.aws',
  '.azure',
  '.gcloud',
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SecretCheckResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Check whether a file path points to a sensitive/secret file.
 *
 * Evaluation order:
 *  1. Check basename against blocked filenames (exact, case-insensitive)
 *  2. Check basename against blocked patterns (startsWith/endsWith)
 *  3. Check path segments against blocked directories
 *
 * @param filePath - The file path to check (absolute or relative)
 * @param tool - Tool name for audit logging
 */
export async function isSecretFile(
  filePath: string,
  tool: string = 'unknown',
): Promise<SecretCheckResult> {
  const basename = path.basename(filePath).toLowerCase();
  const segments = filePath.split(path.sep);

  // Step 1: Exact filename match
  for (const blocked of BLOCKED_FILENAMES) {
    if (basename === blocked.toLowerCase()) {
      await logSafetyAudit('secret_file_blocked', {
        tool,
        path: filePath,
        match: 'filename',
        pattern: blocked,
      });
      return {
        blocked: true,
        reason: `I can't read ${path.basename(filePath)} -- it may contain secrets or credentials.`,
      };
    }
  }

  // Step 2: Filename pattern match
  for (const pattern of BLOCKED_FILENAME_PATTERNS) {
    if (pattern.type === 'startsWith' && basename.startsWith(pattern.value.toLowerCase())) {
      await logSafetyAudit('secret_file_blocked', {
        tool,
        path: filePath,
        match: 'filename_pattern',
        pattern: `${pattern.type}:${pattern.value}`,
      });
      return {
        blocked: true,
        reason: `I can't read ${path.basename(filePath)} -- it may contain secrets or credentials.`,
      };
    }
    if (pattern.type === 'endsWith' && basename.endsWith(pattern.value.toLowerCase())) {
      await logSafetyAudit('secret_file_blocked', {
        tool,
        path: filePath,
        match: 'filename_pattern',
        pattern: `${pattern.type}:${pattern.value}`,
      });
      return {
        blocked: true,
        reason: `I can't read ${path.basename(filePath)} -- it may contain secrets or credentials.`,
      };
    }
  }

  // Step 3: Path segment match
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    for (const blocked of BLOCKED_PATH_SEGMENTS) {
      if (lower === blocked.toLowerCase()) {
        await logSafetyAudit('secret_file_blocked', {
          tool,
          path: filePath,
          match: 'path_segment',
          pattern: blocked,
        });
        return {
          blocked: true,
          reason: `I can't read files inside ${blocked}/ -- that directory may contain sensitive data.`,
        };
      }
    }
  }

  return { blocked: false };
}

/**
 * Check whether a file path matches any secret pattern.
 * Synchronous version for use in filtering (no audit logging).
 */
export function isSecretFileSync(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  const segments = filePath.split(path.sep);

  // Exact filename
  for (const blocked of BLOCKED_FILENAMES) {
    if (basename === blocked.toLowerCase()) return true;
  }

  // Filename patterns
  for (const pattern of BLOCKED_FILENAME_PATTERNS) {
    if (pattern.type === 'startsWith' && basename.startsWith(pattern.value.toLowerCase())) return true;
    if (pattern.type === 'endsWith' && basename.endsWith(pattern.value.toLowerCase())) return true;
  }

  // Path segments
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    for (const blocked of BLOCKED_PATH_SEGMENTS) {
      if (lower === blocked.toLowerCase()) return true;
    }
  }

  return false;
}

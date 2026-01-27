/**
 * Input sanitization for infrastructure data.
 *
 * Prevents prompt injection, command injection, and malformed input
 * from reaching cluster infrastructure via MCP tools.
 */

// ---------------------------------------------------------------------------
// Generic input sanitization
// ---------------------------------------------------------------------------

/**
 * Strip null bytes, control characters (except newline/tab), and truncate
 * to a safe maximum length. Use for any free-text input.
 */
export function sanitizeInput(input: string, maxLength: number = 10_000): string {
  return input
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove control characters except \n (0x0A) and \t (0x09)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Truncate
    .slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Node name sanitization
// ---------------------------------------------------------------------------

const NODE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_NODE_NAME_LENGTH = 50;

/**
 * Validate and sanitize a node name. Must be alphanumeric with hyphens/underscores.
 * Throws on invalid input.
 */
export function sanitizeNodeName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NODE_NAME_LENGTH);

  if (!trimmed) {
    throw new Error('Node name cannot be empty');
  }

  if (!NODE_NAME_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid node name "${trimmed}": must contain only letters, digits, hyphens, and underscores`,
    );
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Command sanitization (allowlist / blocklist)
// ---------------------------------------------------------------------------

/**
 * Commands that are ALWAYS blocked -- destructive or dangerous patterns.
 * Matched as substrings (case-insensitive).
 */
const COMMAND_BLOCKLIST: string[] = [
  'rm -rf /',
  'rm -fr /',
  'mkfs',
  'dd if=',
  'fdisk',
  'parted',
  'pvecm expected',
  'iptables -F',
  'iptables --flush',
  'ip link delete',
  'ip link del',
  'shutdown',
  'poweroff',
  'reboot',
  'init 0',
  'init 6',
  'halt',
  ':(){',        // fork bomb
  'chmod -R 777',
  'chown -R',
  '> /dev/sda',
  'wget|sh',
  'curl|sh',
  'wget|bash',
  'curl|bash',
];

/**
 * Command prefixes that are ALLOWED -- safe read-only or monitoring commands.
 * A command must start with one of these prefixes to be permitted.
 */
const COMMAND_ALLOWLIST: string[] = [
  'hostname',
  'uptime',
  'df',
  'free',
  'cat /sys',
  'cat /proc/cpuinfo',
  'cat /proc/meminfo',
  'cat /proc/loadavg',
  'systemctl status',
  'systemctl is-active',
  'systemctl list-units',
  'journalctl',
  'ip addr',
  'ip link show',
  'ip route show',
  'pvesh get',
  'pvesh ls',
  'pvecm status',
  'pvecm nodes',
  'pct list',
  'qm list',
  'ls',
  'ps',
  'top -bn1',
  'sensors',
  'lsblk',
  'lscpu',
  'lsusb',
  'lspci',
  'mount',
  'findmnt',
  'uname',
  'date',
  'who',
  'w ',
  'last',
  'dmesg',
  'smartctl',
  'zpool status',
  'zfs list',
  'lvs',
  'vgs',
  'pvs',
  'dpkg -l',
  'apt list',
  'ss -tlnp',
  'netstat -tlnp',
  'ethtool',
  'cat /etc/os-release',
  'cat /etc/hostname',
  'cat /etc/network/interfaces',
  'head',
  'tail',
  'wc',
  'du',
  'stat',
];

export interface CommandSafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * Check whether a shell command is safe to execute.
 *
 * Rules (applied in order):
 *  1. Empty command -> blocked
 *  2. Command contains blocklisted pattern -> blocked
 *  3. Command starts with allowlisted prefix -> allowed
 *  4. Default: DENY (not in allowlist)
 */
export function sanitizeCommand(command: string, overrideActive: boolean = false): CommandSafetyResult {
  const trimmed = command.trim();

  if (!trimmed) {
    return { safe: false, reason: 'Empty command' };
  }

  // Blocklist always enforced -- even with override
  const lower = trimmed.toLowerCase();
  for (const blocked of COMMAND_BLOCKLIST) {
    if (lower.includes(blocked.toLowerCase())) {
      return {
        safe: false,
        reason: `Command contains blocked pattern: "${blocked}"`,
      };
    }
  }

  // Override active: skip allowlist and metacharacter checks (blocklist still applies above)
  if (overrideActive) {
    return { safe: true };
  }

  // Check for common injection patterns
  if (/[;&|`$]/.test(trimmed) && !trimmed.startsWith('journalctl')) {
    if (trimmed.includes('|')) {
      const parts = trimmed.split('|').map(p => p.trim());
      const allSafe = parts.every(part =>
        COMMAND_ALLOWLIST.some(prefix => part.startsWith(prefix)),
      );
      if (!allSafe) {
        return {
          safe: false,
          reason: 'Command contains shell metacharacters (pipe to non-allowlisted command)',
        };
      }
    } else {
      return {
        safe: false,
        reason: 'Command contains shell metacharacters (;, &, `, $)',
      };
    }
  }

  // Check allowlist (prefix match)
  const isAllowed = COMMAND_ALLOWLIST.some(prefix =>
    trimmed.startsWith(prefix),
  );

  if (isAllowed) {
    return { safe: true };
  }

  return {
    safe: false,
    reason: `Command "${trimmed.slice(0, 60)}..." is not in the allowlist`,
  };
}

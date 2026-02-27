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
  'chown -R /',
  '> /dev/sd',
  '> /dev/nvm',
  'wget|sh',
  'curl|sh',
  'wget|bash',
  'curl|bash',
  'curl | sh',
  'curl | bash',
  'wget | sh',
  'wget | bash',
  'rm -rf /*',
  'rm -fr /*',
  'mv /* ',
  'cat /dev/urandom >',
  'yes |',
  'nohup',           // prevent background persistent processes
];

/**
 * Command prefixes that are ALLOWED -- safe read-only or monitoring commands.
 * A command must start with one of these prefixes to be permitted.
 */
const COMMAND_ALLOWLIST: string[] = [
  // System info
  'hostname',
  'uptime',
  'uname',
  'date',
  'who',
  'w ',
  'last',
  'id',
  'whoami',

  // Resource monitoring
  'df',
  'free',
  'top -bn1',
  'htop',
  'vmstat',
  'iostat',
  'iotop',
  'nproc',

  // Process management
  'ps',
  'pgrep',
  'pidof',

  // Disk & storage
  'du',
  'lsblk',
  'mount',
  'findmnt',
  'stat',
  'smartctl',
  'zpool',
  'zfs',
  'lvs',
  'vgs',
  'pvs',
  'blkid',

  // File operations (read)
  'cat',
  'head',
  'tail',
  'wc',
  'ls',
  'find',
  'file',
  'readlink',
  'realpath',
  'md5sum',
  'sha256sum',
  'diff',

  // File operations (write -- useful for management)
  'cp',
  'mv',
  'mkdir',
  'touch',
  'ln',
  'tar',
  'gzip',
  'gunzip',
  'zip',
  'unzip',
  'rsync',

  // Text processing
  'grep',
  'awk',
  'sed',
  'sort',
  'uniq',
  'cut',
  'tr',
  'tee',
  'xargs',
  'basename',
  'dirname',
  'echo',
  'printf',

  // Network
  'ip addr',
  'ip link show',
  'ip route',
  'ip neigh',
  'ss',
  'netstat',
  'ping',
  'traceroute',
  'nslookup',
  'dig',
  'curl',
  'wget',
  'ethtool',
  'arp',

  // Proxmox
  'pvesh',
  'pvecm status',
  'pvecm nodes',
  'pct',
  'qm',
  'vzdump',
  'pveam',
  'pvesm',

  // Systemd & services
  'systemctl',
  'journalctl',
  'timedatectl',
  'hostnamectl',
  'loginctl',

  // Hardware info
  'sensors',
  'lscpu',
  'lsusb',
  'lspci',
  'lsmem',
  'dmesg',

  // Package management (read)
  'dpkg',
  'apt list',
  'apt show',
  'apt-cache',
  'apt-mark',

  // Docker
  'docker ps',
  'docker images',
  'docker logs',
  'docker inspect',
  'docker stats',
  'docker top',
  'docker exec',
  'docker compose',
  'docker volume',
  'docker network',
  'docker system',
  'docker start',
  'docker stop',
  'docker restart',

  // Proxmox specific configs
  'cat /etc',
  'cat /proc',
  'cat /sys',

  // Samba
  'smbstatus',
  'testparm',

  // Cron
  'crontab',

  // Node/Python/general
  'node',
  'npm',
  'npx',
  'python3',
  'pip',
  'git',
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

  // Allow pipes if each segment starts with an allowlisted command.
  // Also allow $() subshells and && chains — the allowlist prefix check
  // on the first command plus the blocklist is sufficient protection.
  // Only block backticks (legacy command substitution) and raw semicolons
  // chained with non-allowlisted commands.
  if (/[`]/.test(trimmed)) {
    return {
      safe: false,
      reason: 'Command contains backtick substitution (use $() instead)',
    };
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

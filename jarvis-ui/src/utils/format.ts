/**
 * Format bytes to human-readable string (KB, MB, GB, TB).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return val.toFixed(1) + ' ' + units[i];
}

/**
 * Format seconds to human-readable uptime string (Xd Xh Xm).
 */
export function formatUptime(seconds: number): string {
  if (seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(days + 'd');
  if (hours > 0) parts.push(hours + 'h');
  if (minutes > 0 || parts.length === 0) parts.push(minutes + 'm');
  return parts.join(' ');
}

/**
 * Format seconds to long uptime string (X days, X hours, X minutes).
 */
export function formatUptimeLong(seconds: number): string {
  if (seconds <= 0) return '0 minutes';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(days + (days !== 1 ? ' days' : ' day'));
  if (hours > 0) parts.push(hours + (hours !== 1 ? ' hours' : ' hour'));
  if (minutes > 0) parts.push(minutes + (minutes !== 1 ? ' minutes' : ' minute'));
  return parts.join(', ') || '0 minutes';
}

/**
 * Format a fraction (0-1) to percentage string (e.g., "23%").
 */
export function formatPercent(fraction: number): string {
  return Math.round(fraction * 100) + '%';
}

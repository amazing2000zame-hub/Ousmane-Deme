/**
 * URL validation with SSRF (Server-Side Request Forgery) protection.
 *
 * Validates download URLs before JARVIS fetches them, blocking requests
 * to private/internal IP addresses, loopback, link-local, and non-HTTP
 * protocols. Hostnames are resolved via DNS and checked against a
 * comprehensive private IP blocklist built with net.BlockList.
 *
 * Uses only Node.js built-ins: node:net (BlockList), node:dns/promises (lookup).
 */

import net from 'node:net';
import dns from 'node:dns/promises';
import { logSafetyAudit } from './paths.js';

// ---------------------------------------------------------------------------
// Private IP blocklist
// ---------------------------------------------------------------------------

/**
 * Comprehensive blocklist of private, reserved, and internal IP ranges.
 * Used to prevent SSRF attacks where a URL resolves to an internal host.
 */
export const PRIVATE_IP_BLOCKLIST = new net.BlockList();

// RFC 1918 private ranges
PRIVATE_IP_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');       // 10.0.0.0/8
PRIVATE_IP_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');     // 172.16.0.0/12
PRIVATE_IP_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');    // 192.168.0.0/16

// Loopback
PRIVATE_IP_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');       // 127.0.0.0/8

// Link-local (APIPA)
PRIVATE_IP_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4');    // 169.254.0.0/16

// Null / broadcast / "this network"
PRIVATE_IP_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4');         // 0.0.0.0/8

// IPv6 loopback
PRIVATE_IP_BLOCKLIST.addSubnet('::1', 128, 'ipv6');            // ::1/128

// IPv6 unique local (private)
PRIVATE_IP_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6');           // fc00::/7

// IPv6 link-local
PRIVATE_IP_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6');          // fe80::/10

// ---------------------------------------------------------------------------
// URL validation result
// ---------------------------------------------------------------------------

export interface UrlValidationResult {
  /** Whether the URL is safe to fetch */
  safe: boolean;
  /** Parsed URL object (only set when safe=true) */
  parsedUrl?: URL;
  /** The IP address the hostname resolved to (only set when safe=true) */
  resolvedIp?: string;
  /** Human-readable denial reason (only set when safe=false) */
  reason?: string;
}

// ---------------------------------------------------------------------------
// validateUrl
// ---------------------------------------------------------------------------

/**
 * Validate a URL for safe fetching by JARVIS.
 *
 * Steps:
 *  1. Parse the URL (reject malformed URLs)
 *  2. Check protocol allowlist (http: and https: only)
 *  3. Resolve hostname to IP via DNS
 *  4. Check resolved IP against PRIVATE_IP_BLOCKLIST
 *
 * @param rawUrl - The URL string to validate
 */
export async function validateUrl(rawUrl: string): Promise<UrlValidationResult> {
  // Step 1: Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL format.' };
  }

  // Step 2: Protocol allowlist
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    await logSafetyAudit('ssrf_blocked', {
      url: rawUrl,
      protocol: parsedUrl.protocol,
      reason: 'disallowed_protocol',
    });
    return {
      safe: false,
      reason: `I can only download from http or https URLs, not ${parsedUrl.protocol.replace(':', '')}.`,
    };
  }

  // Step 3: Resolve hostname to IP
  const hostname = parsedUrl.hostname;

  // Handle IP literals directly (skip DNS)
  if (net.isIP(hostname)) {
    const family = hostname.includes(':') ? 'ipv6' : 'ipv4';
    if (PRIVATE_IP_BLOCKLIST.check(hostname, family)) {
      await logSafetyAudit('ssrf_blocked', {
        url: rawUrl,
        ip: hostname,
        reason: 'private_ip_literal',
      });
      return { safe: false, reason: "I can't download from internal addresses." };
    }
    return { safe: true, parsedUrl, resolvedIp: hostname };
  }

  // DNS lookup for hostnames
  let resolvedIp: string;
  try {
    const result = await dns.lookup(hostname);
    resolvedIp = result.address;
  } catch (err) {
    return {
      safe: false,
      reason: `I can't resolve the hostname "${hostname}" -- ${err instanceof Error ? err.message : 'DNS lookup failed'}.`,
    };
  }

  // Step 4: Check resolved IP against blocklist
  const family = resolvedIp.includes(':') ? 'ipv6' : 'ipv4';
  if (PRIVATE_IP_BLOCKLIST.check(resolvedIp, family)) {
    await logSafetyAudit('ssrf_blocked', {
      url: rawUrl,
      hostname,
      resolvedIp,
      reason: 'resolves_to_private_ip',
    });
    return { safe: false, reason: "I can't download from internal addresses." };
  }

  return { safe: true, parsedUrl, resolvedIp };
}

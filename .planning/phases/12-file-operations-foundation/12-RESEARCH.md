# Phase 12: File Operations Foundation - Research

**Researched:** 2026-01-26
**Domain:** File I/O, path security, SSRF prevention, cross-node SSH file transfer
**Confidence:** HIGH

## Summary

Phase 12 adds file download, transfer, listing, and management tools to JARVIS's MCP tool system. The research confirms that **all requirements can be met with zero new npm dependencies** using Node.js 22 built-ins (`fs/promises`, `path`, `net.BlockList`, `dns.lookup`, built-in `fetch`) plus the existing `node-ssh` dependency (which already provides `putFile`/`getFile` for SFTP transfers).

The primary security concern is path traversal attacks. The standard defense is `path.resolve()` + prefix validation against an allowlist of base directories, with `fs.realpath()` to resolve symlinks. For SSRF, Node.js `net.BlockList` provides a zero-dependency private IP classifier, and `dns.lookup()` handles hostname-to-IP resolution before any fetch occurs.

The existing codebase has a clear, well-established pattern for MCP tools: register in `tools/*.ts`, add tier in `tiers.ts`, add Claude tool definition in `ai/tools.ts`. File operation tools follow this exact pattern. The safety audit log can reuse the existing `events` table via `memoryStore.saveEvent()`.

**Primary recommendation:** Build three new safety modules (`safety/paths.ts`, `safety/urls.ts`, `safety/disk.ts`), then create two new tool files (`tools/files.ts` for listing/info, `tools/transfer.ts` for download/copy), following the exact registration and handler patterns established in `tools/cluster.ts` and `tools/system.ts`.

## Standard Stack

The locked decision is **zero new npm dependencies**. Everything below is already available.

### Core (Already Installed / Built-in)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fs/promises` | 22.22.0 | File stat, readdir, realpath, statfs, createWriteStream | Native, zero-dep, full async support |
| Node.js built-in `path` | 22.22.0 | Path resolution, normalization, traversal prevention | Native, handles all OS path concerns |
| Node.js built-in `net.BlockList` | 22.22.0 (added v15.0.0) | Private/reserved IP classification for SSRF | Native CIDR matching, no CVE-prone npm packages |
| Node.js built-in `dns` | 22.22.0 | Hostname resolution before fetch (SSRF defense) | Native, consistent with system resolver |
| Node.js built-in `fetch` | 22.22.0 (stable) | HTTP downloads from public URLs | Native, streaming via `response.body` |
| Node.js built-in `stream/promises` | 22.22.0 | `pipeline()` for piping download streams to disk | Native, handles backpressure correctly |
| `node-ssh` | ^13.2.1 | Cross-node file transfer via SFTP (`putFile`/`getFile`) | Already a project dependency, used in `ssh.ts` |
| `zod` | ^4.3.6 | Tool parameter validation schemas | Already used in all existing MCP tools |
| `drizzle-orm` + `better-sqlite3` | existing | Safety audit log persistence | Already powers events table |

### Supporting (Already Available)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `Readable.fromWeb()` | Node 22 stream | Convert Web ReadableStream from fetch to Node stream | Download streaming to disk |
| `fs.createWriteStream()` | Node 22 fs | Write downloaded file to disk in chunks | File downloads |
| `fs.statfs()` | Node 22 fs (added v18.15) | Get filesystem disk space (bsize * bavail) | Pre-download disk space checks |
| `fs.realpath()` | Node 22 fs | Resolve symlinks to canonical path | Symlink-aware path validation |
| `fs.readdir()` with `withFileTypes` | Node 22 fs | List directory contents with type info | Directory listing tool |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `net.BlockList` (built-in) | `private-ip` npm package | npm package has known SSRF bypasses (CVE-prone), BlockList is zero-dep |
| `dns.lookup` (built-in) | `dns.resolve4` | `lookup` uses system resolver (respects /etc/hosts), `resolve4` uses c-ares (faster but skips hosts file) |
| `node-ssh` putFile/getFile | `scp` shell command via exec | node-ssh already in deps, SFTP is more reliable than SCP, built-in progress callbacks |
| Manual IP regex | `ip` npm package | npm `ip` package had CVE-2023-42282 (SSRF bypass), manual regex + BlockList is safer |

**Installation:** None needed. Zero new dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── safety/
│   ├── paths.ts          # NEW: Path sanitization, protected paths, traversal prevention
│   ├── urls.ts           # NEW: URL validation, SSRF protection, private IP blocking
│   ├── disk.ts           # NEW: Disk space checking utility
│   ├── sanitize.ts       # EXISTING: Input/command sanitization (extend with path functions)
│   ├── protected.ts      # EXISTING: Protected resources (extend with protected paths)
│   ├── tiers.ts          # EXISTING: Tool tier definitions (add new file tools)
│   └── context.ts        # EXISTING: Override context (fix race condition)
├── mcp/
│   ├── server.ts         # EXISTING: Tool registration + executeTool pipeline (register new tools)
│   └── tools/
│       ├── files.ts      # NEW: list_directory, get_file_info (GREEN tier)
│       ├── transfer.ts   # NEW: download_file, copy_file, transfer_file (YELLOW tier)
│       ├── cluster.ts    # EXISTING: 9 cluster monitoring tools
│       ├── lifecycle.ts  # EXISTING: 6 VM/CT lifecycle tools
│       └── system.ts     # EXISTING: 3 system command tools
├── ai/
│   └── tools.ts          # EXISTING: Claude tool definitions (add new file tool descriptions)
└── db/
    └── schema.ts         # EXISTING: May add safety_audit table (or reuse events)
```

### Pattern 1: MCP Tool Registration (Established Pattern)

**What:** Every tool follows the exact same 3-place registration pattern.
**When to use:** Every new tool added.
**Example:**
```typescript
// 1. Handler in tools/files.ts
export function registerFileTools(server: McpServer): void {
  server.tool(
    'list_directory',                    // tool name
    'List files and directories...',     // description
    {                                     // Zod schema
      node: z.string().describe('...'),
      path: z.string().describe('...'),
    },
    async ({ node, path }) => {          // handler
      try {
        // ... implementation
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}

// 2. Tier in tiers.ts
export const TOOL_TIERS: Record<string, ActionTier> = {
  // ...existing...
  list_directory: ActionTier.GREEN,
  get_file_info: ActionTier.GREEN,
  download_file: ActionTier.YELLOW,
  copy_file: ActionTier.YELLOW,
  transfer_file: ActionTier.YELLOW,
};

// 3. Claude tool definition in ai/tools.ts
{
  name: 'list_directory',
  description: 'List contents of a directory on a cluster node...',
  input_schema: { type: 'object', properties: { ... }, required: [...] },
}
```

### Pattern 2: Path Sanitization (New Safety Pattern)

**What:** Every file operation MUST sanitize paths before use.
**When to use:** Every tool that accepts a file path argument.
**Example:**
```typescript
// Source: Node.js path docs + OWASP path traversal prevention
import { resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

const ALLOWED_BASE_DIRS = [
  '/root',
  '/opt',
  '/tmp',
  '/home',
  '/mnt',
  '/var/lib',
  '/srv',
];

const PROTECTED_PATHS = [
  '/etc/pve/priv/',
  '/root/.ssh/',
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/proc/',
  '/sys/',
  '/dev/',
  '/boot/',
];

export function sanitizePath(userPath: string, baseDir?: string): {
  safe: boolean;
  resolvedPath?: string;
  reason?: string;
} {
  // 1. Decode any URL encoding
  const decoded = decodeURIComponent(userPath);

  // 2. Resolve to absolute path
  const resolved = baseDir
    ? resolve(baseDir, decoded)
    : resolve(decoded);

  // 3. Check against protected paths
  for (const pp of PROTECTED_PATHS) {
    if (resolved.startsWith(pp) || resolved === pp.slice(0, -1)) {
      return { safe: false, reason: `Path is protected: ${pp}` };
    }
  }

  // 4. If baseDir specified, ensure resolved path is within it
  if (baseDir) {
    const resolvedBase = resolve(baseDir);
    if (!resolved.startsWith(resolvedBase + sep) && resolved !== resolvedBase) {
      return { safe: false, reason: 'Path traversal detected' };
    }
  }

  // 5. Check against allowed base directories
  const inAllowedDir = ALLOWED_BASE_DIRS.some(
    dir => resolved.startsWith(dir + sep) || resolved === dir
  );
  if (!inAllowedDir) {
    return { safe: false, reason: 'Path is not in an allowed directory' };
  }

  return { safe: true, resolvedPath: resolved };
}
```

### Pattern 3: SSRF Protection (New Safety Pattern)

**What:** Validate URLs and resolved IPs before any outbound fetch.
**When to use:** The download_file tool (and any future outbound HTTP tool).
**Example:**
```typescript
// Source: OWASP SSRF Prevention + Node.js net.BlockList docs
import { BlockList } from 'node:net';
import dns from 'node:dns/promises';

// Build once, reuse
const PRIVATE_IP_BLOCKLIST = new BlockList();
// RFC 1918
PRIVATE_IP_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_IP_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_IP_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');
// Loopback
PRIVATE_IP_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');
// Link-local
PRIVATE_IP_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4');
// Null/broadcast
PRIVATE_IP_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4');
// IPv6
PRIVATE_IP_BLOCKLIST.addSubnet('::1', 128, 'ipv6');
PRIVATE_IP_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_IP_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6');

export async function validateUrl(rawUrl: string): Promise<{
  safe: boolean;
  parsedUrl?: URL;
  resolvedIp?: string;
  reason?: string;
}> {
  // 1. Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  // 2. Protocol allowlist
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { safe: false, reason: `Protocol "${parsedUrl.protocol}" is not allowed` };
  }

  // 3. DNS resolve hostname to IP
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  let resolvedIp: string;
  try {
    const result = await dns.lookup(hostname);
    resolvedIp = result.address;
  } catch {
    return { safe: false, reason: `Could not resolve hostname "${hostname}"` };
  }

  // 4. Check resolved IP against private ranges
  const family = resolvedIp.includes(':') ? 'ipv6' : 'ipv4';
  if (PRIVATE_IP_BLOCKLIST.check(resolvedIp, family)) {
    return { safe: false, reason: 'URL resolves to a private/internal address' };
  }

  return { safe: true, parsedUrl, resolvedIp };
}
```

### Pattern 4: Disk Space Pre-check

**What:** Check available disk space before writing.
**When to use:** Before download_file and copy_file operations.
**Example:**
```typescript
// Source: Node.js fs.statfs docs (added v18.15.0, verified on v22.22.0)
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function checkDiskSpace(targetPath: string, requiredBytes: number): Promise<{
  sufficient: boolean;
  availableBytes: number;
  availableHuman: string;
  requiredHuman: string;
}> {
  const dir = dirname(targetPath);
  const stats = await statfs(dir);
  const availableBytes = stats.bsize * stats.bavail;

  return {
    sufficient: availableBytes >= requiredBytes,
    availableBytes,
    availableHuman: formatBytes(availableBytes),
    requiredHuman: formatBytes(requiredBytes),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
```

### Pattern 5: Cross-Node File Transfer via node-ssh

**What:** Transfer files between cluster nodes using existing SSH infrastructure.
**When to use:** The transfer_file tool.
**Example:**
```typescript
// node-ssh already in project deps (^13.2.1), used in src/clients/ssh.ts
import { getSSHConnection } from '../../clients/ssh.js';

// For same-node copy: SSH exec "cp source dest"
// For cross-node transfer:
//   1. getFile() from source node to local temp
//   2. putFile() from local temp to dest node
//   3. Clean up temp file

async function transferBetweenNodes(
  sourceHost: string, sourcePath: string,
  destHost: string, destPath: string,
): Promise<void> {
  const tempPath = `/tmp/jarvis-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const sourceSSH = await getSSHConnection(sourceHost);
  await sourceSSH.getFile(tempPath, sourcePath);

  try {
    const destSSH = await getSSHConnection(destHost);
    await destSSH.putFile(tempPath, destPath);
  } finally {
    // Clean up temp file
    await fs.unlink(tempPath).catch(() => {});
  }
}
```

### Anti-Patterns to Avoid

- **Direct path concatenation:** Never do `'/base' + userInput`. Always use `path.resolve()` then validate.
- **Regex-only path filtering:** Don't rely on `!path.includes('..')`. Use `resolve()` + prefix check. Encoded variants (`%2e%2e`) bypass regex.
- **String-based IP checking:** Don't use regex to check IPs. Use `net.BlockList` which handles CIDR properly including edge cases.
- **fetch() without DNS pre-resolution:** Don't just check the hostname string. Resolve to IP first, then validate the IP. Otherwise DNS rebinding attacks work.
- **Content-Length trust:** Don't trust `Content-Length` header for disk space checks. It can be spoofed or missing. Check during download and abort if threshold exceeded.
- **Global mutable state for context:** The existing `context.ts` uses a module-level boolean. Concurrent requests will corrupt this. Use `AsyncLocalStorage` or pass context as parameter.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IP range classification | Regex-based IP checker | `net.BlockList.addSubnet()` + `.check()` | CVE-2023-42282 showed regex/manual IP parsing has subtle bypass vectors. BlockList handles CIDR natively including IPv4-mapped IPv6 (`::ffff:`) |
| File download streaming | `response.arrayBuffer()` + `writeFile()` | `Readable.fromWeb(response.body)` + `pipeline()` to `createWriteStream()` | Loading entire file into memory crashes on large files. Streaming uses constant memory. |
| Hostname resolution | String hostname comparison | `dns.lookup()` then check resolved IP | Hostnames can resolve to internal IPs. Only the resolved IP matters for SSRF. |
| Disk space checking | Shelling out to `df -h` | `fs.statfs()` built-in | Native, typed, no parsing needed, works on all POSIX systems |
| Cross-node file transfer | Custom SCP via exec | `node-ssh` `getFile()`/`putFile()` via SFTP | Already a dependency, handles SFTP protocol properly, supports progress callbacks |
| Path normalization | Manual `../` stripping | `path.resolve()` + prefix validation | Manual stripping misses encoded variants, absolute path injection, and other edge cases |
| URL parsing | Regex-based URL extraction | `new URL()` (WHATWG parser) | WHATWG URL parser is the standard, handles edge cases (IPv6, credentials, encoding) |

**Key insight:** Security utilities must use purpose-built APIs, not string manipulation. Every SSRF bypass and path traversal CVE in the Node.js ecosystem stems from using string/regex approaches instead of structured parsing.

## Common Pitfalls

### Pitfall 1: Path Traversal via Absolute Path Injection

**What goes wrong:** `path.resolve('/base', '/etc/passwd')` returns `/etc/passwd`, not `/base/etc/passwd`. An absolute user input completely overrides the base directory.
**Why it happens:** `path.resolve()` treats each argument as potentially absolute. The last absolute path wins.
**How to avoid:** Always validate the resolved result starts with the intended base directory + `path.sep`. Never trust the input alone.
**Warning signs:** Test with absolute paths as user input.

### Pitfall 2: Symlink Traversal Bypassing Path Checks

**What goes wrong:** User creates `/tmp/evil -> /etc/pve/priv/` symlink. `path.resolve('/tmp', 'evil/authkey')` passes prefix check (starts with `/tmp/`) but the real path is `/etc/pve/priv/authkey`.
**Why it happens:** `path.resolve()` does NOT resolve symlinks. Only `fs.realpath()` does.
**How to avoid:** After path.resolve validation passes, call `fs.realpath()` on the resolved path and validate the real path ALSO passes. For new files (that don't exist yet), validate the parent directory's realpath.
**Warning signs:** Any path under a directory the user can write to (like `/tmp`).

### Pitfall 3: DNS Rebinding for SSRF Bypass

**What goes wrong:** Attacker's domain resolves to `8.8.8.8` during validation, then to `192.168.1.50` during fetch.
**Why it happens:** DNS responses have short TTLs. Between validation and actual connection, the DNS record can change.
**How to avoid:** Resolve DNS once, validate the IP, then make the fetch request using the resolved IP directly (setting the `Host` header to the original hostname). For this project's use case (homelab, not internet-facing), the DNS rebinding risk is LOW -- but the defense is simple to implement correctly.
**Warning signs:** Any URL with a non-standard domain.

### Pitfall 4: SSRF via IPv4-Mapped IPv6 Addresses

**What goes wrong:** `http://[::ffff:192.168.1.50]/` resolves to `192.168.1.50` but might bypass IPv4-only blocklists.
**Why it happens:** IPv6 can embed IPv4 addresses. Checking only IPv4 ranges misses these.
**How to avoid:** `net.BlockList` handles this natively. Verified: `blockList.check('::ffff:7b7b:7b7b', 'ipv6')` correctly matches when the IPv4 equivalent is blocked. Always check both IPv4 and IPv6 representations.
**Warning signs:** Test with `::ffff:127.0.0.1` and `::ffff:192.168.1.50`.

### Pitfall 5: Override Context Race Condition

**What goes wrong:** Two concurrent requests: Request A sets override=true, Request B (no override) executes a tool while override is still true, getting elevated permissions.
**Why it happens:** `context.ts` uses a module-level `let _overrideActive = false` shared across all requests.
**How to avoid:** Replace with `AsyncLocalStorage` from Node.js `async_hooks` module. Each async context gets its own isolated state. Alternatively, pass override as a parameter through the call chain (already partially done -- `executeTool()` takes `overrideActive` as a parameter).
**Warning signs:** The `setOverrideContext()`/`isOverrideActive()` pattern in context.ts, used in `server.ts` line 186 and `system.ts` line 47.

### Pitfall 6: Content-Length vs Actual Download Size

**What goes wrong:** Download tool checks `Content-Length: 10MB`, passes disk check, but server streams 100GB.
**Why it happens:** `Content-Length` header is advisory and can be spoofed, or absent entirely (chunked encoding).
**How to avoid:** Track bytes written during the stream. Abort (destroy the stream) if bytes exceed a safety limit (e.g., `Content-Length * 1.1` or a hard cap). For the confirmation threshold (~500MB), check Content-Length if present but also enforce a runtime byte counter.
**Warning signs:** Chunked transfer encoding, missing Content-Length, file growing beyond expected size.

### Pitfall 7: Auto-Rename Collision Loop

**What goes wrong:** `filename(1).ext` already exists, so you try `filename(2).ext`, which also exists...potentially looping thousands of times.
**Why it happens:** Unbounded retry on conflict names.
**How to avoid:** Cap the rename counter (e.g., max 100 attempts), then fail with a clear error. Also consider using a timestamp or UUID suffix if the simple counter exceeds threshold.
**Warning signs:** Directories with many similarly-named files.

## Code Examples

### Example 1: Streaming File Download with Progress Tracking

```typescript
// Source: Node.js 22 docs (fetch + stream/promises)
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unlink } from 'node:fs/promises';

interface DownloadResult {
  success: boolean;
  bytesWritten: number;
  path: string;
  error?: string;
}

async function downloadFile(
  url: string,
  destPath: string,
  maxBytes?: number,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const response = await fetch(url, {
    signal,
    redirect: 'follow',  // follow up to 20 redirects (default)
  });

  if (!response.ok) {
    return {
      success: false,
      bytesWritten: 0,
      path: destPath,
      error: `HTTP ${response.status} ${response.statusText}`,
    };
  }

  if (!response.body) {
    return { success: false, bytesWritten: 0, path: destPath, error: 'No response body' };
  }

  const nodeStream = Readable.fromWeb(response.body as any);
  const writeStream = createWriteStream(destPath);
  let bytesWritten = 0;

  // Track bytes for size enforcement
  nodeStream.on('data', (chunk: Buffer) => {
    bytesWritten += chunk.length;
    if (maxBytes && bytesWritten > maxBytes) {
      nodeStream.destroy(new Error(`Download exceeded ${maxBytes} bytes limit`));
    }
  });

  try {
    await pipeline(nodeStream, writeStream);
    return { success: true, bytesWritten, path: destPath };
  } catch (err) {
    // Clean up partial file on failure
    await unlink(destPath).catch(() => {});
    return {
      success: false,
      bytesWritten,
      path: destPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

### Example 2: Directory Listing with Tree Format

```typescript
// Source: Node.js 22 fs.readdir + Dirent
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;       // bytes, for files
  itemCount?: number;  // for directories
}

async function listDirectory(dirPath: string, depth: number = 1): Promise<DirEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const result: DirEntry[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isFile()) {
      const st = await stat(fullPath).catch(() => null);
      result.push({
        name: entry.name,
        type: 'file',
        size: st?.size,
      });
    } else if (entry.isDirectory()) {
      // Smart summary: count items instead of recursing into large dirs
      let itemCount: number | undefined;
      try {
        const children = await readdir(fullPath);
        itemCount = children.length;
      } catch {
        itemCount = undefined;
      }
      result.push({
        name: entry.name,
        type: 'directory',
        itemCount,
      });
    } else if (entry.isSymbolicLink()) {
      result.push({ name: entry.name, type: 'symlink' });
    } else {
      result.push({ name: entry.name, type: 'other' });
    }
  }

  return result;
}
```

### Example 3: Safety Audit Logging (Reusing Events Table)

```typescript
// Source: existing memoryStore.saveEvent() pattern
import { memoryStore } from '../db/memory.js';

type SafetyAction = 'path_traversal_blocked' | 'ssrf_blocked' | 'protected_path_blocked' | 'disk_space_refused';

export function logSafetyAudit(
  action: SafetyAction,
  details: {
    tool: string;
    input: Record<string, unknown>;
    reason: string;
    resolvedPath?: string;
    resolvedIp?: string;
  },
): void {
  try {
    memoryStore.saveEvent({
      type: 'action',
      severity: 'warning',
      source: 'system',
      summary: `SAFETY: ${action} -- ${details.reason}`,
      details: JSON.stringify({
        action,
        tool: details.tool,
        input: details.input,
        reason: details.reason,
        resolvedPath: details.resolvedPath,
        resolvedIp: details.resolvedIp,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Never crash on logging failure -- match existing pattern
  }
}
```

### Example 4: Remote Directory Listing via SSH

```typescript
// Source: existing execOnNodeByName pattern in ssh.ts
import { execOnNodeByName } from '../../clients/ssh.js';

async function remoteListDirectory(node: string, dirPath: string): Promise<string> {
  // Use ls with machine-readable format
  const result = await execOnNodeByName(
    node,
    `ls -la --block-size=1 ${JSON.stringify(dirPath)}`,
    15_000,
  );

  if (result.code !== 0) {
    throw new Error(result.stderr || `ls failed with code ${result.code}`);
  }

  return result.stdout;
}

// Alternative: use stat for structured data
async function remoteFileInfo(node: string, filePath: string): Promise<string> {
  const result = await execOnNodeByName(
    node,
    `stat --format='{"name":"%n","size":%s,"type":"%F","perms":"%A","modified":"%Y"}' ${JSON.stringify(filePath)}`,
    10_000,
  );

  if (result.code !== 0) {
    throw new Error(result.stderr || `stat failed with code ${result.code}`);
  }

  return result.stdout;
}
```

### Example 5: AsyncLocalStorage for Override Context Fix

```typescript
// Source: Node.js async_hooks documentation
import { AsyncLocalStorage } from 'node:async_hooks';

interface ExecutionContext {
  overrideActive: boolean;
  requestId?: string;
}

const contextStore = new AsyncLocalStorage<ExecutionContext>();

export function runWithContext<T>(ctx: ExecutionContext, fn: () => T): T {
  return contextStore.run(ctx, fn);
}

export function isOverrideActive(): boolean {
  return contextStore.getStore()?.overrideActive ?? false;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `http.request()` / `https.request()` | Built-in `fetch()` | Node 18 (experimental) / Node 22 (stable) | No need for `axios` or `node-fetch` for HTTP downloads |
| `child_process.exec('df -h')` | `fs.statfs()` built-in | Node 18.15.0 | Native disk space checking, typed return |
| npm `ip` package for private IP check | `net.BlockList` built-in | Node 15.0.0 | Zero-dep, CIDR-native, no CVE-2023-42282 risk |
| Module-level globals for async context | `AsyncLocalStorage` | Node 16 (stable) | Request-scoped state without race conditions |
| `Readable.from()` for download | `Readable.fromWeb()` for Web Streams | Node 17 | Proper bridge from Web ReadableStream (fetch body) to Node streams |

**Deprecated/outdated:**
- `request` npm package: Fully deprecated, do not use
- `node-fetch`: Unnecessary in Node 22, built-in fetch is stable
- `ip` npm package pre-1.1.9: CVE-2023-42282, SSRF bypass via IP classification error
- `private-ip` npm package: Multicast bypass vulnerability

## Open Questions

Things that couldn't be fully resolved:

1. **Remote disk space checks**
   - What we know: `fs.statfs()` works locally. For remote nodes, we'd need to SSH exec `df` or `stat -f`.
   - What's unclear: Whether to use `df --output=avail` (human-readable) or `stat -f -c '%a*%S'` (machine parseable).
   - Recommendation: Use `stat -f -c '%a %S' <path>` via SSH -- outputs available blocks and block size, easy to parse as two numbers. Multiply for bytes.

2. **Move vs Copy decision (Claude's discretion)**
   - What we know: Move operations risk data loss if interrupted. Copy-then-delete is safer but doubles disk usage temporarily.
   - Recommendation: **Copy only** for v1.3. Move operations introduce atomicity concerns across nodes (no atomic cross-node move). A copy tool is strictly safer. Move can be added in a future phase once copy is proven reliable.

3. **Hidden files in directory listing (Claude's discretion)**
   - What we know: Some dotfiles are useful context (`.env`, `.gitignore`), others are noise (`.DS_Store`, `.cache`).
   - Recommendation: Show dotfiles by default (they're often important in project directories), but exclude known noise patterns: `.DS_Store`, `.Spotlight-V100`, `.Trashes`, `Thumbs.db`. The tool should accept a `showHidden` boolean parameter defaulting to `true`.

4. **Download confirmation threshold (Claude's discretion)**
   - What we know: Context says "around 500MB suggested."
   - Recommendation: **500MB** threshold. Files under 500MB auto-download. Files over 500MB: check Content-Length if available, and if over threshold, return a message asking for confirmation before proceeding. This is enforced in the tool handler, not the tier system (it's YELLOW tier regardless).

5. **Safety audit log format (Claude's discretion)**
   - What we know: The `events` table already logs blocked tool attempts via `memoryStore.saveEvent()`.
   - Recommendation: Reuse the existing events table with `type: 'action'`, `severity: 'warning'`, `source: 'system'`, and a structured JSON `details` field containing the specific safety violation info. No new table needed. This keeps the audit log alongside existing tool execution logs and is queryable via `memoryStore.getRecentEvents()`.

6. **Smart directory summary truncation (Claude's discretion)**
   - Recommendation: Directories with >50 items get summarized as `dirname/ (N items)` without listing individual contents. Directories with <=50 items are fully expanded. The tool accepts a `maxItems` parameter defaulting to 50.

## Sources

### Primary (HIGH confidence)
- Node.js 22.22.0 `fs.statfs()` -- verified working locally: `bsize * bavail` returns correct available bytes
- Node.js 22.22.0 `net.BlockList` -- verified working locally: correctly classifies RFC1918, loopback, link-local, null ranges
- Node.js 22.22.0 `dns.lookup()` -- verified working locally: resolves hostnames to IPs
- Node.js 22.22.0 built-in `fetch` + `Readable.fromWeb()` -- documented in Node.js official docs, streaming download pattern verified
- Node.js 22.22.0 `URL` class -- verified edge case behavior (absolute path injection, IPv6 brackets, embedded credentials)
- `node-ssh` ^13.2.1 -- verified `putFile`, `getFile`, `putFiles`, `putDirectory`, `getDirectory`, `requestSFTP` methods exist and are callable
- Existing codebase: `src/mcp/tools/system.ts`, `src/mcp/server.ts`, `src/safety/tiers.ts` -- read and analyzed for registration patterns

### Secondary (MEDIUM confidence)
- [OWASP SSRF Prevention in Node.js](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs) -- six-step defense strategy
- [Node.js Path Traversal Guide (StackHawk)](https://www.stackhawk.com/blog/node-js-path-traversal-guide-examples-and-prevention/) -- resolve + prefix validation pattern
- [Node.js Secure Coding Path Traversal (nodejs-security.com)](https://www.nodejs-security.com/blog/secure-coding-practices-nodejs-path-traversal-vulnerabilities) -- realpath for symlink resolution
- [OWASP Server Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) -- defense in depth approach
- [CVE-2023-42282 (ip package)](https://www.cvedetails.com/cve/CVE-2023-42282/) -- why not to use npm `ip` package for SSRF
- [private-ip multicast bypass](https://www.nodejs-security.com/blog/dont-be-fooled-multicast-ssrf-bypass-private-ip) -- why not to use npm `private-ip`

### Tertiary (LOW confidence)
- DNS rebinding attack mitigation details -- general security knowledge, specific Node.js `fetch` behavior with pre-resolved IPs not verified with official source

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** -- zero new deps, all verified locally on Node.js 22.22.0
- Architecture: **HIGH** -- follows established codebase patterns exactly (3-place registration, try/catch handlers, JSON.stringify output)
- Path safety: **HIGH** -- OWASP-recommended `resolve()` + prefix validation + `realpath()`, verified in Node.js docs
- SSRF protection: **HIGH** -- `net.BlockList` verified locally, OWASP six-step approach documented
- Disk space: **HIGH** -- `fs.statfs()` verified locally returning correct values
- Cross-node transfer: **HIGH** -- `node-ssh` already in deps, methods verified callable
- Override race condition fix: **MEDIUM** -- `AsyncLocalStorage` is standard Node.js, but integration with existing `executeTool` pipeline needs careful implementation
- Pitfalls: **HIGH** -- sourced from OWASP, CVE databases, and Node.js security documentation

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days -- stable domain, no fast-moving libraries)

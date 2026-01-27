---
phase: 12-file-operations-foundation
plan: 03
subsystem: file-operations
tags: [download, sftp, streaming, ssrf, file-transfer, mcp-tools]

# Dependency graph
requires:
  - phase: 12-01
    provides: "path sanitization (sanitizePath), URL validation (validateUrl), disk space checks (checkDiskSpace/checkRemoteDiskSpace)"
  - phase: 12-02
    provides: "file tools pattern (registerFileTools), MCP tool registration convention, 20-tool baseline"
provides:
  - "download_file MCP tool: streaming HTTP downloads with SSRF protection"
  - "copy_file MCP tool: same-node file copy with disk pre-check"
  - "transfer_file MCP tool: cross-node SFTP transfer via Home intermediary"
  - "registerTransferTools() export for MCP server registration"
affects:
  - "Phase 15 (voice retraining): download_file enables fetching training audio from URLs"
  - "Any future file management: transfer_file enables moving files between nodes"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Streaming download via Readable.fromWeb() + pipeline() instead of arrayBuffer()"
    - "Auto-rename on conflict: filename(1).ext pattern capped at 100 attempts"
    - "Home node as SFTP intermediary for cross-node transfers"
    - "HEAD request pre-check for Content-Length before streaming"

key-files:
  created:
    - "jarvis-backend/src/mcp/tools/transfer.ts"
  modified:
    - "jarvis-backend/src/safety/tiers.ts"
    - "jarvis-backend/src/ai/tools.ts"
    - "jarvis-backend/src/mcp/server.ts"

key-decisions:
  - "All 3 transfer tools are YELLOW tier (auto-execute with logging, no confirmation needed)"
  - "Downloads > 500MB return a text message for Claude to relay as confirmation prompt, not a hard block"
  - "Cross-node transfers route through Home as SFTP intermediary with temp file cleanup in finally block"
  - "Auto-rename uses filename(1).ext convention, capped at 100 attempts to prevent infinite loops"
  - "Remote unique filename check uses SSH test -f per candidate (acceptable for 100-cap)"

patterns-established:
  - "Streaming download: Readable.fromWeb() + pipeline() + byte tracking via data event"
  - "SFTP transfer via getSSHConnection().putFile()/getFile() from node-ssh"
  - "Temp file pattern: /tmp/jarvis-download-{timestamp}-{random} with finally cleanup"

# Metrics
duration: 4min
completed: 2026-01-27
---

# Phase 12 Plan 03: File Transfer Tools Summary

**Three YELLOW-tier MCP tools for download, copy, and cross-node transfer with SSRF protection, disk pre-checks, and auto-rename on conflict**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-27T00:30:14Z
- **Completed:** 2026-01-27T00:34:28Z
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 3

## Accomplishments

- download_file streams files from public URLs with SSRF protection (via validateUrl), disk space pre-check, 500MB confirmation threshold, and retry on network error
- copy_file copies files within a single node (local fs.copyFile or remote SSH cp) with disk space check and auto-rename
- transfer_file moves files between cluster nodes via SFTP with Home as intermediary, temp file cleanup in finally block
- All three tools fully wired into 3-place registration pattern (tiers.ts, tools.ts, server.ts) bringing total to 23 tools

## Task Commits

Each task was committed atomically:

1. **Task 1: Create download, copy, and transfer MCP tool handlers** - `4f2bca0` (feat)
2. **Task 2: Register transfer tools in 3-place pattern and verify full build** - `be9ab45` (feat)

## Files Created/Modified

- `jarvis-backend/src/mcp/tools/transfer.ts` - Three MCP tool handlers: download_file, copy_file, transfer_file with helpers for unique filename resolution and node host lookup
- `jarvis-backend/src/safety/tiers.ts` - Added YELLOW tier entries for download_file, copy_file, transfer_file (24 total tier entries)
- `jarvis-backend/src/ai/tools.ts` - Added Claude-optimized descriptions for all 3 transfer tools (23 tool definitions)
- `jarvis-backend/src/mcp/server.ts` - Added import and registerTransferTools(mcpServer) call (5 register calls total)

## Decisions Made

- **YELLOW tier for all transfer tools:** Downloads and copies have side effects (write files) but are non-destructive -- auto-execute with logging is appropriate. The 500MB threshold provides a natural confirmation point through Claude's conversation flow.
- **Home as SFTP intermediary:** Cross-node transfers always route through Home (where the backend runs) since it has SSH connections to all nodes. Direct node-to-node SSH is not configured.
- **Auto-rename capped at 100:** Prevents infinite loops while giving plenty of room for duplicate names. Remote checks use individual SSH test -f calls, which is acceptable given the 100 cap.
- **HEAD pre-check for downloads:** Sends a HEAD request before GET to determine Content-Length for disk space validation and large file confirmation. Falls back to 10GB hard cap if HEAD fails.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 12 is now complete: all 3 plans shipped (safety modules, file listing tools, transfer tools)
- 23 MCP tools registered, full TypeScript build passes with zero errors
- Secret blocking still needed before project read tools ship (Phase 13 concern, not blocking Phase 12)
- Transfer tools are ready for Phase 15 (voice retraining) which needs download_file for fetching training audio

---
*Phase: 12-file-operations-foundation*
*Completed: 2026-01-27*

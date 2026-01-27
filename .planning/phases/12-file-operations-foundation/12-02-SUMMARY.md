---
phase: 12-file-operations-foundation
plan: 02
subsystem: file-operations
tags: [mcp-tools, directory-listing, file-info, tree-view, ssh, green-tier]

# Dependency graph
requires:
  - phase: 12-file-operations-foundation-01
    provides: "sanitizePath(), logSafetyAudit() for path validation and audit logging"
  - phase: 06-safety-layer
    provides: "sanitize.ts (sanitizeNodeName), tiers.ts (ActionTier), ssh.ts (execOnNodeByName)"
provides:
  - "list_directory MCP tool: tree-view directory listing with sizes and smart summarization"
  - "get_file_info MCP tool: detailed file metadata (size, type, permissions, modified date)"
  - "Both tools work on all 4 cluster nodes (local + remote via SSH)"
  - "Both tools enforce path sanitization before any filesystem access"
affects: [12-03-file-transfer-tools, 13-project-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local vs remote branching: Home node uses fs APIs, others use SSH"
    - "Tree-view formatting with smart summarization above maxItems threshold"
    - "Noise file filtering (.DS_Store, Thumbs.db, AppleDouble) in directory listings"
    - "Shell escape helper for safe SSH command construction"

key-files:
  created:
    - jarvis-backend/src/mcp/tools/files.ts
  modified:
    - jarvis-backend/src/safety/tiers.ts
    - jarvis-backend/src/ai/tools.ts
    - jarvis-backend/src/mcp/server.ts

key-decisions:
  - "Tree-view output as plain text, not JSON -- Claude presents it naturally to users"
  - "Directories sorted before files for visual hierarchy"
  - "Remote directory item counts fetched in a single batched SSH command (max 30 dirs)"
  - "stat command for remote file info with symlink detection via test -L"

patterns-established:
  - "File tool handler pattern: sanitizeNodeName -> sanitizePath -> local/remote branch -> format output"
  - "Remote SSH command parsing: ls -la --block-size=1 for directory, stat --format for file info"
  - "Smart summarization: all directories shown + first 20 files + summary line when >maxItems"

# Metrics
duration: 2min
completed: 2026-01-27
---

# Phase 12 Plan 02: File Tools Summary

**Two GREEN-tier MCP tools (list_directory, get_file_info) with tree-view formatting, smart summarization, and path sanitization -- wired into the 3-place registration pattern across tiers, Claude descriptions, and MCP server**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-27T00:24:01Z
- **Completed:** 2026-01-27T00:26:50Z
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 3

## Accomplishments
- list_directory tool returns tree-view formatted output with file sizes and directory item counts for any cluster node
- get_file_info tool returns structured metadata (size, type, permissions, modified date, symlink status)
- Both tools enforce path sanitization via sanitizePath() before any filesystem access
- Both tools registered as GREEN tier (auto-execute, no confirmation) with Claude-optimized descriptions
- Total MCP tools increased from 18 to 20

## Task Commits

Each task was committed atomically:

1. **Task 1: Create file listing and info MCP tool handlers** - `239c12e` (feat)
2. **Task 2: Register file tools in 3-place pattern** - `016c3ec` (feat)

## Files Created/Modified
- `jarvis-backend/src/mcp/tools/files.ts` - list_directory and get_file_info MCP tool handlers with local/remote support, tree-view formatting, noise file filtering, smart summarization
- `jarvis-backend/src/safety/tiers.ts` - Added list_directory and get_file_info as GREEN tier entries
- `jarvis-backend/src/ai/tools.ts` - Added Claude-optimized tool descriptions for LLM tool selection (20 tools total)
- `jarvis-backend/src/mcp/server.ts` - Import and registration of registerFileTools(mcpServer)

## Decisions Made
- **Tree-view as plain text:** list_directory returns formatted tree-view text (not JSON) so Claude can present it naturally in conversation. get_file_info returns JSON since it's structured metadata.
- **Smart summarization threshold:** Default maxItems=50. Above threshold: all directories shown with item counts, first 20 files listed, remaining files summarized with count.
- **Remote item counts batching:** Directory item counts on remote nodes fetched in a single batched SSH command (up to 30 directories) to minimize SSH round-trips.
- **Noise file filtering:** .DS_Store, .Spotlight-V100, .Trashes, Thumbs.db, desktop.ini, .fseventsd, and AppleDouble (._ prefixed) files are always excluded.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both file tools compile and are fully wired into the MCP pipeline
- Path sanitization tested via 12-01 safety modules (paths.ts)
- Ready for Plan 12-03 (file transfer/download tools) which will add write-capable file operations
- No blockers or concerns

---
*Phase: 12-file-operations-foundation*
*Completed: 2026-01-27*

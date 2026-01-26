# Phase 12: File Operations Foundation - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can ask JARVIS to download, transfer, and manage files across cluster nodes with safety guarantees against path traversal, SSRF, and disk exhaustion. This covers download from public URLs, copy/transfer between nodes and directories, and directory listing. Project browsing, code analysis, and voice retraining pipelines are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Download behavior
- Default to status messages ("Downloading...", then "Done (45MB, saved to /path)")
- Support verbose/live progress mode when user explicitly requests it
- Warn on large files but allow if user confirms (no hard size cap)
- Retry once on failure, then report the error to user
- Confirm before starting downloads above a size threshold (e.g., 500MB); auto-start for smaller files

### File transfer UX
- Auto-transfer without confirmation, EXCEPT when destination file already exists
- If destination exists: auto-rename (e.g., filename(1).ext) to avoid data loss; user can explicitly say "overwrite" to replace
- Show node names in transfer messages (e.g., "Copying config.json from Home to agent1...") -- no IPs

### Directory listing presentation
- Tree view format (nested hierarchy like the `tree` command)
- Show names + sizes (e.g., "config.json (2.4KB)") -- no dates by default
- Smart summary for large directories: show top-level dirs with item counts, skip individual files in huge dirs (e.g., node_modules → "node_modules/ (1,247 items)")

### Safety feedback
- Clear denial messages: "I can't access /etc/shadow -- that path is protected." -- explains what was blocked without over-explaining the mechanism
- SSRF blocks use the same tone: "I can't download from internal addresses."
- Blocked attempts logged to a persistent safety audit log (beyond just chat)
- Pre-check disk space before starting downloads -- refuse if not enough room

### Claude's Discretion
- Move vs copy support: Claude decides whether to support both or copy-only based on the safety model
- Hidden files: Claude decides per-context whether to show dotfiles (e.g., show .env in project dirs, hide in home dirs)
- Exact size threshold for download confirmation (around 500MB suggested)
- Exact truncation strategy for smart directory summaries
- Progress bar implementation details for verbose mode
- Safety audit log format and location

</decisions>

<specifics>
## Specific Ideas

- Download confirmation for large files should feel like a natural conversation, not a system dialog
- Auto-rename on conflict (filename(1).ext) prevents data loss by default -- overwrite only when explicitly requested
- Tree view with sizes gives a quick visual understanding of directory structure without clutter
- Safety denials should be clear but not alarming -- JARVIS is protecting the system, not scolding the user

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 12-file-operations-foundation*
*Context gathered: 2026-01-26*

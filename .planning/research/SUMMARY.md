# Project Research Summary

**Project:** Jarvis 3.1 v1.3 — File Operations & Project Intelligence
**Domain:** AI command center for infrastructure management with developer productivity tools
**Researched:** 2026-01-26
**Confidence:** HIGH

## Executive Summary

This milestone extends Jarvis from cluster management into developer productivity by adding file operations, project browsing, code analysis, and voice retraining capabilities. The research reveals a critical architectural principle: the existing SSH infrastructure and Node.js 22 built-ins handle all requirements with ZERO new npm dependencies. File operations are SSH-based (not agent-based), project intelligence leverages the existing project registry on agent1, code analysis uses the existing Claude API (not AST parsing), and voice retraining orchestrates existing tools (ffmpeg, yt-dlp) via command execution.

The recommended approach is a layered build: foundational file operations first (with rigorous path sanitization), then project browsing (with secret blocklisting), then code analysis (read-only with prompt injection guards), and finally voice retraining (resource-managed background processes). Each layer depends on the previous, making sequential delivery essential. The existing 4-tier safety framework extends cleanly to file operations through path validation and protected paths lists.

Key risks center on filesystem security: path traversal (Pitfall 1), SSRF via file downloads (Pitfall 2), and secret exposure through project browsing (Pitfall 3). All three are preventable through validation infrastructure built in Phase 1. Additional risks include disk exhaustion (Home node at 52% usage), ffmpeg RCE vulnerabilities when processing untrusted video, and LLM-driven prompt injection through malicious file contents. The mitigation strategy is defense in depth: path canonicalization, URL blocklists, sensitive file patterns, size limits, and read-only tool modes during analysis.

## Key Findings

### Recommended Stack

The v1.3 stack adds ZERO npm packages to the backend. Every file operation, project browsing, and code analysis capability uses Node.js 22 built-in APIs or existing infrastructure. This is a key finding: modern Node.js eliminates the need for third-party libraries in most cases.

**Core technologies (all already available):**
- **Node.js 22 `fetch()`** — Built-in HTTP downloads with streaming support via `Readable.fromWeb()`. Zero dependencies, replaces axios/got/node-fetch.
- **Node.js 22 `fs.glob()`** — Stable since v22.17.0 for pattern-based file search. Replaces glob/fast-glob/globby npm packages.
- **Node.js 22 `fs/promises`** — `readFile()`, `readdir({ recursive: true })`, `stat()` for all file operations. Built-in, zero dependencies.
- **Node.js 22 `child_process`** — Execute ffmpeg (v7.1.3 on host), yt-dlp (v2025.12.08 on host), docker exec for TTS training. Standard library, no wrappers needed.
- **Existing `node-ssh` (v13.2.1)** — Extend with `getFile()`/`putFile()` for cross-node file transfer. Already in use for cluster SSH.
- **Existing `@anthropic-ai/sdk`** — Claude API for code analysis. LLM-powered analysis, not AST parsing.
- **Python additions (TTS container only):** `pydub>=0.25.1` for audio segmentation, `faster-whisper>=1.1.0` for transcription.

**Critical rejection (what NOT to use):**
- `fluent-ffmpeg` — Archived May 2025, unmaintained, broken with recent ffmpeg versions. Use direct `child_process.execFile()` instead.
- `ytdlp-nodejs` — Bundles its own 30MB+ binary, conflicts with host yt-dlp. Use CLI directly.
- AST parsing libraries (babel, acorn, tree-sitter) — LLMs understand code from source text. AST parsing is for automated refactoring (not in scope).
- Vector DB/embeddings (ChromaDB, Pinecone) — Overkill for 24 projects. Read files on-demand, use Claude's 200K context.

### Expected Features

**Must have (table stakes):**
- Download file from URL with path validation, size limits, and type restrictions
- List/read/search files on any cluster node via SSH
- Browse projects from existing registry (24 projects indexed)
- Code explanation via Claude analysis (read-only)
- Extract audio from video for voice training
- Transcribe audio clips for training metadata

**Should have (competitive differentiators):**
- Cross-node file operations (Home to pve, agent1 to Home) — unique to multi-node homelab
- Project health analysis (outdated deps, Docker status, git uncommitted changes) — cluster-wide context
- Security audit for projects (hardcoded secrets, injection vulnerabilities) — homelab-specific security posture
- End-to-end voice retraining pipeline (download video → extract audio → segment → transcribe → train → deploy) — full automation
- A/B voice comparison before deploying new model
- Progress reporting for long-running operations (downloads, training)

**Defer (v2+):**
- File editing/writing — too risky without explicit user approval flow. Read-only first.
- Automated code fixes based on analysis — LLM code generation has 75% higher error rate. Advisory only.
- Multi-voice training — perfect one voice first.
- Full codebase indexing with embeddings — 24 projects don't warrant vector DB infrastructure.
- Real-time file watching — on-demand reads suffice. Registry already scans every 6 hours.

### Architecture Approach

The architecture extends the existing MCP tool pattern without introducing new service layers. File operations use SSH to remote nodes (not file agents on each node), project intelligence queries the existing registry on agent1 (not a new index), code analysis uses Claude via the existing agentic loop (not a separate analysis service), and voice training orchestrates existing TTS container scripts via docker exec (not a new training service).

**Major components:**
1. **File Tools (`src/mcp/tools/files.ts`)** — 6 MCP tools (list, read, search, info, download, write). Tier: GREEN for reads, YELLOW for downloads, RED for writes. Depends on: path sanitization, SSH extensions.
2. **Project Tools (`src/mcp/tools/projects.ts`)** — 6 MCP tools (list, details, structure, read, analyze, search). All GREEN tier (read-only). Depends on: registry client, file tools.
3. **Registry Client (`src/clients/registry.ts`)** — Fetch project registry from agent1 via SSH, cache with 5-minute TTL. Provides typed access to 24 indexed projects.
4. **Voice Tools (`src/mcp/tools/voice.ts`)** — 7 MCP tools (status, list, extract, prepare, retrain embedding, retrain model, get log). Tier: GREEN for reads, YELLOW for extraction, RED for full training. Depends on: docker exec orchestration.
5. **Safety Extensions (`src/safety/sanitize.ts`, `protected.ts`)** — New `sanitizePath()` function, `PROTECTED_PATHS` list, URL validation. Extends existing 4-tier framework.

**Integration pattern:**
File operations → Project browsing (depends on file read) → Code analysis (depends on project browsing) → Voice retraining (depends on file download). Each layer builds on the previous.

### Critical Pitfalls

1. **Path Traversal in File Tools** — User input like `../../etc/cron.d/backdoor` bypasses intended base directories. System runs as root on all nodes, so no permission boundary. Prevention: canonicalize with `fs.realpathSync()`, verify resolved path starts with allowed base, blocklist `/etc/`, `/root/.ssh/`, `/etc/pve/`. Must be solved in Phase 1 before ANY file tool ships.

2. **SSRF via File Download** — Download tool accepts URLs. Without validation, LLM can request internal services: `http://192.168.1.50:8006/api2/json/access/users` (Proxmox API tokens), `http://192.168.1.65:3005/status` (WOL API), `file:///etc/shadow`. Prevention: resolve DNS first, blocklist RFC 1918 addresses, disable redirects or same-domain only, allow only `https://` scheme.

3. **Secret Exposure via Project Browsing** — Read file tool accesses `.env` files with API keys, SSH private keys at `/root/.ssh/id_ed25519`, `/opt/agent/.env` with Gmail creds. LLM returns contents to chat, persisted in SQLite conversation history. Prevention: blocklist file patterns (`.env*`, `*.key`, `id_rsa`, `id_ed25519`), blocklist paths (`/etc/pve/priv/`, `.ssh/`, `.gnupg/`), scan for patterns (`API_KEY=`, `PRIVATE KEY`) and block reads.

4. **Disk Exhaustion** — Home node root at 52% (58 GB free of 112 GB). Single large download (60 GB video) fills root, Proxmox crashes. Prevention: per-file limit (100 MB default, max 1 GB), total quota for `/tmp/jarvis-downloads/` (2 GB), check free space before download (require 5 GB free), route large files to 4.5 TB external drive.

5. **ffmpeg RCE via Malicious Video** — Voice training processes untrusted video files with ffmpeg. Critical CVEs in 2025-2026 (CVE-2025-1594, CVE-2025-25469) enable code execution as root. Prevention: keep ffmpeg updated, run with `timeout` and `ulimit` resource caps, validate file magic bytes, consider Docker sandboxing with restricted mounts.

## Implications for Roadmap

Based on research, suggested phase structure with clear dependencies:

### Phase 1: File Operations Foundation (4-5 tools, ~3 days)
**Rationale:** Path sanitization and SSH file transfer are foundational infrastructure. All subsequent features (project browsing, code analysis, voice training) depend on safe file access. Building this layer first establishes the security model for everything above it.

**Delivers:**
- `list_directory` (GREEN) — SSH-based directory listing
- `read_file` (GREEN) — Read file contents with size limits
- `search_files` (GREEN) — Pattern-based file search via grep/find
- `file_info` (GREEN) — Metadata via stat
- `download_file` (YELLOW) — HTTP/HTTPS download with SSRF protection

**Safety infrastructure:**
- `sanitizePath()` function with base directory validation
- `PROTECTED_PATHS` list blocking `/etc/`, `/root/.ssh/`, `/etc/pve/`
- URL validation with RFC 1918 blocklist
- Disk space checks and size limits
- SSH client extensions: `getFileFromNode()`, `putFileToNode()`

**Addresses pitfalls:** 1 (path traversal), 2 (SSRF), 4 (disk exhaustion), 6 (safety bypass), 15 (override race)

**Research flag:** NO additional research needed. Path sanitization is standard practice, well-documented.

### Phase 2: Project Intelligence (6 tools + registry client, ~4 days)
**Rationale:** Project browsing depends on safe file reading from Phase 1. The registry provides fast project discovery, SSH provides detailed inspection. This phase delivers the highest user value (code browsing, project health) while maintaining read-only safety.

**Delivers:**
- `list_projects` (GREEN) — Query registry with filters
- `get_project_details` (GREEN) — Read package.json, Dockerfile, git status
- `get_project_structure` (GREEN) — Directory tree within project
- `read_project_file` (GREEN) — Read file with project path containment
- `analyze_project` (GREEN) — Health check (outdated deps, Docker status)
- `search_project_code` (GREEN) — Grep within project scope
- Registry client with 5-minute cache

**Safety infrastructure:**
- Secret patterns blocklist (`.env*`, `*.key`, `id_rsa`, `authorized_keys`)
- Sensitive paths blocklist (`/etc/pve/priv/`, `.ssh/`, `.gnupg/`)
- Content scanning for `API_KEY=`, `PASSWORD=`, `TOKEN=` patterns
- Project path containment validation

**Addresses pitfalls:** 3 (secret exposure), 8 (cross-node timing), 11 (file type detection), 12 (context cost)

**Research flag:** NO additional research needed. Registry structure is known, SSH patterns established.

### Phase 3: Code Analysis (3 analysis modes, ~3 days)
**Rationale:** Builds on project browsing from Phase 2. Analysis is prompt engineering, not AST parsing. Uses existing Claude API via agentic loop. Must implement prompt injection defense before processing external file contents.

**Delivers:**
- Code explanation via Claude
- Bug/security issue identification
- Architecture overview generation
- Read-only analysis with no auto-apply

**Safety infrastructure:**
- File content delimiters in prompts (mark as DATA not INSTRUCTIONS)
- Tool restriction during analysis (GREEN tier only while processing file contents)
- Output monitoring (flag if tool args match file content patterns)
- Separate analysis system prompt warning about embedded instructions

**Addresses pitfalls:** 7 (wrong suggestions), 10 (prompt injection), 12 (context cost)

**Research flag:** MEDIUM — Prompt injection defense patterns need validation during implementation. Test with malicious file contents.

### Phase 4: Voice Retraining Pipeline (7 tools, ~4 days)
**Rationale:** Most complex (Docker orchestration, long-running processes, resource management) and most self-contained (no other features depend on it). Can ship last without blocking other value delivery. Requires TTS container enhancements (pydub, faster-whisper).

**Delivers:**
- `voice_status` (GREEN) — TTS health check
- `list_voice_clips` (GREEN) — Show training data
- `extract_voice_clip` (YELLOW) — ffmpeg audio extraction
- `prepare_audio_clip` (YELLOW) — Convert to XTTS format
- `retrain_voice_embedding` (YELLOW) — Recompute speaker latents
- `retrain_voice_model` (RED) — Full GPT fine-tuning (30-90 min)
- `get_training_log` (GREEN) — Monitor training progress

**Safety infrastructure:**
- ffmpeg resource limits (`timeout`, `ulimit`, `nice`)
- Background training with progress monitoring (not blocking tool call)
- Data quality validation (duration, silence detection, format check)
- Model versioning and rollback capability

**Addresses pitfalls:** 5 (ffmpeg RCE), 9 (data quality), 14 (CPU contention)

**Research flag:** MEDIUM — ffmpeg sandboxing and background process management need testing. Validate faster-whisper in TTS container.

### Phase Ordering Rationale

- **File operations first** because path sanitization is foundational safety infrastructure reused by all subsequent file access. Without safe file tools, project browsing is unsafe.
- **Project intelligence second** because it introduces the registry client pattern and delivers immediate user value (code browsing works end-to-end). Depends on Phase 1 file reading.
- **Code analysis third** because it's prompt engineering on top of project browsing. Requires prompt injection defense. Highest risk for LLM misuse.
- **Voice retraining last** because it's the most complex (long-running processes, resource management, Docker orchestration) and most self-contained (no downstream dependencies). If it ships late, nothing else is blocked.

**Dependency chain:**
```
Phase 1: sanitizePath() + SSH file transfer
    ↓
Phase 2: project browsing (uses Phase 1 file read)
    ↓
Phase 3: code analysis (uses Phase 2 project read)

Phase 4: voice training (uses Phase 1 file download, independent of 2+3)
```

### Research Flags

**Phases needing validation during implementation:**
- **Phase 3 (Code Analysis):** Prompt injection defense patterns. Test with malicious file contents containing embedded instructions. Validate that file content delimiters prevent LLM hijacking.
- **Phase 4 (Voice Retraining):** Background training process management. Validate docker exec -d behavior with long-running Python scripts. Test ffmpeg resource limits prevent DoS.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (File Operations):** Path sanitization, SSRF protection, disk quotas are well-documented standard practices. No novel patterns.
- **Phase 2 (Project Intelligence):** SSH command execution, JSON parsing, file reading are established patterns. Registry structure is known.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified on host system or via npm registry. Zero new dependencies validated. fluent-ffmpeg archived status confirmed. Node 22 built-in features checked against release notes. |
| Features | HIGH | MCP filesystem server reference implementation examined. Project registry structure verified by reading live registry.json. Voice training pipeline verified by reading existing scripts. |
| Architecture | HIGH | Every source file in jarvis-backend/src/ read and analyzed. Current tool registration pattern, safety pipeline, SSH client, and agentic loop understood precisely. Integration points verified against codebase. |
| Pitfalls | HIGH | Path traversal, SSRF, and secret exposure are well-documented attack vectors with known mitigations. ffmpeg CVEs verified against official advisories. MCP security research from multiple vendors corroborates findings. |

**Overall confidence:** HIGH

### Gaps to Address

- **Prompt injection defense effectiveness:** While the mitigation strategy (file content delimiters, tool restrictions, output monitoring) is based on OWASP LLM01:2025 guidance, empirical testing with adversarial file contents is needed. Phase 3 should include red-team testing.

- **Background training reliability:** docker exec -d with 30-90 minute Python scripts is untested. Need to validate that stdout/stderr streams correctly, process monitoring works, and container restart after training completes cleanly. Phase 4 should include long-running process tests.

- **faster-whisper performance on CPU:** Documentation indicates 4x faster than original Whisper on CPU, but actual performance on the Home node's i5-13500HX is unknown. May need to benchmark transcription speed and adjust batch sizes. Phase 4 should include benchmarking.

- **Override context race condition:** The existing `context.ts` global mutable state is already a latent race condition (2 concurrent WebSocket clients). Phase 1 file operations (first long-running tools) make this exploitable. Should be fixed by capturing `overrideActive` at tool start rather than re-querying. Phase 1 must address this.

- **Triple-registration validation:** New tools require changes in 3 files (handler, tier, Claude description). No automated check prevents mismatches. Phase 1 should add startup validation that compares the three registries and logs warnings for divergence.

## Sources

### Primary (HIGH confidence)
- Jarvis codebase analysis — Read every TypeScript file in `/root/jarvis-backend/src/` (ai/, mcp/, safety/, clients/, db/, api/, monitor/, realtime/, auth/)
- TTS pipeline analysis — Read `/opt/jarvis-tts/app/server.py`, training scripts (finetune_xtts.py, compute_speaker_embedding.py, extract_gpt_weights.py), shell helpers (extract-voice.sh, prepare-audio.sh)
- Host system verification — `node --version` (22.22.0), `ffmpeg -version` (7.1.3), `yt-dlp --version` (2025.12.08), Docker container inspection
- Registry structure — Read live `/opt/cluster-agents/file-organizer/data/registry.json` from agent1
- Node.js documentation — fs.glob() stable since 22.17.0, fetch() native, child_process API
- FFmpeg security advisories — CVE-2025-1594, CVE-2025-25469, CVE-2025-10256, CVE-2025-63757 verified
- OWASP LLM Top 10 2025 — LLM01 Prompt Injection attack vectors and mitigations

### Secondary (MEDIUM confidence)
- MCP filesystem server — Anthropic's reference implementation for file operations via MCP
- Endor Labs: MCP AppSec — 82% of MCP implementations have path traversal issues (survey of 50+ implementations)
- Red Hat: MCP Security Risks and Controls — SSRF, path traversal, secret exposure guidance
- Elastic Security Labs: MCP Attack Defense Recommendations — Mitigation strategies for MCP tool security
- Palo Alto Unit42: MCP Attack Vectors — Prompt injection through tool parameters
- StackHawk: Node.js Path Traversal Guide — Prevention patterns with fs.realpathSync()
- Hoop.dev: FFmpeg Security Review — Vulnerability history and mitigation strategies

### Tertiary (LOW confidence, needs validation)
- Voice training improvement magnitude — Current 10-sample dataset with transcription errors is a weak baseline. Research indicates more samples improve quality, but XTTS v2 fine-tuning with <100 samples has limited documented results.
- Claude tool selection quality at 37 tools — From 18 tools to 37 tools may degrade selection accuracy. Empirical testing needed.

---
*Research completed: 2026-01-26*
*Ready for roadmap: yes*

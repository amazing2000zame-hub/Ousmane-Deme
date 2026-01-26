# Feature Landscape: Milestone 3 -- File Operations, Project Intelligence, Voice Retraining

**Domain:** AI-powered infrastructure management + developer assistant (Proxmox homelab)
**Project:** Jarvis 3.1 -- Subsequent Milestone (File & Project Intelligence)
**Researched:** 2026-01-26
**Focus:** File import/download, project browsing/analysis, code review, voice retraining pipeline

---

## Existing Foundation (Already Built)

These features are live and inform what the new features build upon:

| Component | Status | Relevant to New Features |
|-----------|--------|--------------------------|
| 18 MCP tools (9 cluster, 6 lifecycle, 3 system) | Working | New file/project tools follow same MCP pattern |
| 4-tier safety framework (GREEN/YELLOW/RED/BLACK) | Working | File operations need tier classification |
| Command sanitization (allowlist/blocklist) | Working | File path validation extends this pattern |
| SSH execution to all 4 cluster nodes | Working | Project browsing uses cross-node SSH |
| Project registry (24 projects indexed) | Working | Registry is the foundation for project browsing |
| File Organizer Agent (agent1) | Working | Provides project discovery, can be queried |
| XTTS v2 TTS server (FastAPI) | Working | Voice retraining feeds into this |
| TTS training pipeline (finetune_xtts.py) | Working | Dataset expansion improves voice quality |
| Training dataset (10 WAV samples, LJ Speech format) | Working | Current dataset is minimal, needs expansion |
| Claude agentic loop with streaming | Working | File/project tools plug into existing loop |
| Local LLM (Qwen 2.5 7B) | Working | Can handle project analysis tasks locally |

### Key Architectural Constraints

1. **MCP tool pattern**: All new capabilities must be registered as MCP tools through the existing `McpServer` instance, following the `registerXxxTools(server)` pattern.
2. **Safety tiers**: Every new tool needs a tier classification. File reads are GREEN, file writes are YELLOW, file downloads from URLs are RED.
3. **Cross-node SSH**: Projects live on different nodes. The existing `execOnNodeByName()` function handles SSH execution. File operations on remote nodes go through SSH.
4. **Command allowlist**: The current allowlist includes `ls`, `head`, `tail`, `cat /sys`, `cat /proc/*`, `stat`, `du`, `wc`. Expanding file operations requires extending the allowlist or creating dedicated tools that bypass the generic SSH tool.
5. **Token budget**: Qwen has 4096 token context. Project analysis with code snippets can easily exceed this. Claude with 200K context is needed for meaningful code analysis.

---

## Feature Domain 1: File Import/Download

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Download file from URL to local path | "Download this tarball to /opt/downloads/" -- basic wget/curl equivalent. Every assistant with file access needs this. | Low | New MCP tool `download_file`, path validation, size limits |
| Progress reporting for large downloads | Files over 10MB should report progress. Without it, user thinks JARVIS froze. Streaming progress via Socket.IO events. | Medium | Download tool with chunked transfer, progress callback to Socket.IO |
| File type validation | Block downloads of executable binaries (.exe, .sh with execute bit), disk images, or obviously dangerous content. Prevent JARVIS from becoming a malware dropper. | Low | Extension allowlist, MIME type checking via `file` command |
| Download destination restrictions | Only allow downloads to designated directories (e.g., `/opt/downloads/`, `/tmp/jarvis/`, shared storage paths). Never to `/etc/`, `/usr/`, system directories. | Low | Path allowlist, symlink resolution check |
| Size limits | Cap downloads at a configurable maximum (default 500MB). Prevent filling up disk with a single operation. | Low | HEAD request for Content-Length check before download, streaming size counter |
| Download status/history | "What did you download recently?" -- log all downloads with URL, destination, size, timestamp. | Low | New `downloads` table in SQLite or extend `events` table |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Smart archive extraction | After downloading a .tar.gz, .zip, or .deb, automatically offer to extract it. "I've downloaded the file. Would you like me to extract it?" Context-aware follow-up. | Medium | Archive detection, extraction commands (tar, unzip, dpkg), confirmation flow |
| Cross-node file transfer | "Move this backup from Home to pve" -- SCP/rsync between cluster nodes. Leverages existing SSH infrastructure. Unique to a multi-node homelab assistant. | Medium | SCP via SSH, source/destination node validation, progress reporting |
| Git clone integration | "Clone this repo to /opt/projects/" -- git clone as a first-class operation, not just a generic download. Sets up the project for immediate browsing/analysis. | Low | `git clone` via SSH execution, clone status reporting |
| URL content preview | Before downloading, fetch headers and show: file name, size, type. "This is a 45MB gzipped tarball. Download to /opt/downloads/?" Informed consent. | Low | HTTP HEAD request, content-type parsing |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Arbitrary code execution from downloads | Downloading a script and immediately executing it (`curl | bash` pattern) is explicitly blocked in the command blocklist. Must remain blocked even for JARVIS. | Download the file. Let the operator inspect it. Offer to make it executable as a separate RED-tier action if requested. |
| Browser/web scraping | Building a web scraper or headless browser into JARVIS adds enormous complexity. JARVIS is not a web browsing agent. | Use `wget`/`curl` for direct file URLs. For web content, the operator can provide the direct link. |
| Torrent/P2P downloads | BitTorrent support adds protocol complexity and potential legal concerns. Out of scope for a homelab assistant. | Direct HTTP/HTTPS downloads only. The operator can use separate torrent clients. |
| Automatic virus scanning | Running ClamAV or similar on every download is infrastructure overhead for a private homelab. | Block known-dangerous file types. Log all downloads for audit. Trust the operator's judgment for content safety. |

---

## Feature Domain 2: Project Read/Browse

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| List projects from registry | "What projects are on the cluster?" -- query the existing project registry (24 indexed projects across 4 nodes). This data already exists. | Low | SSH to agent1 to read `/opt/cluster-agents/file-organizer/data/registry.json`, or cache locally |
| Browse directory structure | "Show me the structure of jarvis-backend/" -- tree-like directory listing with depth control. Equivalent to `tree -L 2`. | Low | New MCP tool `list_directory` or `browse_project`, recursive listing via SSH |
| Read file contents | "Show me the contents of server.ts" -- read a specific file and return contents. The most fundamental file operation. | Low | New MCP tool `read_file`, path validation, size limits (cap at ~50KB to avoid overwhelming context) |
| Search within project files | "Find all files that import 'express'" -- grep/ripgrep equivalent across a project directory. Essential for code understanding. | Medium | New MCP tool `search_files`, regex support, result pagination |
| File metadata | "How big is this file? When was it last modified?" -- stat information for files. | Low | `stat` command via SSH (already in allowlist) |
| Multi-file read | "Show me server.ts, config.ts, and routes.ts" -- read multiple files in one request. Reduces round-trips for code review workflows. | Low | Batch variant of `read_file`, combined output with file separators |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Cross-node project browsing | "Show me the projects on pve node" -- browse any project on any cluster node seamlessly. The registry knows which node each project lives on. This is unique to a multi-node homelab. | Medium | Node-aware routing, SSH to correct node based on registry lookup |
| Project summary generation | "Summarize the jarvis-backend project" -- read package.json, README, key source files and generate an architectural overview. Goes beyond file listing to understanding. | High | LLM analysis (Claude for quality), selective file reading, token budget management |
| Code search with context | Search results include surrounding lines (like `grep -C 3`), file path, and line numbers. Not just matching lines but enough context to understand the match. | Low | Enhanced grep output parsing, context line parameter |
| Syntax-aware file reading | When reading code files, identify the language and provide syntax-highlighted output (or at minimum, language annotation for the frontend to render). | Low | File extension to language mapping, markdown code fences with language tags |
| Project dependency graph | "What does jarvis-backend depend on?" -- parse package.json/requirements.txt/pyproject.toml and show dependency tree. | Medium | Package manifest parsing, optional `npm ls` or `pip list` execution |
| Recent changes view | "What changed recently in this project?" -- `git log --oneline -10` and `git diff --stat` for the project. Quick overview of recent work. | Low | Git commands via SSH, project path from registry |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full codebase indexing / embedding | Building a vector index of all 24 projects' source code is expensive, requires a vector DB, and would need constant re-indexing. Overkill for an assistant that handles ~50 queries/day. | Read files on-demand. Use grep for search. Claude's 200K context can hold significant portions of a project when needed for analysis. |
| Live file watching / hot reload | Monitoring file changes in real-time across 4 nodes would require inotify watchers via persistent SSH connections. Complex, fragile, unnecessary. | The project registry already scans every 6 hours. For immediate info, read the file when asked. |
| File editing / writing | JARVIS should NOT write to project files autonomously. The risk of corrupting a working project is too high. A homelab assistant should inform, not modify. | Present suggestions as text. Let the operator apply changes manually or use their IDE. If file writing is ever added, it must be RED-tier with explicit confirmation and backup. |
| IDE integration (LSP) | Running Language Server Protocol servers for TypeScript, Python, etc. on the cluster is heavy infrastructure for occasional code questions. | Use LLM analysis instead of static analysis. Claude understands code structure without needing an LSP server. |
| Git operations (commit, push, merge) | Allowing JARVIS to make commits or push code introduces version control risks. A typo in the commit message or wrong branch could cause problems. | Read-only git operations (log, diff, status, blame) are fine as GREEN tier. Write operations (commit, push) should remain manual. |

---

## Feature Domain 3: Project Analysis & Discussion

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Code explanation | "Explain what this function does" -- given a file and function name (or line range), explain the code in plain language. The most basic code analysis feature. | Medium | File reading + LLM analysis. Must use Claude (not Qwen) for quality code understanding. |
| Bug/issue identification | "Are there any issues in this file?" -- scan for common problems: unhandled errors, security issues, type mismatches, logic errors. | Medium | File reading + Claude analysis with structured prompt. Return categorized findings (bug, security, style, performance). |
| Architecture overview | "How is the jarvis-backend structured?" -- read key files and explain the overall architecture, component relationships, and data flow. | High | Multi-file reading, registry data, LLM synthesis. Token-expensive for Claude but high-value output. |
| Code question answering | "Why does the safety tier use a blocklist AND an allowlist?" -- conversational Q&A about code with file references. Like having a senior developer explain the codebase. | Medium | Context-aware: read relevant files, inject into conversation, let Claude answer. |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Security audit | "Check this project for security issues" -- targeted security review: hardcoded secrets, injection vulnerabilities, missing input validation, insecure defaults. Particularly valuable for a homelab with SSH keys and API tokens. | High | Multi-file reading, security-focused analysis prompt, categorized output (critical/high/medium/low) |
| Improvement suggestions | "How can I improve this code?" -- actionable suggestions with specific file/line references. Not just "use better variable names" but "extract this 50-line function into two smaller functions because X." | Medium | File reading + Claude analysis with improvement-focused prompt |
| Cross-project consistency check | "Are all projects using the same Node.js version?" or "Which projects have outdated dependencies?" -- cluster-wide analysis leveraging the project registry. | High | Registry query + multi-node file reading + comparison logic |
| Diff analysis | "Explain what changed in the last commit" -- `git diff` + LLM explanation. Useful when the operator returns to a project after time away. | Medium | Git diff via SSH + Claude analysis |
| Technical debt assessment | "What's the technical debt in jarvis-backend?" -- assess code quality holistically: test coverage, error handling patterns, dependency freshness, code duplication indicators. | High | Multi-file analysis, metrics collection, LLM synthesis |
| Documentation generation | "Generate API docs for the MCP tools" -- read source code and produce structured documentation. Saves significant manual documentation effort. | Medium | Source code reading + structured output prompt. Output as markdown. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Automated code fixing | JARVIS should not automatically modify code based on its analysis. LLM code generation has a 75% higher rate of logic errors (2025 data). Auto-fixing compounds risk. | Present findings and suggestions as text. Let the operator decide and implement changes. |
| PR/commit review bot | Running as a CI/CD review bot requires webhook infrastructure, Git integration, and continuous operation. This is a conversational assistant, not a CI pipeline. | Analyze code on-demand when the operator asks. "Review the last 3 commits" works conversationally. |
| Performance profiling | Runtime performance analysis requires instrumentation, profiling tools, and running the code. Static analysis of performance is unreliable. | Identify obvious performance anti-patterns in static analysis (N+1 queries, synchronous I/O in async code). For real profiling, recommend appropriate tools. |
| Multi-language deep analysis | Supporting deep semantic analysis for TypeScript, Python, Go, Rust, etc. each requires language-specific knowledge. Spread thin = shallow everywhere. | Focus on TypeScript and Python (the two languages used in this cluster). Accept that analysis of other languages will be shallower. |
| Autonomous refactoring plans | Generating multi-step refactoring plans that JARVIS could "execute" is scope creep toward an IDE. | Provide analysis and suggestions. The operator drives refactoring in their own IDE with JARVIS as a consultant. |

---

## Feature Domain 4: Voice Retraining from Video Sources

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Download audio/video from URL | "Download the JARVIS compilation from YouTube" -- extract audio from video URLs. Foundation for the entire voice retraining pipeline. | Medium | yt-dlp or similar tool for video download, FFmpeg for audio extraction |
| Audio extraction from video | Convert downloaded video to WAV audio at the correct sample rate (22050Hz for XTTS v2). Strip video track entirely. | Low | FFmpeg: `ffmpeg -i input.mp4 -ar 22050 -ac 1 -f wav output.wav` |
| Vocal isolation | Separate speech from background music/sound effects. JARVIS clips from Iron Man films have significant background audio (explosions, music, ambient noise). | High | Demucs or similar source separation model. GPU recommended but CPU possible. |
| Audio segmentation | Split long audio into individual clips (6-30 seconds each). XTTS v2 training expects individual utterances, not hour-long files. | Medium | Voice Activity Detection (VAD) or silence-based splitting. WebRTC VAD or Silero VAD. |
| Transcription | Generate text transcripts for each audio segment. The existing dataset has transcription errors ("Mr. Stalin" instead of "Mr. Stark"). Whisper provides much better accuracy. | Medium | OpenAI Whisper (can run locally on CPU). Output paired with audio segments. |
| LJ Speech format output | Output dataset in the format the existing training pipeline expects: `metadata.csv` with pipe-delimited fields, `wavs/` directory with numbered WAV files. | Low | Script to format output matching existing `/training/dataset/` structure |
| Merge with existing dataset | New samples should be added to the existing 10-sample dataset, not replace it. Cumulative improvement. | Low | Append to metadata.csv, add WAVs to wavs/ directory |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| End-to-end pipeline automation | "Retrain my voice from this video" -- single command that downloads, extracts, isolates, segments, transcribes, formats, and triggers retraining. The full pipeline, not manual steps. | High | All table stakes features chained together, pipeline orchestration |
| Audio quality scoring | Automatically score each extracted clip for quality (noise level, clarity, speech-to-noise ratio). Reject low-quality clips before they enter the training set. | Medium | Signal-to-noise ratio analysis, spectral analysis for noise detection |
| Speaker diarization | When a video has multiple speakers (Tony Stark + JARVIS dialogue), identify and extract only JARVIS's lines. Critical for Iron Man compilation videos. | High | Speaker diarization model (pyannote-audio), speaker clustering |
| Transcript correction UI | Show extracted transcripts and let operator correct errors before they enter the training set. Poor transcriptions degrade voice quality. | Medium | REST API for transcript review/edit, simple web form or chat-based correction |
| Training monitoring | Show training progress: epoch, loss, samples processed. "Training is 60% complete, loss has decreased from 0.85 to 0.32." | Medium | Parse trainer output, expose via Socket.IO events |
| A/B voice comparison | After retraining, synthesize the same text with old and new voice model. Let operator compare and choose which to deploy. | Medium | Dual synthesis, audio playback in UI or via TTS endpoint |
| Incremental fine-tuning | Add new samples and fine-tune from the last checkpoint rather than from scratch. Saves significant training time (hours to minutes). | Medium | Checkpoint management, resume-from-checkpoint in training script |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time voice cloning from live audio | Cloning a voice from a live microphone stream adds latency, requires continuous processing, and has privacy implications. | Use pre-recorded audio files or video downloads. Process offline, deploy when ready. |
| Multi-voice training | Training multiple voice profiles (JARVIS, FRIDAY, etc.) multiplies training time and storage. One voice is the core feature. | Perfect one voice first. The architecture supports multiple voices (the TTS server already has a `voice` parameter), but training each one is a separate manual decision. |
| Automatic voice deployment | Automatically swapping the production voice after training without operator review could result in a degraded voice being deployed. | Train, compare, and let the operator explicitly deploy the new voice. A/B comparison before deployment. |
| Copyright-aware source filtering | Building a system to determine whether audio sources are legally usable for voice training is a legal question, not a technical one. | Log all source URLs for the operator's records. The operator is responsible for ensuring they have appropriate rights to use the source material. |
| Emotion/style transfer | Training the voice model to express different emotions (happy JARVIS, concerned JARVIS) requires labeled emotion datasets and specialized training. | Focus on a consistent, high-quality neutral voice. Emotion comes through word choice in the text, not vocal variation. |

---

## Feature Dependencies (Cross-Domain)

```
Existing Foundation:
  MCP tools + Safety framework + SSH + Project Registry + TTS Pipeline
    |
    v
Domain 1: File Operations (foundation for everything else)
  download_file tool (RED tier -- downloads from internet)
  Path validation + size limits + type restrictions
  Download history logging
    |
    +---> Domain 2: Project Browsing (requires file reading)
    |       list_projects tool (GREEN tier -- reads registry)
    |       browse_directory tool (GREEN tier -- reads filesystem)
    |       read_file tool (GREEN tier -- reads file contents)
    |       search_files tool (GREEN tier -- searches content)
    |       |
    |       +---> Domain 3: Project Analysis (requires browsing)
    |               analyze_code tool (GREEN tier -- LLM analysis)
    |               security_audit tool (GREEN tier -- LLM analysis)
    |               explain_code tool (GREEN tier -- LLM analysis)
    |
    +---> Domain 4: Voice Retraining (requires file download)
            Audio extraction (FFmpeg)
            Vocal isolation (Demucs)
            Segmentation + Transcription (Whisper)
            Dataset formatting (LJ Speech)
            Training trigger (existing pipeline)
```

### Critical Path Dependencies

| New Feature | Hard Dependencies | Soft Dependencies |
|-------------|-------------------|-------------------|
| File download from URL | Path validation, size limits, safety tier | Download history table |
| Cross-node file transfer | SSH execution (exists), SCP command | Progress reporting |
| Project listing | Project registry access (exists on agent1) | Registry cache on Home node |
| Directory browsing | SSH execution (exists), path validation | Cross-node routing from registry |
| File reading | SSH execution (exists), path validation, size cap | Syntax detection |
| File search | SSH execution (exists), grep/rg on target node | Context lines, pagination |
| Code explanation | File reading, Claude API | None |
| Security audit | Multi-file reading, Claude API | Structured output format |
| Architecture overview | Multi-file reading, registry data, Claude API | None |
| Video download | yt-dlp installation, storage path | URL validation |
| Audio extraction | FFmpeg (likely already installed), video file | None |
| Vocal isolation | Demucs installation, GPU access (optional) | Quality scoring |
| Audio segmentation | VAD model, extracted audio | Speaker diarization |
| Transcription | Whisper installation, audio segments | Transcript correction UI |
| Dataset formatting | All audio pipeline steps, LJ Speech format | Merge with existing dataset |
| Training trigger | Formatted dataset, existing training pipeline | Training monitoring |

---

## Safety Tier Recommendations for New Tools

| Tool | Recommended Tier | Rationale |
|------|-----------------|-----------|
| `list_projects` | GREEN | Read-only, queries existing registry |
| `browse_directory` | GREEN | Read-only directory listing |
| `read_file` | GREEN | Read-only file access with size limits |
| `search_files` | GREEN | Read-only grep/search |
| `analyze_code` | GREEN | Read-only analysis (LLM interprets, no execution) |
| `explain_code` | GREEN | Read-only explanation |
| `download_file` | RED | Downloads from internet -- requires confirmation. Source URLs could be malicious, files could fill disk. |
| `transfer_file` | YELLOW | Moves files between known cluster nodes. Controlled environment, but has write side effects. |
| `trigger_voice_training` | RED | Starts GPU-intensive training process that affects system resources. Requires confirmation. |
| `extract_audio` | YELLOW | Processes files locally, writes output to designated directory. Side effects but controlled. |

---

## MVP Recommendation

For the first iteration of this milestone, prioritize in this order:

### Must Have (Phase 1: File & Project Browsing)
1. `list_projects` -- Query registry, return project list (GREEN)
2. `browse_directory` -- List directory contents with depth control (GREEN)
3. `read_file` -- Read file contents with size limits (GREEN)
4. `search_files` -- Search file contents in a project (GREEN)
5. `download_file` -- Download from URL with restrictions (RED)

**Rationale:** These 5 tools enable the entire "JARVIS can see and understand your code" experience. They are low-complexity, follow existing MCP patterns, and have clear safety boundaries.

### Should Have (Phase 2: Analysis & Intelligence)
6. Code explanation via Claude analysis
7. Bug/issue identification
8. Architecture overview generation
9. Cross-node project browsing (route to correct node from registry)
10. Git history integration (log, diff, blame)

**Rationale:** These build on Phase 1 tools and add the "intelligence" layer. They require Claude API (cost implications) but provide the most operator value.

### Nice to Have (Phase 3: Voice Retraining Pipeline)
11. Video/audio download pipeline (yt-dlp + FFmpeg)
12. Vocal isolation (Demucs)
13. Audio segmentation + transcription (Whisper)
14. Dataset formatting and merge
15. Training trigger and monitoring

**Rationale:** Voice retraining is self-contained and has the heaviest infrastructure requirements (yt-dlp, Demucs, Whisper installations). The existing 10-sample voice works. Improvement is desirable but not blocking.

### Defer (Post-Milestone)
- File editing/writing (too risky for now)
- Full codebase indexing/embeddings (overkill for scale)
- Automated refactoring (scope creep)
- Multi-voice training (perfect one voice first)
- Speaker diarization (nice to have, complex)

---

## Complexity Estimates

| Feature Group | Tool Count | Est. Implementation | Risk |
|---------------|-----------|-------------------|------|
| File operations (download, transfer) | 2 tools | 2-3 days | Low -- well-understood patterns |
| Project browsing (list, browse, read, search) | 4 tools | 2-3 days | Low -- extends existing SSH infrastructure |
| Code analysis (explain, audit, overview) | 3 tools (or LLM prompting layer) | 3-4 days | Medium -- quality depends on prompt engineering |
| Voice pipeline (download, extract, isolate, segment, transcribe, format) | 5-6 tools or 1 orchestrated pipeline | 5-7 days | High -- multiple tool installations, GPU considerations |
| Training integration (trigger, monitor, compare) | 2-3 tools | 2-3 days | Medium -- integrates with existing training code |

**Total estimated effort:** 14-20 days for full milestone.

---

## Sources

### File Operations & MCP Patterns
- [Filesystem MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) -- Anthropic's reference implementation for file operations via MCP (HIGH confidence)
- [MCP File System Server](https://github.com/MarcusJellinghaus/mcp_server_filesystem) -- Community implementation with path validation and security controls (MEDIUM confidence)
- [AI Agent Architecture Best Practices](https://techbytes.app/posts/ai-agent-architecture-mcp-sandboxing-skills/) -- Sandboxing and security for AI file operations (MEDIUM confidence)
- [OpenSSF Security Guide for AI Code Assistants](https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions) -- Security best practices for AI-generated file operations (HIGH confidence)

### Code Analysis & Review
- [Code Review in the Age of AI](https://addyo.substack.com/p/code-review-in-the-age-of-ai) -- Addy Osmani's survey of AI code review patterns (MEDIUM confidence)
- [AI Code Review Tools 2026](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/) -- Enterprise patterns for AI code review (MEDIUM confidence)
- [State of AI Code Quality 2025](https://www.qodo.ai/reports/state-of-ai-code-quality/) -- 41% of commits AI-assisted, 75% more logic errors (MEDIUM confidence)
- [Codebase Digest](https://github.com/kamilstanuch/codebase-digest) -- Tool for packing codebases for LLM analysis (MEDIUM confidence)
- [Repomix](https://repomix.com/) -- Codebase packing with token counting and security checks (MEDIUM confidence)

### Voice Retraining Pipeline
- [Building Voice Cloning Datasets](https://medium.com/@prakashshanbhag/building-high-quality-voice-cloning-datasets-for-ai-applications-1ef174c2b34e) -- End-to-end dataset building guide (MEDIUM confidence)
- [XTTS v2 on HuggingFace](https://huggingface.co/coqui/XTTS-v2) -- Model card with training data requirements (HIGH confidence)
- [Voice-Pro](https://github.com/abus-aikorea/voice-pro) -- Open-source pipeline: YouTube download + Demucs + Whisper + voice cloning (MEDIUM confidence)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) -- Feature-rich audio/video downloader (HIGH confidence)
- [VocalForge Dataset Toolkit](https://sep.com/blog/helpful-tools-to-make-your-first-voice-clone-dataset-easy-to-build/) -- Tools for voice dataset creation (LOW confidence)

### Project Browsing & Codebase Intelligence
- [AnythingLLM](https://anythingllm.com/) -- Self-hosted AI with document and codebase analysis (MEDIUM confidence)
- [Structuring Codebases for AI Tools](https://www.propelcode.ai/blog/structuring-codebases-for-ai-tools-2025-guide) -- Context engineering for AI code understanding (MEDIUM confidence)

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| File operation tools | HIGH | Well-established MCP patterns (Anthropic's own filesystem server). Existing SSH infrastructure handles cross-node execution. |
| Project browsing | HIGH | Direct extension of existing tools. Project registry already indexes everything. |
| Code analysis quality | MEDIUM | Depends heavily on Claude prompt engineering. No existing JARVIS-specific code analysis has been tested. Quality will need iteration. |
| Voice pipeline feasibility | MEDIUM | Individual tools (yt-dlp, FFmpeg, Demucs, Whisper) are all proven. Integration into a single automated pipeline on this specific hardware (CPU-only for most nodes) is untested. |
| Voice training improvement | LOW | Current 10-sample dataset with transcription errors is a weak baseline. Adding more samples should improve quality, but the magnitude of improvement is unpredictable. XTTS v2 fine-tuning with small datasets (<100 samples) is an area with limited documented results. |
| Safety tier assignments | HIGH | Follows established patterns from existing 18 tools. Read operations are GREEN, write operations are YELLOW/RED. |

---

*Feature landscape research (Milestone 3: File & Project Intelligence): 2026-01-26*

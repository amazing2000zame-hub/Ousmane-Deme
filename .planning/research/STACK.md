# Technology Stack -- v1.2 Milestone Additions

**Project:** Jarvis 3.1 v1.2 -- File Operations, Project Browsing/Analysis, Voice Retraining
**Researched:** 2026-01-26
**Overall Confidence:** HIGH (versions verified via npm registry and web search; system-installed tools verified on host)

**Scope:** This document covers ONLY the stack additions/changes for v1.2. The existing stack (Express 5, React 19, Vite 6, Socket.IO 4, Anthropic SDK, MCP SDK, better-sqlite3, Drizzle ORM, Zod 4, node-ssh, openai) is validated and unchanged. See the v1.1 STACK.md for those decisions.

---

## Critical Context: What Already Exists on the Host

Before recommending any new packages, here is what is already installed and available:

| Tool | Location | Version | Relevance |
|------|----------|---------|-----------|
| `ffmpeg` | `/usr/bin/ffmpeg` (host) | 7.1.3 | Audio extraction from video, format conversion, silence removal |
| `ffprobe` | `/usr/bin/ffprobe` (host) | 7.1.3 | Media file metadata/duration probing |
| `yt-dlp` | `/usr/local/bin/yt-dlp` (host) | 2025.12.08 | Download video/audio from URLs (YouTube, etc.) |
| `ffmpeg` | Docker container (`jarvis-tts`) | 5.1.8 | Available inside the TTS container for audio processing |
| `node-ssh` | `jarvis-backend` | 13.2.1 | SSH execution on cluster nodes -- reusable for remote file operations |
| `librosa` | TTS Docker container | 0.11.0 | Audio analysis (already installed) |
| `scipy` | TTS Docker container | 1.17.0 | Signal processing (already installed) |
| `torchaudio` | TTS Docker container | 2.2.2+cpu | Audio loading/transforms (already installed) |
| Node.js | Host | 22.22.0 | Built-in `fs.glob()` (stable), `fs.readdir({ recursive: true })`, `child_process` |

**Key insight:** Most of what we need is already on the system. The v1.2 stack additions are minimal -- primarily thin wrappers and one download helper.

---

## 1. File Import/Download

### Recommendation: Built-in `fetch()` + `child_process.execFile()` for yt-dlp

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Built-in `fetch()` | Node.js 22 native | Download files from HTTP/HTTPS URLs | Zero dependencies. Node 22's `fetch()` (powered by undici) is fully stable with streaming support via `Readable.fromWeb(response.body)`. Supports piping to `createWriteStream()` for large files. Handles redirects, headers, and status codes. No npm package needed. | HIGH |
| Built-in `child_process` | Node.js 22 native | Execute `yt-dlp` for video/audio downloads | `yt-dlp` (already installed at `/usr/local/bin/yt-dlp`) handles 1800+ sites including YouTube, Vimeo, Twitter, etc. Use `execFile('yt-dlp', [...args])` with `AbortController` for cancellation. No npm wrapper needed -- direct CLI invocation is more reliable and always up-to-date with the installed binary. | HIGH |
| Built-in `child_process` | Node.js 22 native | Execute `ffprobe` for file metadata | Get duration, codec, sample rate, dimensions from downloaded files. Use promisified `execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file])`. Already installed at `/usr/bin/ffprobe`. | HIGH |

### Download Strategy

**Direct HTTP files (PDFs, images, audio, archives):**
```typescript
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const response = await fetch(url);
const readable = Readable.fromWeb(response.body);
await pipeline(readable, createWriteStream(destPath));
```

**Video/audio from streaming sites (YouTube, etc.):**
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

await execFileAsync('yt-dlp', [
  '-x',                    // extract audio only
  '--audio-format', 'wav', // output WAV for training
  '--audio-quality', '0',  // best quality
  '-o', outputPath,
  url
], { timeout: 300_000 });  // 5 min timeout
```

### What NOT to Add

- **`ytdlp-nodejs` (npm wrapper):** The npm wrapper (v2.3.4 or v3.3.9) bundles its own yt-dlp binary and auto-updates it. This conflicts with our host-installed `yt-dlp` which is already at v2025.12.08 and managed by the system. Direct `execFile()` is simpler, has no version conflicts, and avoids a 30MB+ bundled binary. The wrapper adds complexity for zero benefit when the binary is already on `$PATH`.

- **`node-fetch` / `axios` / `got`:** Node.js 22's built-in `fetch()` is fully stable and performant (powered by undici). There is zero reason to add an HTTP client library in 2026.

- **`fluent-ffmpeg`:** Archived and deprecated as of May 2025. The repository is read-only and does not work properly with recent ffmpeg versions. Do NOT use it. Direct `child_process.execFile()` invocation of ffmpeg/ffprobe is the recommended approach (even the fluent-ffmpeg maintainer said "at its core, fluent-ffmpeg is just a fancy command-line generator for ffmpeg").

- **`ffmpeg-static`:** Provides a bundled ffmpeg binary (v6.1.1). We already have ffmpeg 7.1.3 installed on the host. The npm package is both older and unnecessary.

### Integration Points

```
NEW: src/mcp/tools/files.ts          File import/download MCP tools
NEW: src/services/download.ts        Download orchestrator (fetch vs yt-dlp routing)
NEW: src/services/media-probe.ts     ffprobe wrapper for file metadata
Reuse: src/safety/sanitize.ts        Path sanitization for download destinations
Reuse: src/safety/tiers.ts           Safety tier assignment for new tools
```

### Safety Classification

| Tool | Tier | Rationale |
|------|------|-----------|
| `probe_file` | GREEN | Read-only metadata extraction |
| `download_file` | RED | Writes to filesystem, needs confirmation |
| `download_media` | RED | Executes yt-dlp, writes to filesystem |

---

## 2. Project Read/Browse

### Recommendation: Built-in Node.js `fs` APIs Only

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Built-in `fs/promises` | Node.js 22 native | Read files, list directories | `fs.readFile()`, `fs.readdir({ recursive: true, withFileTypes: true })`, `fs.stat()` cover all needs. Zero dependencies. | HIGH |
| Built-in `fs.glob()` | Node.js 22 native (stable since 22.17.0) | Pattern-based file search | `fs.glob('**/*.ts', { cwd: projectRoot, exclude: ['node_modules/**'] })` provides native glob support. Stable since Node 22.17.0 (verified). Eliminates need for `glob`, `fast-glob`, or `globby` npm packages. | HIGH |
| Built-in `path` | Node.js 22 native | Path manipulation | `path.resolve()`, `path.relative()`, `path.extname()` for safe path operations. | HIGH |

### File Browsing Capabilities

These are pure MCP tools that use Node.js built-in APIs:

1. **`list_directory`** -- `fs.readdir(path, { withFileTypes: true })` returning name, type (file/dir), size
2. **`read_file`** -- `fs.readFile(path, 'utf-8')` with size limit (e.g., 1MB max)
3. **`search_files`** -- `fs.glob(pattern, { cwd: root })` for pattern matching
4. **`get_file_info`** -- `fs.stat(path)` for metadata (size, modified date, permissions)
5. **`read_file_lines`** -- Read specific line ranges from large files (stream-based)

### Path Safety

Critical: all file tools MUST enforce path containment to prevent directory traversal attacks.

```typescript
function safePath(basePath: string, requestedPath: string): string {
  const resolved = path.resolve(basePath, requestedPath);
  if (!resolved.startsWith(path.resolve(basePath))) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}
```

Allowed base directories should be configurable:
- `/root/jarvis-backend/` -- backend source
- `/root/jarvis-ui/` -- frontend source
- `/opt/jarvis-tts/` -- TTS service
- `/opt/jarvis/` -- Jarvis config
- Additional paths via config

### What NOT to Add

- **`glob` / `fast-glob` / `globby` (npm):** Node.js 22.17.0+ has stable `fs.glob()`. No third-party package needed for glob operations.

- **`chokidar` (file watcher):** We are building read/browse tools, not a live file watcher. Jarvis reads files on demand via MCP tool invocation. If real-time file watching is needed later (e.g., auto-detect project changes), chokidar v5.0.0 (ESM-only, Node 20+) would be the right choice -- but that is not in scope for v1.2.

- **`tree-kill` / directory tree libraries:** A recursive `fs.readdir` with `withFileTypes: true` and a simple depth limit produces directory tree output. No library needed.

- **AST parsing libraries (babel, acorn, typescript compiler API):** The project analysis feature uses LLM-based analysis, not AST parsing. We send source code to Claude/Qwen and get analysis back in natural language. AST parsing would be a different feature (automated refactoring, lint rules) that is not in scope.

### Safety Classification

| Tool | Tier | Rationale |
|------|------|-----------|
| `list_directory` | GREEN | Read-only directory listing |
| `read_file` | GREEN | Read-only file content |
| `search_files` | GREEN | Read-only glob search |
| `get_file_info` | GREEN | Read-only metadata |
| `read_file_lines` | GREEN | Read-only partial file read |

### Integration Points

```
NEW: src/mcp/tools/project.ts        Project browsing MCP tools
NEW: src/services/project-reader.ts   File reading with path safety enforcement
Reuse: src/safety/tiers.ts           All tools are GREEN tier
Reuse: src/safety/sanitize.ts        Path and input sanitization
```

---

## 3. Project Analysis

### Recommendation: Existing Claude API + System Prompt Engineering

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `@anthropic-ai/sdk` | ^0.71.2 (existing) | LLM-powered code analysis | **No new dependency.** Claude already handles tool execution via the agentic loop in `loop.ts`. Project analysis is a prompt engineering task: read files with GREEN-tier tools, then ask Claude to analyze them. Claude's 200K context window handles large codebases. | HIGH |
| `openai` | ^6.16.0 (existing) | Local LLM fallback for simpler analysis | **No new dependency.** Local Qwen 2.5 7B can handle simpler analysis tasks (file summaries, basic code review) within its 4K context window. Route to Claude for deep analysis, local for summaries. | HIGH |

### Analysis Capabilities (All Prompt-Driven)

These are composite MCP tools that combine file reading with LLM analysis:

1. **`analyze_project`** -- Read project structure + key files -> LLM summarizes architecture
2. **`review_code`** -- Read specific file(s) -> LLM identifies issues, suggests improvements
3. **`explain_code`** -- Read file -> LLM explains what the code does
4. **`suggest_improvements`** -- Read project -> LLM suggests architectural improvements

### Implementation Pattern

Analysis tools are NOT standalone MCP tools. They are **composite operations** that:
1. Use GREEN-tier file reading tools to gather source code
2. Build a structured prompt with the gathered code
3. Send to Claude (or local LLM for simple tasks) for analysis
4. Return the LLM's analysis as the tool result

This means analysis tools are really just **specialized system prompts** + **file reading orchestration**. No new libraries needed.

### What NOT to Add

- **`tree-sitter` / AST parsing:** LLM-based analysis does not need AST parsing. Claude understands code directly from source text. AST parsing would be needed for automated code modification (not in scope).

- **`eslint` / `prettier` (as libraries):** These are linting/formatting tools, not analysis tools. If the user wants lint results, they can run them via `execute_ssh`. We do not embed them in the backend.

- **Code embedding / vector DB (ChromaDB, Pinecone, etc.):** Semantic code search via embeddings is premature. For a 4-node homelab with ~24 projects, reading files directly and sending to the LLM is fast and simple. Vector search becomes relevant at 100K+ file scale.

- **LangChain:** Unnecessary abstraction for what amounts to "read files, build prompt, call Claude."

### Safety Classification

| Tool | Tier | Rationale |
|------|------|-----------|
| `analyze_project` | GREEN | Read-only analysis, no side effects |
| `review_code` | GREEN | Read-only analysis |
| `explain_code` | GREEN | Read-only analysis |
| `suggest_improvements` | GREEN | Read-only analysis |

### Integration Points

```
NEW: src/mcp/tools/analysis.ts       Analysis MCP tool definitions
NEW: src/services/code-analysis.ts   Prompt construction + LLM routing for analysis
Reuse: src/services/project-reader.ts  File reading (from section 2)
Reuse: src/ai/claude.ts              Claude API client
Reuse: src/ai/local-llm.ts           Local LLM for simpler analysis
Reuse: src/ai/loop.ts                Agentic loop handles tool chaining
```

---

## 4. Voice Retraining (Audio from Video)

### Recommendation: Node.js Orchestration + Python Processing in TTS Container

The voice retraining pipeline has two halves:
1. **Node.js backend (orchestration):** Download video, extract audio, manage files
2. **Python TTS container (processing):** Segment audio, prepare dataset, retrain model

| Technology | Version | Purpose | Where | Why | Confidence |
|------------|---------|---------|-------|-----|------------|
| Built-in `child_process` | Node.js 22 | Run `yt-dlp` and `ffmpeg` on host | Backend | Download video and extract audio. Same pattern as Section 1. | HIGH |
| Built-in `child_process` | Node.js 22 | Run `docker exec` commands | Backend | Trigger Python scripts inside the TTS container for dataset preparation and retraining. Uses `execFile('docker', ['exec', 'jarvis-tts', 'python3', '/training/prepare_dataset.py', ...])`. | HIGH |
| `pydub` | >=0.25.1 | Audio segmentation + silence detection | TTS container (Python) | Split extracted audio on silence boundaries to create clean training clips. `split_on_silence()` with configurable thresholds. Simple, well-established, works well for the clip sizes needed (3-15 seconds). Already has `ffmpeg` in the container as a backend. | HIGH |
| Existing `librosa` | 0.11.0 | Audio analysis (quality checks) | TTS container (Python) | Already installed. Use for sample rate verification, loudness analysis, clip duration validation before adding to training dataset. | HIGH |
| Existing `scipy` | 1.17.0 | Audio resampling | TTS container (Python) | Already installed and used in the TTS server for speed adjustment. Reuse for resampling extracted audio to 22050Hz (XTTS v2 input rate). | HIGH |
| Existing `torchaudio` | 2.2.2+cpu | Audio loading/transforms | TTS container (Python) | Already installed. Can load various audio formats and handle format conversion. | HIGH |

### New Python Script: `prepare_dataset.py`

A new Python script added to `/opt/jarvis-tts/training/` that:
1. Takes extracted audio files as input
2. Segments on silence using pydub
3. Filters clips by duration (3-15 seconds for XTTS v2)
4. Normalizes volume (pydub's `normalize()` or ffmpeg `loudnorm`)
5. Resamples to 22050Hz mono WAV
6. Generates `metadata.csv` in LJSpeech format (required by existing `finetune_xtts.py`)
7. Outputs cleaned clips to `/training/dataset/`

### New Python Script: `transcribe_clips.py` (Optional but Recommended)

For voice training, each audio clip needs a text transcription in `metadata.csv`. Options:

| Approach | Library | Where | Pros | Cons |
|----------|---------|-------|------|------|
| **Local whisper.cpp** | `nodejs-whisper` (npm) or direct binary | Host | Free, private, offline | Requires ~1GB model download, slow on CPU |
| **Local Whisper Python** | `faster-whisper` (pip) | TTS container | Faster than whisper.cpp, Python native | Adds ~1.5GB to container (model + CTranslate2) |
| **OpenAI Whisper API** | `openai` (existing npm) | Backend | Fast, accurate, simple | Costs money per minute of audio |
| **Manual** | None | User | Free | Tedious for large datasets |

**Recommendation: `faster-whisper` inside the TTS container.** Rationale:
- The container already has PyTorch, torchaudio, and heavy ML deps. Adding faster-whisper (~200MB without model, model downloaded on first use) is incremental cost.
- Transcription is a batch operation (run once per training batch), not latency-sensitive.
- Keeps everything self-hosted (no API costs for potentially hours of audio).
- The `base` or `small` model (74MB-244MB) is sufficient for clean single-speaker English audio.

| Technology | Version | Purpose | Where | Why | Confidence |
|------------|---------|---------|-------|-----|------------|
| `faster-whisper` | >=1.1.0 | Local speech-to-text for training transcripts | TTS container (Python) | CTranslate2-optimized Whisper. 4x faster than original Whisper on CPU. Produces word-level timestamps. Needed for automatic transcription of training clips to populate `metadata.csv`. | MEDIUM (not yet verified in container, but well-established library) |

### Pipeline Overview

```
User triggers "retrain voice from video URL" via UI
  |
  v
[Node.js Backend - MCP Tool]
  1. download_media(url) -> /tmp/jarvis-training/raw_video.mp4
  2. Extract audio: ffmpeg -i video.mp4 -ar 22050 -ac 1 audio.wav
  3. Copy audio to TTS container volume: /training/input/
  |
  v
[Python TTS Container]
  4. prepare_dataset.py:
     - Split on silence (pydub)
     - Filter by duration (3-15s)
     - Normalize & resample (scipy/librosa)
  5. transcribe_clips.py:
     - Whisper transcription (faster-whisper)
     - Generate metadata.csv
  6. compute_speaker_embedding.py (existing)
  7. finetune_xtts.py (existing)
  |
  v
[Node.js Backend]
  8. Notify user via Socket.IO when training complete
  9. Trigger TTS container restart to load new weights
```

### Dockerfile Changes for TTS Container

Add to `/opt/jarvis-tts/Dockerfile`:
```dockerfile
# Add pydub for audio segmentation
RUN pip install --no-cache-dir pydub>=0.25.1

# Add faster-whisper for automatic transcription
RUN pip install --no-cache-dir faster-whisper>=1.1.0
```

These are pip additions to the existing container, not a new container.

### What NOT to Add

- **`fluent-ffmpeg` (npm):** Archived May 2025. Use direct `child_process.execFile('ffmpeg', [...])` invocation.

- **Separate transcription service / container:** Running whisper in its own container adds Docker orchestration complexity. The TTS container already has all ML dependencies. Keep it consolidated.

- **`pyannote` (VAD):** Deep-learning voice activity detection is overkill for clean single-speaker training audio. pydub's `split_on_silence` with tuned thresholds is sufficient and uses no GPU.

- **Browser-based whisper (whisper.js / @xenova/transformers):** WASM-based inference is 10-50x slower than native. We have a Python container with proper ML support. Use it.

- **`nodejs-whisper` / `whisper-node` (npm):** These are Node.js bindings for whisper.cpp. While they work, the TTS container already has Python + PyTorch + torchaudio. Adding faster-whisper to that environment is the natural choice -- no need to compile whisper.cpp on the host.

### Safety Classification

| Tool | Tier | Rationale |
|------|------|-----------|
| `list_training_data` | GREEN | Read-only listing of training clips |
| `prepare_training_data` | RED | Runs processing pipeline, writes files |
| `start_voice_training` | RED | Starts GPU/CPU-intensive training job |
| `get_training_status` | GREEN | Read-only training progress check |

### Integration Points

```
NEW: src/mcp/tools/voice.ts              Voice training MCP tools
NEW: src/services/voice-training.ts       Orchestration: download, extract, trigger container
Reuse: src/services/download.ts           File download (from Section 1)
Reuse: src/services/media-probe.ts        ffprobe metadata (from Section 1)

NEW (Python): /opt/jarvis-tts/training/prepare_dataset.py    Audio segmentation + normalization
NEW (Python): /opt/jarvis-tts/training/transcribe_clips.py   Whisper transcription for metadata.csv
UPDATE: /opt/jarvis-tts/Dockerfile                           Add pydub + faster-whisper
```

---

## Complete v1.2 Installation Commands

### Backend (`jarvis-backend/`)

```bash
# NO NEW NPM PACKAGES NEEDED for the backend.
# All features use Node.js 22 built-in APIs:
#   - fetch() for HTTP downloads
#   - child_process for ffmpeg, yt-dlp, docker exec
#   - fs/promises for file reading, directory listing
#   - fs.glob() for pattern matching
#   - path for safe path manipulation
#
# Existing packages already cover:
#   - @anthropic-ai/sdk for Claude-powered code analysis
#   - openai for local LLM analysis
#   - node-ssh for remote file operations
#   - zod for input validation
```

**Total: 0 new npm dependencies for the backend.**

### TTS Container (`/opt/jarvis-tts/`)

```bash
# Inside the Docker container (add to Dockerfile):
pip install pydub>=0.25.1
pip install faster-whisper>=1.1.0
```

**Total: 2 new pip packages in the existing TTS container.**

### Host System (already installed, verify only)

```bash
# Verify these are available (they already are on this host):
ffmpeg -version    # 7.1.3 -- confirmed
ffprobe -version   # 7.1.3 -- confirmed
yt-dlp --version   # 2025.12.08 -- confirmed
```

---

## New Config Values (`.env`)

```bash
# File operations
FILE_DOWNLOAD_DIR=/tmp/jarvis-downloads      # NEW: temp download directory
FILE_MAX_SIZE_MB=2048                        # NEW: max download size (2GB)
FILE_ALLOWED_ROOTS=/root/jarvis-backend,/root/jarvis-ui,/opt/jarvis-tts,/opt/jarvis
                                             # NEW: allowed directories for file browsing

# Voice training
TRAINING_INPUT_DIR=/opt/jarvis-tts/training/input    # NEW: raw audio staging
TRAINING_MAX_AUDIO_MINUTES=60                        # NEW: max audio duration per batch
WHISPER_MODEL=base                                   # NEW: whisper model size (base/small/medium)
```

---

## Alternatives Considered (v1.2 Specific)

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP downloads | Built-in `fetch()` | `axios` / `got` / `node-fetch` | Node 22 fetch is stable, performant, zero deps |
| Video downloads | `child_process` + yt-dlp | `ytdlp-nodejs` npm wrapper | Bundles own binary (30MB+), conflicts with host yt-dlp, unnecessary abstraction |
| FFmpeg integration | `child_process.execFile()` | `fluent-ffmpeg` | Archived May 2025, unmaintained, broken with recent ffmpeg |
| FFmpeg integration | `child_process.execFile()` | `@mmomtchev/ffmpeg` (N-API bindings) | Beta quality, native C++ bindings add compilation complexity, overkill for CLI invocation |
| Glob/file search | Built-in `fs.glob()` | `glob` / `fast-glob` / `globby` | Node 22.17.0+ has stable native glob |
| Directory listing | Built-in `fs.readdir({ recursive: true })` | `recursive-readdir` npm | Built-in handles this natively |
| MIME detection | `path.extname()` + lookup table | `mime-types` / `file-type` npm | For download validation, extension-based detection is sufficient. Magic number detection (file-type) is overkill for our use case |
| Code analysis | Claude API (existing) | Tree-sitter AST parsing | LLM understands code from source text; AST parsing is for automated transforms, not analysis |
| Code analysis | Claude API (existing) | ESLint-as-library | Linting is not architectural analysis. Users can run linters via execute_ssh |
| Audio segmentation | pydub (Python) | pyAudioAnalysis | pydub is simpler, more widely used, sufficient for clean single-speaker audio |
| Audio segmentation | pydub (Python) | ffmpeg silenceremove filter | ffmpeg's silence filter works but is harder to tune and debug. pydub gives per-segment control and duration filtering |
| Transcription | faster-whisper (Python) | OpenAI Whisper API | Costs money; training may involve hours of audio. Self-hosted is free |
| Transcription | faster-whisper (Python) | nodejs-whisper / whisper-node | TTS container already has Python ML stack. Adding whisper in Python is natural; whisper.cpp in Node is an extra build step |
| File watching | Not needed (on-demand reads) | chokidar v5 | We read files when the user asks, not continuously. Watching is out of scope |

---

## Version Pinning Strategy (v1.2 Additions)

| Package | Pin Strategy | Reason |
|---------|-------------|--------|
| `pydub` | `>=0.25.1` | Stable, rarely updated (last major change was years ago). Floor pin is sufficient. |
| `faster-whisper` | `>=1.1.0` | Active development. Floor pin allows getting bug fixes. CTranslate2 compatibility managed by pip resolver. |

No npm version pins needed because there are zero new npm packages.

---

## Architecture Summary (v1.2 One-Liner)

v1.2 adds zero new npm dependencies: file operations use Node.js 22 built-ins (`fetch`, `fs.glob`, `child_process` for ffmpeg/yt-dlp), project analysis uses the existing Claude API, and voice retraining adds `pydub` + `faster-whisper` to the existing Python TTS container for audio segmentation and transcription.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `fluent-ffmpeg` temptation | LOW | Document clearly that it is archived. Direct `child_process` is the right approach. |
| `fs.glob()` experimental warnings | NONE | Stable since Node 22.17.0. Verified on this host (22.22.0). |
| `faster-whisper` model download on first use | LOW | First transcription job will take extra time (~2 min) to download the model. Document this. Model persists in Docker volume. |
| TTS container rebuild needed | MEDIUM | Adding pip packages requires rebuilding the Docker image. Script the rebuild and document the process. Existing volumes preserve model weights. |
| yt-dlp version drift | LOW | yt-dlp auto-updates via `yt-dlp -U`. Pin to specific version only if breaking changes observed. |
| Large file downloads filling disk | MEDIUM | Enforce `FILE_MAX_SIZE_MB` limit. Clean up `/tmp/jarvis-downloads` on schedule. Use `node-cron` (already installed from v1.1) for periodic temp cleanup. |

---

## Sources

**Verified on host system (HIGH confidence):**
- Node.js v22.22.0 -- `node --version` on host, `fs.glob()` and `fs.readdir({ recursive: true })` confirmed working
- ffmpeg v7.1.3 -- `/usr/bin/ffmpeg -version` on host
- yt-dlp v2025.12.08 -- `/usr/local/bin/yt-dlp --version` on host
- ffmpeg v5.1.8 -- `docker exec jarvis-tts ffmpeg -version` in TTS container
- librosa 0.11.0, scipy 1.17.0, torchaudio 2.2.2+cpu -- `docker exec jarvis-tts pip list` in TTS container

**Verified via npm/web search (HIGH confidence):**
- Node.js 22 built-in `fetch()` stable -- [Node.js docs](https://nodejs.org/en/learn/getting-started/fetch)
- `fs.glob()` stable since 22.17.0 -- [Node.js 22.17.0 release notes](https://nodejs.org/en/blog/release/v22.17.0)
- `fluent-ffmpeg` archived May 2025 -- [GitHub issue #1324](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324), [npm](https://www.npmjs.com/package/fluent-ffmpeg)
- `ffmpeg-static` v5.3.0 ships ffmpeg 6.1.1 -- [npm](https://www.npmjs.com/package/ffmpeg-static) (our host has 7.1.3, no need)
- `ytdlp-nodejs` v2.3.4/3.3.9 -- [npm](https://www.npmjs.com/package/ytdlp-nodejs) (not recommended, see alternatives)
- `child_process` best practices for ffmpeg -- [Node.js docs](https://nodejs.org/api/child_process.html)

**Verified via web search (MEDIUM confidence):**
- `pydub` silence detection for voice training -- [Snyk advisor](https://snyk.io/advisor/python/pydub/functions/pydub.silence.split_on_silence)
- `faster-whisper` CPU transcription performance -- [GitHub](https://github.com/SYSTRAN/faster-whisper)
- ffmpeg audio preprocessing pipeline for training -- [Mux guide](https://www.mux.com/articles/extract-audio-from-a-video-file-with-ffmpeg), [Google Cloud docs](https://cloud.google.com/speech-to-text/docs/optimizing-audio-files-for-speech-to-text)

**Verified via codebase inspection (HIGH confidence):**
- `jarvis-backend/package.json` -- current dependency list (no changes needed)
- `jarvis-backend/src/mcp/tools/system.ts` -- MCP tool registration pattern
- `jarvis-backend/src/safety/tiers.ts` -- safety tier classification pattern
- `jarvis-backend/src/clients/ssh.ts` -- SSH execution via node-ssh (reusable for remote ops)
- `/opt/jarvis-tts/Dockerfile` -- existing Python container with ffmpeg, PyTorch, TTS deps
- `/opt/jarvis-tts/docker-compose.yml` -- existing Docker Compose with volume mounts
- `/opt/jarvis-tts/app/server.py` -- existing TTS server architecture
- `/opt/jarvis-tts/training/finetune_xtts.py` -- existing training pipeline (metadata.csv format)
- `/opt/jarvis-tts/training/compute_speaker_embedding.py` -- existing speaker embedding computation

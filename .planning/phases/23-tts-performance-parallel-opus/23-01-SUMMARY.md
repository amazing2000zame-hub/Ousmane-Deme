---
phase: 23-tts-performance-parallel-opus
plan: 01
subsystem: infra
tags: [ffmpeg, opus, docker, cpuset, tts-cache, config]

# Dependency graph
requires:
  - phase: 22-tts-reliability-piper-fallback
    provides: Piper TTS container, fallback routing, engine lock pattern
provides:
  - FFmpeg installed in backend container for Opus encoding
  - Docker CPU core pinning via cpuset for TTS/backend isolation
  - 5 Phase 23 config fields (opusEnabled, opusBitrate, ttsCacheDir, ttsCacheMaxEntries, ttsMaxParallel)
  - Disk-persistent TTS cache module with SHA-256 keyed paths and LRU eviction
  - WAV-to-OGG Opus encoding helper via FFmpeg stdin/stdout pipes
affects: [23-02 backend integration, 23-03 frontend gapless playback]

# Tech tracking
tech-stack:
  added: [ffmpeg (apt-get in Docker)]
  patterns: [disk-cache-sha256, ffmpeg-pipe-encoding, docker-cpuset-pinning]

key-files:
  created:
    - jarvis-backend/src/ai/tts-cache.ts
    - jarvis-backend/src/ai/opus-encode.ts
  modified:
    - jarvis-backend/Dockerfile
    - docker-compose.yml
    - .env
    - jarvis-backend/src/config.ts

key-decisions:
  - "Cache WAV only on disk (not Opus) -- re-encode on emission is cheaper than dual cache formats"
  - "SHA-256 hash of normalized text as cache filename -- filesystem-safe, collision-resistant"
  - "cpuset pinning: XTTS 0-3, Piper 4-5, backend 6-9 -- isolates CPU-hungry services"
  - "Opus defaults OFF -- LAN users get WAV, remote users opt-in via OPUS_ENABLED"

patterns-established:
  - "Pattern: Disk cache with LRU mtime eviction -- reusable for any file-based caching"
  - "Pattern: FFmpeg pipe encoding -- spawn per-buffer, zero temp files, stderr capture for debugging"
  - "Pattern: Docker cpuset for CPU isolation -- service-level core pinning in compose"

# Metrics
duration: 2min
completed: 2026-01-27
---

# Phase 23 Plan 01: Infrastructure Foundation Summary

**FFmpeg in Docker, cpuset CPU pinning for TTS/backend, disk-persistent SHA-256 cache module, and WAV-to-Opus encoding helper**

## Performance

- **Duration:** 2 min 22 sec
- **Started:** 2026-01-27T23:25:16Z
- **Completed:** 2026-01-27T23:27:38Z
- **Tasks:** 3/3
- **Files modified:** 6 (3 modified, 2 created, 1 appended)

## Accomplishments
- FFmpeg with libopus installed in backend Docker image for Opus audio encoding
- Docker CPU core pinning via cpuset: XTTS (cores 0-3), Piper (cores 4-5), backend (cores 6-9)
- 5 new config fields for Phase 23 features (parallel TTS, disk cache, Opus encoding)
- Disk-persistent TTS cache with init/get/put/stats exports, SHA-256 keyed filenames, LRU eviction by mtime
- WAV-to-OGG Opus encoding helper using FFmpeg child_process.spawn with stdin/stdout pipe pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Docker infrastructure -- FFmpeg, cpuset, and environment variables** - `b7353d9` (feat)
2. **Task 2: Config fields and disk cache module** - `6b1c51e` (feat)
3. **Task 3: Opus encoding module** - `d92684d` (feat)

## Files Created/Modified
- `jarvis-backend/Dockerfile` - Added ffmpeg to apt-get install for Opus encoding
- `docker-compose.yml` - Added cpuset for 3 services, deploy limits for backend, 5 new env vars
- `.env` - Added OPUS_ENABLED=false, OPUS_BITRATE=32, TTS_MAX_PARALLEL=2
- `jarvis-backend/src/config.ts` - Added 5 Phase 23 config fields after piperTtsEndpoint
- `jarvis-backend/src/ai/tts-cache.ts` - NEW: Disk cache module with init, get, put, stats, eviction
- `jarvis-backend/src/ai/opus-encode.ts` - NEW: FFmpeg WAV-to-Opus encoding with encodeWavToOpus, isOpusEnabled

## Decisions Made
- Cache stores WAV only (source format), not Opus (transport format) -- re-encoding cached WAV to Opus on each emission is ~10-30ms, negligible vs synthesis time
- SHA-256 of normalized text (trim, lowercase, collapse whitespace) as cache filename -- filesystem-safe and collision-resistant
- cpuset layout: XTTS 0-3, Piper 4-5, backend 6-9 -- leaves cores 10-19 available for llama-server (systemd, uses OS scheduler)
- Opus encoding defaults to OFF -- only useful for remote/WAN access, adds latency on LAN

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Opus encoding is disabled by default. All new env vars have sensible defaults.

## Next Phase Readiness
- All infrastructure pieces ready for Plan 02 (backend integration: parallel TTS workers, disk cache integration into tts.ts, Opus encoding in chat.ts emission)
- Plan 03 (frontend gapless playback) can use the Opus content type from opus-encode.ts
- Docker image must be rebuilt (`docker compose up -d --build`) to include FFmpeg -- this will happen during Plan 02 or deployment

---
*Phase: 23-tts-performance-parallel-opus*
*Completed: 2026-01-27*

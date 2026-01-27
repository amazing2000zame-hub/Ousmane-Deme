---
phase: 23-tts-performance-parallel-opus
plan: 02
subsystem: tts
tags: [tts, disk-cache, opus, parallel, socket.io, streaming]

# Dependency graph
requires:
  - phase: 23-01
    provides: "tts-cache.ts disk cache module, opus-encode.ts Opus encoder, config fields"
provides:
  - "Two-tier TTS cache (in-memory + disk) in synthesizeSentenceWithFallback and synthesizeViaPiper"
  - "Bounded parallel TTS drain (up to config.ttsMaxParallel concurrent workers)"
  - "Optional Opus encoding before Socket.IO audio emission"
  - "Pre-warm of 12 common JARVIS phrases at startup"
affects: [23-03, 24-observability, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-tier cache pattern: in-memory LRU -> disk cache with promote-on-hit"
    - "Bounded parallel workers with fire-and-forget + slot refill"
    - "Optional audio transcoding before emission (Opus when enabled)"

key-files:
  created: []
  modified:
    - "jarvis-backend/src/ai/tts.ts"
    - "jarvis-backend/src/realtime/chat.ts"
    - "jarvis-backend/src/index.ts"

key-decisions:
  - "Disk cache writes are fire-and-forget (.catch(() => {})) to avoid blocking synthesis"
  - "Disk cache promote-on-hit: disk reads write back to in-memory LRU for instant repeat access"
  - "Parallel workers use JS single-threaded safety for engine lock -- no mutex needed"
  - "Opus encoding is optional per-emission, not cached (WAV stored on disk, Opus re-encoded)"
  - "Pre-warm uses 10s startup delay to let XTTS container stabilize before synthesizing"

patterns-established:
  - "Two-tier cache: cacheGet() then diskCacheGet() with promote-on-hit to in-memory"
  - "Fire-and-forget disk writes: diskCachePut().catch(() => {}) after cachePut()"
  - "Bounded parallel pattern: activeWorkers counter + synthesizeAndEmit() fire-and-forget + drainTtsQueue() refill"
  - "Pre-warm pattern: serial synthesis of common phrases at startup, skip if disk-cached"

# Metrics
duration: 3min
completed: 2026-01-27
---

# Phase 23 Plan 02: Backend Integration Summary

**Two-tier disk cache in TTS synthesis, bounded parallel drain (2 concurrent workers), optional Opus encoding, and 12-phrase pre-warm at startup**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-27T23:31:08Z
- **Completed:** 2026-01-27T23:33:53Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- Integrated disk-persistent cache as second tier in both synthesizeSentenceWithFallback (XTTS + Piper fallback paths) and synthesizeViaPiper, with promote-on-hit to in-memory LRU
- Replaced serial drainTtsQueue with bounded parallel worker pattern (config.ttsMaxParallel, default 2), using fire-and-forget synthesis with automatic slot refill
- Added optional Opus encoding via encodeWavToOpus before Socket.IO audio_chunk emission (enabled by config.opusEnabled)
- Created prewarmTtsCache() exporting 12 common JARVIS phrases with serial synthesis at startup, wired via 10s delayed call in index.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate disk cache into TTS synthesis and add pre-warm** - `f4271ae` (feat)
2. **Task 2: Bounded parallel TTS drain with optional Opus encoding** - `9b7413b` (feat)

## Files Created/Modified

- `jarvis-backend/src/ai/tts.ts` - Added disk cache import, two-tier cache checks in synthesizeSentenceWithFallback (XTTS path, Piper fallback path) and synthesizeViaPiper, fire-and-forget disk writes, prewarmTtsCache() with PREWARM_PHRASES
- `jarvis-backend/src/realtime/chat.ts` - Added opus-encode import, replaced serial drainTtsQueue with bounded parallel (activeWorkers + synthesizeAndEmit), added Opus encoding before emission, removed ttsProcessing variable
- `jarvis-backend/src/index.ts` - Added prewarmTtsCache import and 10s delayed startup call inside server.listen callback

## Decisions Made

- Disk cache writes are fire-and-forget to avoid blocking the synthesis response path
- Disk cache hits promote to in-memory LRU for instant repeat access within the same server lifecycle
- Engine lock safety across parallel workers relies on JavaScript's single-threaded event loop (no mutex needed)
- Opus encoding happens per-emission, not cached -- WAV stored on disk, Opus re-encoded each time (cheaper than dual-format storage)
- Pre-warm uses 10s startup delay to allow XTTS Docker container to reach healthy state

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. All config fields (opusEnabled, ttsCacheDir, ttsMaxParallel) were added in Plan 01.

## Next Phase Readiness

- All Phase 23 backend integration complete (Plan 01 infra + Plan 02 integration + Plan 03 gapless playback)
- Phase 23 is now fully complete -- all 3 plans shipped
- Ready for Phase 24 (Observability & Context Management)
- Deployment note: Docker rebuild required to pick up code changes (backend container)

---
*Phase: 23-tts-performance-parallel-opus*
*Completed: 2026-01-27*

---
phase: 23-tts-performance-parallel-opus
plan: 03
subsystem: ui
tags: [web-audio, gapless-playback, clock-scheduling, opus, pre-decode, audiobuffersourcenode]

# Dependency graph
requires:
  - phase: 21-quick-wins-baseline
    provides: Progressive audio queue foundation with chunk-by-chunk playback
provides:
  - Gapless audio playback via Web Audio clock scheduling
  - Buffer pre-decode to eliminate decode latency between chunks
  - OGG Opus content type support (auto-detected by decodeAudioData)
affects: [23-04 opus encoding, 24 observability, 25 chat virtualization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Web Audio clock scheduling with AudioBufferSourceNode.start(when) for gapless playback"
    - "Buffer pre-decode pattern: decode next chunk during current playback"
    - "nextStartTime accumulator for precise gap-free audio transitions"

key-files:
  created: []
  modified:
    - /root/jarvis-ui/src/audio/progressive-queue.ts

key-decisions:
  - "Use source.start(startAt) instead of source.start() -- precise Web Audio clock eliminates event loop latency gaps"
  - "onended callback retained for queue management (triggering next cycle), not for playback timing"
  - "Pre-decode is fire-and-forget -- failure falls back to synchronous decode with no error propagation"
  - "Clock resets on session start, stop, and finalize to prevent scheduling into a stale future"
  - "chunk.buffer.slice(0) copies ArrayBuffer because decodeAudioData detaches the original"

patterns-established:
  - "Clock scheduling: nextStartTime = startAt + audioBuffer.duration for zero-gap transitions"
  - "Prefetch pattern: peek queue[0] during playback, pre-decode buffer, match by chunk index"

# Metrics
duration: 4min
completed: 2026-01-27
---

# Phase 23 Plan 03: Gapless Playback Summary

**Web Audio clock scheduling with AudioBufferSourceNode.start(when) and buffer pre-decode for zero-gap sentence transitions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-27T23:25:10Z
- **Completed:** 2026-01-27T23:29:30Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Eliminated perceptible gaps between sentences by replacing `source.start()` with `source.start(startAt)` using precise Web Audio clock scheduling
- Added `nextStartTime` accumulator that tracks the exact clock position for each successive audio chunk (zero gap)
- Implemented `prefetchNextChunk()` that pre-decodes the next buffer during current playback, eliminating async decode latency
- Added OGG Opus content type awareness with debug logging for troubleshooting non-WAV chunks
- All 9 existing public API exports preserved -- no breaking changes to consumers

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement gapless playback with clock scheduling and pre-decode** - `aec47db` (feat)
2. **Task 2: Handle OGG Opus content type in audio chunk processing** - `295959d` (feat)

## Files Created/Modified
- `jarvis-ui/src/audio/progressive-queue.ts` - Gapless playback with clock scheduling, pre-decode, and Opus support

## Decisions Made
- **Clock scheduling over onended chaining:** `source.start(startAt)` schedules audio at the hardware level, bypassing event loop delays. The `onended` callback is retained only for queue management (triggering the next decode/schedule cycle), not for determining when audio starts.
- **Pre-decode as optimization, not requirement:** `prefetchNextChunk()` is fire-and-forget. If it fails or the queue is empty, the next chunk simply decodes synchronously. This avoids complexity while providing the fast path.
- **ArrayBuffer copy via slice(0):** `decodeAudioData` detaches its input ArrayBuffer, so a copy is made with `.slice(0)` to prevent use-after-detach errors.
- **Clock reset on all lifecycle boundaries:** `nextStartTime` resets to 0 on session start, stop, and finalize. Without this, a new session would try to schedule audio at the old session's future clock position.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- Gapless playback is ready for production use with existing WAV chunks
- When Opus encoding is added (Phase 23 Plan 04), `decodeAudioData` handles OGG Opus natively -- no further changes needed in this file
- Debug logging for non-WAV content types will help troubleshoot Opus integration

---
*Phase: 23-tts-performance-parallel-opus*
*Completed: 2026-01-27*

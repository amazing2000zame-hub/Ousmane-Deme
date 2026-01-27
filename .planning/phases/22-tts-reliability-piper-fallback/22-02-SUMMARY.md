---
phase: 22-tts-reliability-piper-fallback
plan: 02
subsystem: backend
tags: [tts, fallback, piper, xtts, reliability, voice-consistency, health-tracking]

# Dependency graph
requires:
  - phase: 22-01
    provides: "Piper Docker container + piperTtsEndpoint config"
  - phase: 21-quick-wins-baseline
    provides: "TTS health endpoint, sentence cache with engine key support"
provides:
  - "synthesizeSentenceWithFallback() -- 3s XTTS timeout with Piper fallback"
  - "XTTS health state tracking (shouldTryXTTS, 30s recovery interval)"
  - "Per-response engine lock in chat.ts for voice consistency"
  - "synthesizePiper() for direct Piper HTTP API synthesis"
  - "TTSEngine and CachedAudioWithEngine types"
affects: [phase-23 (parallel pipeline may use fallback routing), phase-24 (observability can trace engine selection)]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-sentence fallback with timeout racing, health-aware circuit breaker, per-response engine lock for voice consistency]

key-files:
  created: []
  modified:
    - /root/jarvis-backend/src/ai/tts.ts
    - /root/jarvis-backend/src/realtime/chat.ts

key-decisions:
  - "3-second XTTS timeout before Piper fallback (balances speed vs XTTS quality)"
  - "30-second recovery interval before re-trying XTTS after failure (prevents hammering)"
  - "Per-response engine lock: once Piper activates, all remaining sentences use Piper (voice consistency)"
  - "Engine lock resets per response (null), enabling automatic XTTS recovery on next message"
  - "Sequential racing (XTTS then Piper), not parallel, to avoid CPU contention"
  - "ttsAvailable() now returns true if Piper is configured, even when XTTS is down"

patterns-established:
  - "Promise.race with timeout for synthesis deadline enforcement"
  - "Health state module pattern: shouldTry/markFailed/markSucceeded triplet"
  - "Engine lock scoped to function scope for per-invocation isolation"

# Metrics
duration: 3min
completed: 2026-01-27
---

# Phase 22 Plan 02: TTS Fallback Routing Logic Summary

**3-second XTTS timeout with automatic Piper fallback, health-aware XTTS circuit breaker (30s recovery), and per-response engine lock for voice consistency in chat.ts**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-01-27T22:45:28Z
- **Completed:** 2026-01-27T22:48:02Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `synthesizeSentenceWithFallback()` added to tts.ts with full routing logic:
  - Engine lock check (TTS-04: if locked to Piper, skip XTTS entirely)
  - XTTS cache check (instant, free)
  - Health-aware routing (TTS-03: if XTTS known-unhealthy, go to Piper immediately)
  - 3-second XTTS timeout via Promise.race (TTS-02)
  - Piper fallback with its own LRU cache integration
- XTTS health tracking: `shouldTryXTTS()`, `markXTTSFailed()`, `markXTTSSucceeded()` with 30-second recovery interval
- `synthesizePiper()` function for HTTP POST to Piper wyoming-piper endpoint
- `ttsAvailable()` updated to include Piper availability (voice pipeline activates even when XTTS is down)
- `drainTtsQueue()` in chat.ts now uses fallback synthesis with per-response engine lock
- Engine lock scoped to `handleSend()` -- each new user message gets a fresh lock (automatic XTTS recovery)

## Requirements Coverage

| Requirement | Implementation | Location |
|-------------|----------------|----------|
| TTS-01 | Piper container (Plan 01) + synthesizePiper() | tts.ts:170 |
| TTS-02 | XTTS_FALLBACK_TIMEOUT = 3s, Promise.race | tts.ts:79, 462 |
| TTS-03 | shouldTryXTTS() health routing, 30s recovery | tts.ts:78, 81 |
| TTS-04 | engineLock in drainTtsQueue, once Piper always Piper | chat.ts:223, 239 |

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Piper synthesis, fallback routing, and health tracking to tts.ts** - `4bf6f69` (feat)
2. **Task 2: Wire engine lock and fallback synthesis into chat.ts** - `583f7bd` (feat)
3. **Task 3: Validate full stack compilation and Docker config** - verification only, no code changes

## Files Modified

- `/root/jarvis-backend/src/ai/tts.ts` - Added TTSEngine type, CachedAudioWithEngine interface, XTTS health tracking, synthesizePiper(), synthesizeSentenceWithFallback(), synthesizeViaPiper(), piperTTSConfigured(), updated ttsAvailable()
- `/root/jarvis-backend/src/realtime/chat.ts` - Updated import to synthesizeSentenceWithFallback + TTSEngine, added engineLock variable, replaced drainTtsQueue with fallback-aware version

## Decisions Made

- 3-second XTTS timeout chosen to balance XTTS quality (which typically responds in 8-15s for CPU) against user-perceived latency. If XTTS can't start responding within 3s, Piper takes over.
- 30-second recovery interval prevents hammering a down XTTS service while still recovering quickly once it's back.
- Engine lock enforces the "never mix voices" rule from CONTEXT.md. Once Piper is used for any sentence, all remaining sentences use Piper for that response.
- Engine lock is scoped to handleSend(), not global, so XTTS recovery happens automatically on the next user message.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Phase 22 is complete. All TTS reliability requirements (TTS-01 through TTS-04) are implemented.
- Piper container + fallback routing + engine lock are ready for production deployment via `docker compose up -d --build`.
- Phase 23 (Parallel Pipeline + Opus) can build on this fallback infrastructure.
- The fallback routing is transparent to the frontend -- audio chunks arrive via the same chat:audio_chunk event regardless of engine.

---
*Phase: 22-tts-reliability-piper-fallback*
*Completed: 2026-01-27*

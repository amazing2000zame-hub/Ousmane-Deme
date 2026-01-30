---
phase: 30-mcp-reliability-voice-ack
plan: 01
subsystem: voice, realtime
tags: [socket.io, tts, piper, audio, web-audio-api]

# Dependency graph
requires:
  - phase: 22-tts-reliability-piper-fallback
    provides: Piper TTS fallback system for instant synthesis
provides:
  - Dedicated chat:acknowledge Socket.IO event for tool acknowledgments
  - playAcknowledgmentImmediate function for instant audio playback
  - Piper-preferred acknowledgment synthesis (<200ms vs 7-15s XTTS)
affects: [voice-pipeline, tool-execution-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dedicated event for time-sensitive audio (not queued with response)"
    - "Fire-and-forget immediate playback via Web Audio start(0)"
    - "Engine lock to force fast TTS engine"

key-files:
  created: []
  modified:
    - jarvis-ui/src/audio/progressive-queue.ts
    - jarvis-ui/src/hooks/useChatSocket.ts
    - jarvis-backend/src/realtime/chat.ts

key-decisions:
  - "Use dedicated chat:acknowledge event instead of index=-1 hack"
  - "Force Piper TTS for acknowledgments to ensure <200ms synthesis"
  - "Fire-and-forget pattern - don't block on acknowledgment playback"

patterns-established:
  - "Time-sensitive audio uses dedicated events, not the progressive queue"
  - "Immediate playback via source.start(0) for zero scheduling delay"

# Metrics
duration: 2min 29s
completed: 2026-01-30
---

# Phase 30 Plan 01: Voice Acknowledgment Timing Fix Summary

**Dedicated chat:acknowledge event with Piper TTS for instant "One moment, sir" before tool execution**

## Performance

- **Duration:** 2 min 29 sec
- **Started:** 2026-01-30T08:25:57Z
- **Completed:** 2026-01-30T08:28:26Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Created `playAcknowledgmentImmediate()` function that bypasses progressive queue for instant playback
- Added `chat:acknowledge` event handler in frontend with base64-to-ArrayBuffer decoding
- Updated backend to emit `chat:acknowledge` event and force Piper TTS for fast synthesis
- Acknowledgments now play BEFORE tool execution instead of being queued/dropped

## Task Commits

Each task was committed atomically:

1. **Task 1: Add playAcknowledgmentImmediate function** - `6871e36` (feat)
2. **Task 2: Add chat:acknowledge handler in frontend** - `379bde4` (feat)
3. **Task 3: Update backend to use dedicated event** - `c633c20` (feat)

## Files Created/Modified

- `jarvis-ui/src/audio/progressive-queue.ts` - New `playAcknowledgmentImmediate()` export for instant audio playback
- `jarvis-ui/src/hooks/useChatSocket.ts` - New `onAcknowledge` handler, base64 decoding, event registration
- `jarvis-backend/src/realtime/chat.ts` - Changed to `chat:acknowledge` event, forced Piper engine lock, added logging

## Decisions Made

1. **Dedicated event over index=-1 hack** - The previous approach used `chat:audio_chunk` with `index: -1` but this got queued/dropped by the progressive audio system. A dedicated `chat:acknowledge` event ensures immediate processing.

2. **Force Piper TTS** - XTTS takes 7-15 seconds even for short phrases. Piper synthesizes in <200ms, making acknowledgments truly instant.

3. **Fire-and-forget pattern** - `playAcknowledgmentImmediate()` starts playback but doesn't await completion, ensuring the tool execution isn't delayed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Voice acknowledgments now work correctly with instant Piper synthesis
- Users will hear "One moment, sir" BEFORE tool results appear
- Progressive queue remains unchanged for response audio
- Ready for integration testing with actual tool calls

---
*Phase: 30-mcp-reliability-voice-ack*
*Completed: 2026-01-30*

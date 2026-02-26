---
phase: 36-speaker-output-loop
plan: 02
subsystem: audio
tags: [alsa, mic-mute, chime, conversation-mode, state-machine, echo-prevention]

# Dependency graph
requires:
  - phase: 36-speaker-output-loop
    plan: 01
    provides: "AudioPlayer class with on_playback_done callback, ALSA output"
  - phase: 34-audio-capture-daemon-core
    provides: "CaptureStateMachine with IDLE/CAPTURING states, WakeWordDetector"
provides:
  - "Mic mute/unmute during TTS playback (echo prevention via amixer Dmic0 nocap/cap)"
  - "Wake word detection chime (ascending C5+E5, ~350ms)"
  - "CONVERSATION state with 15-second follow-up window"
  - "on_tts_done/check_conversation_timeout/on_conversation_speech state machine methods"
  - "Mic mute safety timeout (60s force unmute)"
affects: [38-service-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "amixer subprocess for mic mute/unmute (Dmic0 nocap/cap)"
    - "Pre-generated PCM chime with math.sin + struct.pack for ALSA direct write"
    - "Mic mute synchronized in playback thread (not main loop) for timing accuracy"
    - "Safety timeout pattern: force recovery if hardware state stuck"

key-files:
  created: []
  modified:
    - jarvis-ear/src/jarvis_ear/speaker.py
    - jarvis-ear/src/jarvis_ear/state_machine.py
    - jarvis-ear/src/jarvis_ear/__main__.py
    - jarvis-ear/src/jarvis_ear/config.py

key-decisions:
  - "Mic mute in playback thread (not main loop) for timing synchronization with ALSA output"
  - "Chime plays before mic mute (non-speech frequencies won't trigger wake word)"
  - "60s safety timeout force-unmutes mic if stuck (hardware resilience)"
  - "Conversation follow-up starts new CAPTURING without pre-roll (immediate speech)"

patterns-established:
  - "state_machine.on_tts_done() as playback-complete callback entry point"
  - "CONVERSATION -> CAPTURING transition for wake-word-free follow-up capture"

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 36 Plan 02: Speaker Output Loop Summary

**Mic mute during TTS playback via amixer Dmic0, ascending two-tone wake word chime, and 15-second CONVERSATION follow-up window for multi-turn dialogue**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T14:51:52Z
- **Completed:** 2026-02-26T14:55:06Z
- **Tasks:** 2 of 3 (Task 3 is human-verify checkpoint)
- **Files modified:** 4

## Accomplishments
- Mic is muted (amixer Dmic0 nocap) when first TTS chunk plays, unmuted after playback drains, with 60s safety timeout
- Two-tone ascending chime (C5+E5, ~350ms, 67200 bytes PCM) pre-generated at init and played synchronously on wake word detection
- CONVERSATION state added to state machine with on_tts_done(), check_conversation_timeout(), on_conversation_speech() methods
- Main loop wired: on_playback_done callback -> state_machine.on_tts_done(), chime on wake word, CONVERSATION handler with follow-up detection

## Task Commits

Each task was committed atomically:

1. **Task 1: Add mic mute, chime generation, and conversation state machine** - `a70495f` (feat)
2. **Task 2: Wire conversation mode and chime into main loop** - `eab8a94` (feat)
3. **Task 3: End-to-end voice loop verification** - CHECKPOINT (human-verify, not executed)

## Files Created/Modified
- `jarvis-ear/src/jarvis_ear/speaker.py` - Mic mute/unmute methods, chime generation, safety timeout in playback loop
- `jarvis-ear/src/jarvis_ear/state_machine.py` - CONVERSATION state enum, on_tts_done/check_conversation_timeout/on_conversation_speech methods
- `jarvis-ear/src/jarvis_ear/config.py` - CONVERSATION_TIMEOUT_S, MIC_MUTE_SAFETY_TIMEOUT_S, CHIME_AMPLITUDE, CHIME_TONE_DURATION_S, CHIME_GAP_DURATION_S, CHIME_FREQUENCIES
- `jarvis-ear/src/jarvis_ear/__main__.py` - Wired on_playback_done callback, play_chime on wake word, CONVERSATION state handler, conversation_followups counter

## Decisions Made
- Mic mute lives in speaker.py playback thread, not main loop -- synchronized with actual ALSA output timing
- Chime plays before mic mute because C5+E5 frequencies are non-speech and won't trigger wake word model
- 60-second safety timeout force-unmutes mic if hardware state gets stuck (resilience against amixer failures)
- Conversation follow-up starts CAPTURING immediately without pre-roll buffer (user is already speaking)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Checkpoint Pending

Task 3 (human-verify) requires manual end-to-end testing of the complete voice loop: wake word -> chime -> capture -> TTS playback with mic mute -> conversation follow-up. See plan for detailed verification steps.

## Next Phase Readiness
- Voice loop feature-complete pending human verification
- Phase 38 (Service Management) can proceed after Task 3 approval
- Known backend issue: Whisper STT returns 400 "error parsing body" (not jarvis-ear, backend multipart encoding bug)

## Self-Check: PASSED

All 4 modified files verified present. Both commits (a70495f, eab8a94) verified in git log. SUMMARY.md created.

---
*Phase: 36-speaker-output-loop*
*Completed: 2026-02-26*

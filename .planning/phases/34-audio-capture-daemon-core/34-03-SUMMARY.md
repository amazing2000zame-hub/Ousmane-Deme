---
phase: 34-audio-capture-daemon-core
plan: 03
subsystem: audio
tags: [openwakeword, wake-word, state-machine, capture-lifecycle, hey-jarvis, daemon]

requires:
  - phase: 34-audio-capture-daemon-core (plan 01)
    provides: "AudioCapture class, RingBuffer, config constants, project scaffold"
  - phase: 34-audio-capture-daemon-core (plan 02)
    provides: "VoiceActivityDetector with is_speech() and Silero ONNX model"
provides:
  - "WakeWordDetector class wrapping openWakeWord hey_jarvis_v0.1 ONNX model"
  - "CaptureStateMachine managing IDLE -> CAPTURING -> IDLE lifecycle"
  - "Main daemon entry point (__main__.py) wiring AudioCapture -> VAD -> WakeWord -> StateMachine"
  - "Two-stage pipeline: VAD gates wake word detection to save CPU"
  - "500ms pre-roll preservation on wake word trigger"
  - "2-second silence timeout for end-of-utterance detection"
  - "Runnable daemon via python -m jarvis_ear"
affects: [35-backend-integration, 36-speaker-output]

tech-stack:
  added: [openwakeword-0.4.0, hey_jarvis_v0.1-onnx-model]
  patterns: [two-stage-vad-wakeword-pipeline, state-machine-capture-lifecycle, signal-based-shutdown, periodic-stats-logging]

key-files:
  created:
    - /root/jarvis-ear/src/jarvis_ear/wakeword.py
    - /root/jarvis-ear/src/jarvis_ear/state_machine.py
    - /root/jarvis-ear/src/jarvis_ear/__main__.py
  modified: []

key-decisions:
  - "Used wakeword_model_paths API (correct for openwakeword 0.4.x) instead of plan's wakeword_models parameter"
  - "Single-threaded main loop with daemon-threaded audio capture for simplicity"
  - "VAD reset after wake word detection and capture completion to avoid state leakage"

patterns-established:
  - "Two-stage pipeline: VAD filters silence before wake word runs (saves CPU on quiet frames)"
  - "State machine pattern: event-driven transitions via on_wake_word() and on_frame() methods"
  - "Signal-based shutdown: SIGINT/SIGTERM set shutdown flag for graceful exit"
  - "Periodic stats: frame rate, speech percentage, detection counts logged every 30s"

duration: 4min
completed: 2026-02-26
---

# Phase 34 Plan 03: Wake Word + State Machine Summary

**openWakeWord "Hey Jarvis" detection with IDLE/CAPTURING state machine, two-stage VAD pipeline, 500ms pre-roll, and 2s silence end-of-utterance detection wired as a runnable daemon**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-26T05:47:30Z
- **Completed:** 2026-02-26T05:50:58Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- WakeWordDetector wrapping openWakeWord's hey_jarvis_v0.1 ONNX model with correct 0.4.x API
- CaptureStateMachine managing IDLE -> CAPTURING -> IDLE lifecycle with configurable silence timeout
- Main daemon entry point wiring the full pipeline: AudioCapture -> VAD -> WakeWord -> StateMachine
- Two-stage pipeline saving CPU by only running wake word on speech-classified frames
- Graceful shutdown via SIGINT/SIGTERM signal handling
- Periodic health stats logging (fps, speech%, wake word counts, capture counts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement openWakeWord detector and state machine** - `b57810b` (feat)
2. **Task 2: Create main daemon entry point wiring the full pipeline** - `ca1a22b` (feat)

## Files Created/Modified
- `/root/jarvis-ear/src/jarvis_ear/wakeword.py` - WakeWordDetector class wrapping openWakeWord hey_jarvis model
- `/root/jarvis-ear/src/jarvis_ear/state_machine.py` - CaptureStateMachine with IDLE/CAPTURING states and silence timeout
- `/root/jarvis-ear/src/jarvis_ear/__main__.py` - Main daemon loop wiring AudioCapture -> VAD -> WakeWord -> StateMachine

## Decisions Made

1. **Used wakeword_model_paths instead of wakeword_models** -- The plan's code used `OwwModel(wakeword_models=["hey_jarvis"])` which is not a valid parameter for openwakeword 0.4.x. The actual API uses `wakeword_model_paths` (a list of ONNX file paths). The correct invocation is `OwwModel(wakeword_model_paths=[openwakeword.models["hey_jarvis"]["model_path"]])`.

2. **Single-threaded main loop** -- Audio capture runs in its own daemon thread (from Plan 01), but VAD, wake word, and state machine all run in the main thread. This avoids race conditions and keeps the code simple.

3. **VAD reset at transition boundaries** -- VAD hidden state is reset both after wake word detection (entering CAPTURING) and after capture completion (returning to IDLE) to prevent temporal state leakage between different audio contexts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected openWakeWord Model constructor API**
- **Found during:** Task 1 (WakeWordDetector implementation)
- **Issue:** Plan specified `OwwModel(wakeword_models=["hey_jarvis"])` but openwakeword 0.4.x Model class uses `wakeword_model_paths` (list of ONNX file paths), not `wakeword_models`. The plan also mentioned `inference_framework="onnx"` which does not exist in this version.
- **Fix:** Used `OwwModel(wakeword_model_paths=[openwakeword.models["hey_jarvis"]["model_path"]])` to load only the hey_jarvis model via its file path. Used `predict()` return dict instead of `prediction_buffer` access pattern.
- **Files modified:** /root/jarvis-ear/src/jarvis_ear/wakeword.py
- **Verification:** File syntax validated, API matches actual openwakeword 0.4.x source code inspection
- **Committed in:** b57810b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential correction -- plan's API calls would have caused ImportError/TypeError at runtime. No scope creep.

## Issues Encountered
- Python execution was restricted during verification, preventing runtime testing of WakeWordDetector model loading and state machine transitions. Code correctness was verified through source code inspection of the openwakeword library (model.py, __init__.py, utils.py) and Python syntax validation. Full runtime verification should be performed before Phase 35.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The complete audio capture daemon is now runnable via `python -m jarvis_ear`
- The `captured_audio` bytes in `__main__.py` are ready for Phase 35 Socket.IO streaming
- The TODO placeholder at line ~105 in `__main__.py` marks the exact integration point
- All five phase success criteria are addressed:
  1. Continuous 16kHz capture without overflows (Plan 01)
  2. VAD filters silence (Plan 02, gating in __main__.py)
  3. "Hey Jarvis" triggers IDLE -> CAPTURING (wakeword.py + state_machine.py)
  4. 2s silence ends capture (state_machine.py SILENCE_TIMEOUT_S)
  5. 500ms pre-roll preserved (ring_buffer.py + drain_preroll in __main__.py)

## Self-Check: PASSED

- FOUND: /root/jarvis-ear/src/jarvis_ear/wakeword.py (3056 bytes)
- FOUND: /root/jarvis-ear/src/jarvis_ear/state_machine.py (4099 bytes)
- FOUND: /root/jarvis-ear/src/jarvis_ear/__main__.py (5258 bytes)
- FOUND: /root/.planning/phases/34-audio-capture-daemon-core/34-03-SUMMARY.md
- FOUND: commit b57810b (Task 1)
- FOUND: commit ca1a22b (Task 2)
- All 3 Python files pass syntax validation (ast.parse)

---
*Phase: 34-audio-capture-daemon-core*
*Completed: 2026-02-26*

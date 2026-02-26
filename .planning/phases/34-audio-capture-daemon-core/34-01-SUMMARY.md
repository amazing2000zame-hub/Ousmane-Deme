---
phase: 34-audio-capture-daemon-core
plan: 01
subsystem: audio
tags: [alsa, pyalsaaudio, ring-buffer, pcm, audio-capture, threading]

requires:
  - phase: 33-audio-hardware-foundation
    provides: "ALSA dsnoop config, DMIC hardware verification, /etc/asound.conf"
provides:
  - "jarvis-ear Python package scaffold at /root/jarvis-ear/"
  - "AudioCapture class with continuous ALSA capture in daemon thread"
  - "RingBuffer class for 500ms pre-roll audio storage"
  - "512-sample frames (1024 bytes) matching Silero VAD input size"
  - "Queue-based frame delivery for downstream consumers"
affects: [34-02-vad-integration, 34-03-wake-word-state-machine, 35-backend-integration]

tech-stack:
  added: [pyalsaaudio, onnxruntime, openwakeword, silero-vad, torch]
  patterns: [daemon-thread-capture, ring-buffer-preroll, frame-accumulation, queue-delivery]

key-files:
  created:
    - /root/jarvis-ear/pyproject.toml
    - /root/jarvis-ear/requirements.txt
    - /root/jarvis-ear/src/jarvis_ear/__init__.py
    - /root/jarvis-ear/src/jarvis_ear/config.py
    - /root/jarvis-ear/src/jarvis_ear/audio.py
    - /root/jarvis-ear/src/jarvis_ear/ring_buffer.py
  modified: []

key-decisions:
  - "Pinned openwakeword>=0.4 (>=0.6 requires tflite-runtime unavailable on Python 3.13)"
  - "Frame accumulation pattern: combine 256-sample ALSA reads into 512-sample VAD frames"
  - "silero-vad pulled PyTorch (~900MB) despite plan's ONNX-only preference"

patterns-established:
  - "Frame accumulation: bytearray accumulator emits fixed-size frames from variable ALSA reads"
  - "Queue + ring buffer dual delivery: ring buffer for pre-roll, queue for real-time processing"
  - "Daemon thread capture: blocking ALSA reads in background thread, no busy-waiting"

duration: 8min
completed: 2026-02-26
---

# Phase 34 Plan 01: Audio Capture Foundation Summary

**Continuous ALSA capture daemon thread with 512-sample frame accumulation, 500ms ring buffer pre-roll, and queue-based delivery to downstream VAD/wake word pipeline**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-26T05:36:23Z
- **Completed:** 2026-02-26T05:45:01Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Python project scaffold at /root/jarvis-ear/ with virtual environment and all dependencies
- AudioCapture class capturing 16kHz mono PCM at ~31 frames/sec (512 samples per 32ms frame)
- Thread-safe RingBuffer holding exactly 15 frames (500ms, 15360 bytes) of pre-roll audio
- Frame accumulation layer compensating for dsnoop's 256-sample period size
- Verified: 94 frames in 3 seconds, zero overflows, exact frame sizes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Python project scaffold and install dependencies** - `e45d63e` (feat)
2. **Task 2: Implement ring buffer and ALSA capture thread** - `c60835d` (feat)

## Files Created/Modified
- `/root/jarvis-ear/pyproject.toml` - Python project metadata with pyalsaaudio, onnxruntime, openwakeword, silero-vad
- `/root/jarvis-ear/requirements.txt` - Pip-installable dependency list
- `/root/jarvis-ear/src/jarvis_ear/__init__.py` - Package marker with version
- `/root/jarvis-ear/src/jarvis_ear/config.py` - Central constants (16kHz, 512 samples, 15 frame pre-roll)
- `/root/jarvis-ear/src/jarvis_ear/audio.py` - ALSA capture thread with frame accumulation and dual delivery
- `/root/jarvis-ear/src/jarvis_ear/ring_buffer.py` - Thread-safe deque-based fixed-size ring buffer

## Decisions Made
- **openwakeword pinned to >=0.4**: openwakeword >=0.6 requires tflite-runtime which has no Python 3.13 build. Version 0.4.0 works with ONNX Runtime backend only.
- **Frame accumulation instead of modifying dsnoop config**: The dsnoop slave in /etc/asound.conf uses period_size=256, returning 256-sample chunks. Rather than modifying the Phase 33 ALSA config, added a bytearray accumulator in the capture loop to assemble 512-sample frames. This is safer and decouples capture from ALSA configuration.
- **silero-vad pulled PyTorch**: The plan expected ONNX-only (~50MB), but silero-vad>=5.1 depends on torch (~900MB). This is acceptable for now; the ONNX VAD wrapper in Plan 02 uses onnxruntime directly and doesn't need the silero-vad package at runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pinned openwakeword to >=0.4 for Python 3.13 compatibility**
- **Found during:** Task 1 (dependency installation)
- **Issue:** openwakeword>=0.6 requires tflite-runtime which has no wheel for Python 3.13
- **Fix:** Pinned to >=0.4 in both requirements.txt and pyproject.toml. Version 0.4.0 installs cleanly with ONNX Runtime backend.
- **Files modified:** /root/jarvis-ear/requirements.txt, /root/jarvis-ear/pyproject.toml
- **Verification:** pip install completes, openwakeword 0.4.0 importable
- **Committed in:** e45d63e (Task 1 commit)

**2. [Rule 1 - Bug] Added frame accumulation for correct 512-sample output frames**
- **Found during:** Task 2 (capture verification)
- **Issue:** ALSA reads returned 256-sample chunks (512 bytes) due to dsnoop period_size=256, but downstream VAD expects 512-sample frames (1024 bytes)
- **Fix:** Added bytearray accumulator in _capture_loop that collects ALSA reads and emits frames only when 1024 bytes are available
- **Files modified:** /root/jarvis-ear/src/jarvis_ear/audio.py
- **Verification:** 3-second capture test: 94 frames, all exactly 1024 bytes, 15360-byte pre-roll
- **Committed in:** c60835d (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- silero-vad>=5.1 depends on PyTorch (~900MB download), making the virtual environment larger than expected. The plan anticipated ONNX-only. However, the actual VAD inference in Plan 02 uses onnxruntime directly with the .onnx model file, so torch is only needed as a silero-vad package dependency, not for inference.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Audio capture foundation is complete and verified
- Plan 02 (Silero VAD integration) can consume frames via AudioCapture.get_frame()
- Plan 03 (wake word + state machine) can use AudioCapture.drain_preroll() for pre-roll context
- The vad.py file from a prior attempt already exists in the repo (commit 72aade7) and may need updating to consume frames from AudioCapture

---
*Phase: 34-audio-capture-daemon-core*
*Completed: 2026-02-26*

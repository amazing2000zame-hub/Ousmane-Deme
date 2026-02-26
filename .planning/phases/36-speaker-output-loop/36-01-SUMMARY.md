---
phase: 36-speaker-output-loop
plan: 01
subsystem: audio
tags: [alsa, pyalsaaudio, ffmpeg, tts, speaker, playback, pcm]

# Dependency graph
requires:
  - phase: 33-audio-hardware-foundation
    provides: "ALSA dmix/dsnoop config, pyalsaaudio in venv, Speaker/Master mixer controls"
  - phase: 35-backend-integration
    provides: "BackendClient with Socket.IO TTS chunk/done event handlers"
provides:
  - "AudioPlayer class with ordered playback queue and ALSA output"
  - "BackendClient wiring: voice:tts_chunk -> AudioPlayer.enqueue()"
  - "BackendClient wiring: voice:tts_done -> AudioPlayer.signal_done()"
  - "Speaker and Master switches enabled at daemon startup"
  - "on_playback_done callback hook for conversation mode"
affects: [36-02-speaker-output-loop, 38-service-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ordered playback via PriorityQueue with sequential index tracking"
    - "ffmpeg subprocess pipe for universal audio decode/resample"
    - "Background daemon thread for ALSA write (never blocks main loop)"
    - "ALSA device opened once at init, kept open for daemon lifetime"

key-files:
  created:
    - jarvis-ear/src/jarvis_ear/speaker.py
  modified:
    - jarvis-ear/src/jarvis_ear/config.py
    - jarvis-ear/src/jarvis_ear/backend.py
    - jarvis-ear/src/jarvis_ear/__main__.py

key-decisions:
  - "ffmpeg for audio decoding: handles WAV and Opus uniformly, 5ms overhead acceptable"
  - "Single ALSA device kept open for daemon lifetime (no open/close per chunk)"
  - "amixer subprocess for speaker enable (2ms, no C bindings needed)"

patterns-established:
  - "AudioPlayer.enqueue(index, audio_b64, content_type) as universal TTS chunk entry point"
  - "Sentinel-based playback completion: signal_done(total_chunks) triggers drain + callback"

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 36 Plan 01: Speaker Output Loop Summary

**AudioPlayer class with ordered TTS chunk playback via ffmpeg decode and ALSA dmix at 48kHz stereo, wired from BackendClient Socket.IO events**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T14:46:30Z
- **Completed:** 2026-02-26T14:49:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created AudioPlayer class with background daemon thread, PriorityQueue for ordered chunk playback, ffmpeg decode to 48kHz stereo S16LE, and ALSA write in period-sized chunks
- Wired BackendClient voice:tts_chunk events to AudioPlayer.enqueue() and voice:tts_done to signal_done()
- Speakers enabled at startup (Speaker switch ON, Master ON, volume 60%) via amixer subprocess calls
- AudioPlayer supports on_playback_done callback for Plan 02 conversation mode integration

## Task Commits

Each task was committed atomically:

1. **Task 1: Create AudioPlayer class with ordered playback queue and ALSA output** - `32d73c1` (feat)
2. **Task 2: Wire TTS chunk events from BackendClient to AudioPlayer** - `52a9a5d` (feat)

## Files Created/Modified
- `jarvis-ear/src/jarvis_ear/speaker.py` - AudioPlayer class: ordered queue, background thread, ffmpeg decode, ALSA write, speaker enable
- `jarvis-ear/src/jarvis_ear/config.py` - Added SPEAKER_SAMPLE_RATE, SPEAKER_CHANNELS, SPEAKER_PERIOD_SIZE, SPEAKER_DEVICE, SPEAKER_VOLUME_PCT
- `jarvis-ear/src/jarvis_ear/backend.py` - Added speaker param to BackendClient, route tts_chunk/tts_done to AudioPlayer
- `jarvis-ear/src/jarvis_ear/__main__.py` - Create AudioPlayer before BackendClient, stop in shutdown cleanup

## Decisions Made
- Used ffmpeg subprocess pipe for audio decoding -- handles WAV and Opus uniformly with ~5ms overhead per chunk
- Single ALSA playback device opened at init and kept open for daemon lifetime (no per-chunk overhead)
- amixer subprocess calls for speaker enable at startup (2ms latency, simpler than C mixer API)
- Playback thread is a daemon thread so it does not block process exit

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- AudioPlayer is ready for Plan 02 (mic mute during playback, conversation mode, wake word chime)
- on_playback_done callback is prepared for conversation mode state machine integration
- Speaker hardware verified enabled and functional

## Self-Check: PASSED

All 4 files verified present. Both commits (32d73c1, 52a9a5d) verified in git log.

---
*Phase: 36-speaker-output-loop*
*Completed: 2026-02-26*

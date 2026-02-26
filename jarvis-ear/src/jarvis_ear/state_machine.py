"""Capture state machine with IDLE -> CAPTURING -> IDLE lifecycle.

Manages the full capture lifecycle after wake word detection:
- IDLE: Listening for wake word (VAD -> wake word pipeline active)
- CAPTURING: Recording user command after wake word trigger

Transitions:
- IDLE -> CAPTURING: Wake word detected. Pre-roll buffer drained and
  appended to capture buffer. All subsequent frames appended.
- CAPTURING -> IDLE: 2 seconds of consecutive silence detected (no speech
  frames from VAD). Captured audio is finalized and returned.

The state machine does NOT own the audio capture or VAD -- it receives
events from the main loop and manages transitions.
"""

import enum
import logging
import time

from jarvis_ear.config import SILENCE_TIMEOUT_S

logger = logging.getLogger("jarvis_ear.state_machine")


class State(enum.Enum):
    IDLE = "idle"
    CAPTURING = "capturing"


class CaptureStateMachine:
    """Manages the capture lifecycle: IDLE -> CAPTURING -> IDLE.

    State transitions:
    - IDLE -> CAPTURING: Wake word detected. Pre-roll buffer drained and
      appended to capture buffer. All subsequent speech frames appended.
    - CAPTURING -> IDLE: 2 seconds of consecutive silence detected (no speech
      frames from VAD). Captured audio is finalized and made available.
    """

    def __init__(self, silence_timeout: float = SILENCE_TIMEOUT_S):
        self._state = State.IDLE
        self._silence_timeout = silence_timeout
        self._capture_buffer: list[bytes] = []
        self._last_speech_time: float = 0.0
        self._capture_start_time: float = 0.0

    @property
    def state(self) -> State:
        return self._state

    def on_wake_word(self, preroll: bytes) -> None:
        """Called when wake word is detected.

        Args:
            preroll: Pre-roll audio bytes (500ms before wake word).
        """
        if self._state != State.IDLE:
            logger.warning(
                "Wake word detected while not IDLE (state=%s), ignoring",
                self._state,
            )
            return

        logger.info(">>> WAKE WORD DETECTED -- transitioning IDLE -> CAPTURING")
        self._state = State.CAPTURING
        self._capture_buffer = []
        if preroll:
            self._capture_buffer.append(preroll)
        self._last_speech_time = time.monotonic()
        self._capture_start_time = time.monotonic()

    def on_frame(self, frame: bytes, is_speech: bool) -> bytes | None:
        """Process a frame during CAPTURING state.

        Args:
            frame: Raw PCM audio frame.
            is_speech: Whether VAD classified this frame as speech.

        Returns:
            None if still capturing.
            The complete captured audio (bytes) if silence timeout triggered
            (state transitions back to IDLE).
        """
        if self._state != State.CAPTURING:
            return None

        # Always append the frame (we want silence gaps in the audio too,
        # for natural speech cadence)
        self._capture_buffer.append(frame)

        if is_speech:
            self._last_speech_time = time.monotonic()

        # Check silence timeout
        silence_duration = time.monotonic() - self._last_speech_time
        if silence_duration >= self._silence_timeout:
            # End of utterance detected
            duration = time.monotonic() - self._capture_start_time
            audio = b"".join(self._capture_buffer)
            logger.info(
                "<<< SILENCE TIMEOUT (%.1fs) -- transitioning CAPTURING -> IDLE "
                "(captured %.1fs of audio, %d bytes)",
                silence_duration,
                duration,
                len(audio),
            )
            self._state = State.IDLE
            self._capture_buffer = []
            return audio

        return None

    def reset(self) -> None:
        """Force reset to IDLE state, discarding any in-progress capture."""
        if self._state != State.IDLE:
            logger.info("Force reset from %s -> IDLE", self._state)
        self._state = State.IDLE
        self._capture_buffer = []

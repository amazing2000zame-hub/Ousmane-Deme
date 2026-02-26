"""Capture state machine with IDLE -> CAPTURING -> CONVERSATION lifecycle.

Manages the full capture lifecycle after wake word detection:
- IDLE: Listening for wake word (VAD -> wake word pipeline active)
- CAPTURING: Recording user command after wake word trigger
- CONVERSATION: 15-second follow-up window after TTS playback completes

Transitions:
- IDLE -> CAPTURING: Wake word detected. Pre-roll buffer drained and
  appended to capture buffer. All subsequent frames appended.
- CAPTURING -> IDLE: 2 seconds of consecutive silence detected (no speech
  frames from VAD). Captured audio is finalized and returned.
- IDLE/CAPTURING -> CONVERSATION: TTS playback finishes (on_tts_done).
- CONVERSATION -> CAPTURING: Speech detected during follow-up window.
- CONVERSATION -> IDLE: 15-second timeout expires with no speech.

The state machine does NOT own the audio capture or VAD -- it receives
events from the main loop and manages transitions.
"""

import enum
import logging
import time

from jarvis_ear.config import CONVERSATION_TIMEOUT_S, SILENCE_TIMEOUT_S

logger = logging.getLogger("jarvis_ear.state_machine")


class State(enum.Enum):
    IDLE = "idle"
    CAPTURING = "capturing"
    CONVERSATION = "conversation"


class CaptureStateMachine:
    """Manages the capture lifecycle: IDLE -> CAPTURING -> CONVERSATION -> IDLE.

    State transitions:
    - IDLE -> CAPTURING: Wake word detected. Pre-roll buffer drained and
      appended to capture buffer. All subsequent speech frames appended.
    - CAPTURING -> IDLE: 2 seconds of consecutive silence detected (no speech
      frames from VAD). Captured audio is finalized and made available.
    - IDLE/CAPTURING -> CONVERSATION: TTS playback finishes (on_tts_done).
    - CONVERSATION -> CAPTURING: Speech detected during follow-up window.
    - CONVERSATION -> IDLE: 15-second timeout expires with no speech.
    """

    def __init__(self, silence_timeout: float = SILENCE_TIMEOUT_S):
        self._state = State.IDLE
        self._silence_timeout = silence_timeout
        self._capture_buffer: list[bytes] = []
        self._last_speech_time: float = 0.0
        self._capture_start_time: float = 0.0
        self._conversation_start: float = 0.0

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

    # ------------------------------------------------------------------
    # Conversation mode (Phase 36 Plan 02)
    # ------------------------------------------------------------------

    def on_tts_done(self) -> None:
        """Called when TTS playback finishes. Transitions to CONVERSATION.

        Opens a 15-second follow-up window where the user can ask another
        question without repeating the wake word.
        """
        if self._state not in (State.IDLE, State.CAPTURING):
            logger.debug(
                "on_tts_done while state=%s, transitioning to CONVERSATION anyway",
                self._state,
            )
        logger.info(
            "TTS playback done -- transitioning %s -> CONVERSATION (%.0fs window)",
            self._state.value,
            CONVERSATION_TIMEOUT_S,
        )
        self._state = State.CONVERSATION
        self._conversation_start = time.monotonic()

    def check_conversation_timeout(self) -> bool:
        """Check if the conversation follow-up window has expired.

        Returns:
            True if expired (state transitioned to IDLE), False otherwise.
        """
        if self._state != State.CONVERSATION:
            return False

        if time.monotonic() - self._conversation_start >= CONVERSATION_TIMEOUT_S:
            logger.info("Conversation window expired, returning to IDLE")
            self._state = State.IDLE
            return True

        return False

    def on_conversation_speech(self) -> None:
        """Called when VAD detects speech during the CONVERSATION window.

        Transitions to CAPTURING to start recording the follow-up question
        without requiring a wake word.
        """
        if self._state != State.CONVERSATION:
            logger.warning(
                "on_conversation_speech called in state=%s, ignoring",
                self._state,
            )
            return

        logger.info("Follow-up speech detected in conversation mode")
        self._state = State.CAPTURING
        self._capture_buffer = []
        self._last_speech_time = time.monotonic()
        self._capture_start_time = time.monotonic()

    # ------------------------------------------------------------------
    # Reset
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Force reset to IDLE state, discarding any in-progress capture."""
        if self._state != State.IDLE:
            logger.info("Force reset from %s -> IDLE", self._state)
        self._state = State.IDLE
        self._capture_buffer = []
        self._conversation_start = 0.0

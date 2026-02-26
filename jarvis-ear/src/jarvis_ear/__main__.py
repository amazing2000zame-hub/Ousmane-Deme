"""jarvis-ear: Always-on voice capture daemon for Jarvis.

Usage: python -m jarvis_ear

Two-stage audio pipeline:
1. AudioCapture reads 32ms frames from ALSA (512 samples at 16kHz)
2. Every frame goes through Silero VAD
3. Only speech frames go to WakeWordDetector (saves CPU)
4. When wake word fires, StateMachine transitions to CAPTURING
5. During CAPTURING, all frames (speech + silence) are buffered
6. After 2s silence, captured audio is sent to backend via Socket.IO
"""

import logging
import signal
import sys
import time

from jarvis_ear.audio import AudioCapture
from jarvis_ear.backend import BackendClient
from jarvis_ear.config import CHANNELS, SAMPLE_RATE, SAMPLE_WIDTH, VAD_THRESHOLD
from jarvis_ear.state_machine import CaptureStateMachine, State
from jarvis_ear.vad import VoiceActivityDetector
from jarvis_ear.wakeword import WakeWordDetector

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("jarvis_ear")


def main() -> None:
    """Main daemon entry point."""
    logger.info("=== jarvis-ear starting ===")
    logger.info(
        "Audio: %d Hz, %d-bit, %d channel(s)",
        SAMPLE_RATE,
        SAMPLE_WIDTH * 8,
        CHANNELS,
    )

    # Initialize components
    logger.info("Loading VAD model...")
    vad = VoiceActivityDetector(threshold=VAD_THRESHOLD)
    logger.info("VAD loaded (Silero ONNX)")

    logger.info("Loading wake word model...")
    wakeword = WakeWordDetector(threshold=0.5)
    logger.info("Wake word loaded (openWakeWord hey_jarvis)")

    state_machine = CaptureStateMachine()
    logger.info("State machine initialized (IDLE)")

    # Start audio capture
    capture = AudioCapture()
    capture.start()
    logger.info("Audio capture started")

    # Connect to backend (non-blocking -- daemon works without backend)
    logger.info("Connecting to backend...")
    backend = BackendClient()
    if backend.connect():
        logger.info("Backend connected")
    else:
        logger.warning("Backend not available -- will reconnect automatically")

    # Handle graceful shutdown
    shutdown = False

    def handle_signal(signum, _frame):
        nonlocal shutdown
        logger.info("Received signal %d, shutting down...", signum)
        shutdown = True

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    # Stats for periodic logging
    total_frames = 0
    speech_frames = 0
    wake_detections = 0
    captures_completed = 0
    last_stats_time = time.monotonic()
    STATS_INTERVAL = 30.0  # Log stats every 30 seconds

    logger.info("=== Listening for 'Hey Jarvis' ===")

    try:
        while not shutdown:
            frame = capture.get_frame(timeout=0.1)
            if frame is None:
                continue

            total_frames += 1
            is_speech = vad.is_speech(frame)
            if is_speech:
                speech_frames += 1

            if state_machine.state == State.IDLE:
                # Two-stage pipeline: only run wake word on speech frames
                if is_speech:
                    detected = wakeword.detect(frame)
                    if detected:
                        wake_detections += 1
                        logger.info(
                            "Wake word detected! Draining pre-roll buffer..."
                        )
                        preroll = capture.drain_preroll()
                        state_machine.on_wake_word(preroll)
                        wakeword.reset()
                        vad.reset()

            elif state_machine.state == State.CAPTURING:
                captured_audio = state_machine.on_frame(frame, is_speech)
                if captured_audio is not None:
                    # Capture complete -- audio is ready for processing
                    duration_s = len(captured_audio) / (
                        SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS
                    )
                    captures_completed += 1
                    logger.info(
                        "Capture #%d complete: %.1fs of audio (%d bytes)",
                        captures_completed,
                        duration_s,
                        len(captured_audio),
                    )
                    backend.send_audio(captured_audio)
                    vad.reset()

            # Periodic stats
            now = time.monotonic()
            if now - last_stats_time >= STATS_INTERVAL:
                elapsed = now - last_stats_time
                fps = total_frames / elapsed if elapsed > 0 else 0
                speech_pct = (
                    (speech_frames / total_frames * 100)
                    if total_frames > 0
                    else 0
                )
                logger.info(
                    "Stats: %.0f fps, %.1f%% speech, %d wakes, %d captures (last %ds)",
                    fps,
                    speech_pct,
                    wake_detections,
                    captures_completed,
                    int(elapsed),
                )
                total_frames = 0
                speech_frames = 0
                last_stats_time = now

    except Exception as e:
        logger.error("Fatal error in main loop: %s", e, exc_info=True)
        sys.exit(1)
    finally:
        logger.info("Disconnecting from backend...")
        backend.disconnect()
        logger.info("Stopping audio capture...")
        capture.stop()
        logger.info("=== jarvis-ear stopped ===")


if __name__ == "__main__":
    main()

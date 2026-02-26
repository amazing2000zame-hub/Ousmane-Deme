"""Continuous ALSA audio capture in a background thread.

Reads 32ms frames (512 samples at 16kHz, 16-bit mono) from the default
ALSA device (plug -> dsnoop -> hw:sofhdadsp,7) and deposits them into:
1. A ring buffer (for pre-roll before wake word)
2. A queue.Queue (for downstream VAD/wake word processing)

Note: The dsnoop slave has period_size=256, so ALSA reads return 256-sample
chunks. This module accumulates reads into 512-sample frames (1024 bytes)
to match Silero VAD's expected input size.
"""

import logging
import queue
import threading

import alsaaudio

from jarvis_ear import config
from jarvis_ear.ring_buffer import RingBuffer

logger = logging.getLogger(__name__)

# Target frame size in bytes: 512 samples * 2 bytes/sample (16-bit) * 1 channel
_TARGET_FRAME_BYTES = config.FRAME_SIZE * config.SAMPLE_WIDTH * config.CHANNELS


class AudioCapture:
    """Continuous ALSA audio capture in a background thread.

    Opens the default ALSA device in blocking mode and reads PCM frames
    continuously. Each output frame is 512 samples (32ms at 16kHz, 16-bit
    mono = 1024 bytes). ALSA reads may return smaller chunks due to the
    dsnoop period size, so reads are accumulated to form complete frames.
    Frames are deposited into both a ring buffer (pre-roll) and a queue
    (downstream processing).
    """

    def __init__(self) -> None:
        """Initialize ALSA capture device, ring buffer, and frame queue."""
        # Open ALSA capture device in blocking mode
        self._pcm = alsaaudio.PCM(
            type=alsaaudio.PCM_CAPTURE,
            mode=alsaaudio.PCM_NORMAL,
            device=config.ALSA_DEVICE,
            rate=config.SAMPLE_RATE,
            channels=config.CHANNELS,
            format=alsaaudio.PCM_FORMAT_S16_LE,
            periodsize=config.ALSA_PERIOD_SIZE,
            periods=config.ALSA_PERIODS,
        )

        # Pre-roll ring buffer: stores last 500ms of audio (15 frames)
        self._ring_buffer = RingBuffer(max_frames=config.PREROLL_FRAMES)

        # Frame delivery queue: downstream consumers call get_frame()
        # maxsize=100 -> 100 * 32ms = ~3.2 seconds buffer
        self._queue: queue.Queue[bytes] = queue.Queue(maxsize=100)

        # Thread control
        self._stop_event = threading.Event()
        self._thread = threading.Thread(
            target=self._capture_loop,
            name="jarvis-ear-capture",
            daemon=True,
        )

        self._started = False

    def start(self) -> None:
        """Start the capture thread."""
        if self._started:
            logger.warning("AudioCapture already started")
            return
        self._stop_event.clear()
        self._thread.start()
        self._started = True
        logger.info(
            "Audio capture started: device=%s rate=%d channels=%d "
            "periodsize=%d periods=%d",
            config.ALSA_DEVICE,
            config.SAMPLE_RATE,
            config.CHANNELS,
            config.ALSA_PERIOD_SIZE,
            config.ALSA_PERIODS,
        )

    def stop(self) -> None:
        """Signal the capture thread to stop and wait for it to finish."""
        if not self._started:
            return
        self._stop_event.set()
        self._thread.join(timeout=2.0)
        if self._thread.is_alive():
            logger.warning("Capture thread did not stop within 2 seconds")
        self._started = False
        logger.info("Audio capture stopped")

    def get_frame(self, timeout: float = 0.1) -> bytes | None:
        """Get next audio frame from the queue.

        Args:
            timeout: Maximum seconds to wait for a frame.

        Returns:
            Raw PCM frame as bytes, or None if timeout expired.
        """
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def drain_preroll(self) -> bytes:
        """Drain the pre-roll ring buffer.

        Returns:
            All buffered pre-roll frames concatenated as a single bytes object.
        """
        return self._ring_buffer.drain()

    def _capture_loop(self) -> None:
        """Main capture loop running in background thread.

        Reads from ALSA in blocking mode and accumulates data into
        512-sample frames (1024 bytes). The dsnoop period_size is 256,
        so typically 2 ALSA reads are needed per output frame.

        Each complete frame:
        1. Is appended to ring buffer (pre-roll)
        2. Is put in queue for downstream processing

        If queue is full (downstream too slow), logs a warning and drops
        the frame from the queue but still updates the ring buffer.

        On ALSA errors (xrun/overrun), logs a warning and continues.
        """
        logger.info("Capture loop started (target frame: %d bytes)", _TARGET_FRAME_BYTES)
        overrun_count = 0
        drop_count = 0
        accumulator = bytearray()

        while not self._stop_event.is_set():
            try:
                length, data = self._pcm.read()
            except alsaaudio.ALSAAudioError as exc:
                logger.error("ALSA read error: %s", exc)
                if self._stop_event.is_set():
                    break
                continue

            if length < 0:
                # Negative length indicates an error (e.g., -32 = EPIPE overrun)
                overrun_count += 1
                if overrun_count % 100 == 1:
                    logger.warning(
                        "ALSA overrun (error code %d), total overruns: %d",
                        length,
                        overrun_count,
                    )
                continue

            if length == 0:
                # Zero-length read: underrun or no data
                continue

            # Accumulate raw bytes until we have a complete frame
            accumulator.extend(data)

            # Emit complete frames (may emit multiple if ALSA returned a large chunk)
            while len(accumulator) >= _TARGET_FRAME_BYTES:
                frame = bytes(accumulator[:_TARGET_FRAME_BYTES])
                del accumulator[:_TARGET_FRAME_BYTES]

                # Always update ring buffer (pre-roll must stay current)
                self._ring_buffer.append(frame)

                # Deliver to downstream queue
                try:
                    self._queue.put_nowait(frame)
                except queue.Full:
                    drop_count += 1
                    if drop_count % 100 == 1:
                        logger.warning(
                            "Frame queue full, dropped frame (total drops: %d)",
                            drop_count,
                        )

        logger.info(
            "Capture loop exited: overruns=%d drops=%d",
            overrun_count,
            drop_count,
        )

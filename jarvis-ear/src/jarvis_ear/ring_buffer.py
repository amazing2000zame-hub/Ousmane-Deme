"""Fixed-size ring buffer for pre-roll audio storage.

Stores the N most recent audio frames (bytes objects) for pre-roll
buffering before wake word detection. Thread-safe for single-producer
single-consumer use (ALSA capture thread writes, wake word reader drains).
"""

import threading
from collections import deque


class RingBuffer:
    """Fixed-size ring buffer storing the N most recent audio frames.

    Uses collections.deque(maxlen=N) internally for O(1) append with
    automatic eviction of the oldest entry when full. A threading.Lock
    ensures safety across Python implementations beyond CPython's GIL.
    """

    def __init__(self, max_frames: int) -> None:
        """Initialize ring buffer with capacity for max_frames.

        Args:
            max_frames: Maximum number of frames to store. When full,
                        appending a new frame evicts the oldest.
        """
        self._buffer: deque[bytes] = deque(maxlen=max_frames)
        self._lock = threading.Lock()

    def append(self, frame: bytes) -> None:
        """Add a frame, evicting the oldest if full.

        Args:
            frame: Raw PCM audio frame as bytes.
        """
        with self._lock:
            self._buffer.append(frame)

    def drain(self) -> bytes:
        """Return all buffered frames concatenated and clear the buffer.

        Returns:
            All buffered frames joined as a single bytes object.
            Returns empty bytes if buffer is empty.
        """
        with self._lock:
            if not self._buffer:
                return b""
            data = b"".join(self._buffer)
            self._buffer.clear()
            return data

    def clear(self) -> None:
        """Discard all buffered frames."""
        with self._lock:
            self._buffer.clear()

    def __len__(self) -> int:
        """Number of frames currently buffered."""
        with self._lock:
            return len(self._buffer)

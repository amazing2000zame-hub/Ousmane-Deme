"""AudioPlayer: Ordered TTS chunk playback through ALSA speakers.

Receives base64-encoded TTS audio chunks from the backend, decodes them
via ffmpeg to raw PCM (48kHz stereo S16LE), and writes to the ALSA dmix
playback device.  Chunks are buffered and played in sequential index order
to handle out-of-order delivery.

Features (Phase 36 Plan 02):
- Mic mute during playback to prevent echo/self-trigger
- Wake word chime (ascending two-tone C5+E5)
- Safety timeout to force unmute if mic stuck muted >60s

Phase 36 -- Speaker Output Loop.
"""

from __future__ import annotations

import base64
import logging
import math
import queue
import struct
import subprocess
import threading
import time
from typing import Callable

import alsaaudio

from jarvis_ear.config import (
    CHIME_AMPLITUDE,
    CHIME_FREQUENCIES,
    CHIME_GAP_DURATION_S,
    CHIME_TONE_DURATION_S,
    MIC_MUTE_SAFETY_TIMEOUT_S,
    SPEAKER_CHANNELS,
    SPEAKER_DEVICE,
    SPEAKER_PERIOD_SIZE,
    SPEAKER_SAMPLE_RATE,
    SPEAKER_VOLUME_PCT,
)

logger = logging.getLogger("jarvis_ear.speaker")

# Bytes per ALSA period: period_size frames * channels * 2 bytes (S16LE)
_PERIOD_BYTES = SPEAKER_PERIOD_SIZE * SPEAKER_CHANNELS * 2


class AudioPlayer:
    """Ordered TTS audio playback through ALSA speakers.

    Opens a single ALSA playback device at init and keeps it open for the
    daemon's lifetime.  A background daemon thread consumes chunks from an
    ordered priority queue, decodes via ffmpeg, and writes raw PCM to ALSA.

    Mic mute/unmute ensures the DMIC is silenced during playback to prevent
    echo and spurious wake word detections.
    """

    def __init__(
        self,
        on_playback_done: Callable[[], None] | None = None,
    ) -> None:
        self._on_playback_done = on_playback_done
        self._queue: queue.PriorityQueue = queue.PriorityQueue()
        self._playing = threading.Event()
        self._stop_event = threading.Event()

        # Mic mute tracking
        self._mic_muted_at: float | None = None

        # Pre-generate wake word chime PCM
        self._chime_pcm: bytes = self._generate_chime()

        # Open ALSA playback device (kept open for daemon lifetime)
        self._pcm = alsaaudio.PCM(
            type=alsaaudio.PCM_PLAYBACK,
            mode=alsaaudio.PCM_NORMAL,
            device=SPEAKER_DEVICE,
            rate=SPEAKER_SAMPLE_RATE,
            channels=SPEAKER_CHANNELS,
            format=alsaaudio.PCM_FORMAT_S16_LE,
            periodsize=SPEAKER_PERIOD_SIZE,
        )
        logger.info(
            "ALSA playback device opened: %s @ %dHz, %dch, period=%d",
            SPEAKER_DEVICE,
            SPEAKER_SAMPLE_RATE,
            SPEAKER_CHANNELS,
            SPEAKER_PERIOD_SIZE,
        )

        # Enable built-in speakers (Speaker switch + Master)
        self._enable_speakers()

        # Start background playback thread
        self._thread = threading.Thread(
            target=self._playback_loop,
            name="jarvis-ear-speaker",
            daemon=True,
        )
        self._thread.start()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def enqueue(self, index: int, audio_b64: str, content_type: str) -> None:
        """Add a TTS chunk to the ordered playback queue.

        Args:
            index: Sequential chunk index (0-based).
            audio_b64: Base64-encoded audio data.
            content_type: MIME type (e.g. "audio/wav", "audio/ogg").
        """
        audio_bytes = base64.b64decode(audio_b64)
        self._queue.put((index, audio_bytes, content_type))
        logger.debug("Enqueued TTS chunk #%d (%d bytes, %s)", index, len(audio_bytes), content_type)

    def signal_done(self, total_chunks: int) -> None:
        """Signal that all TTS chunks have been enqueued.

        Places a sentinel in the queue so the playback loop knows when
        playback is complete (after draining all real chunks).
        """
        self._queue.put((total_chunks, b"", "sentinel"))
        logger.debug("Sentinel enqueued (total_chunks=%d)", total_chunks)

    @property
    def is_playing(self) -> bool:
        """Whether audio is currently being played."""
        return self._playing.is_set()

    def play_chime(self) -> None:
        """Play the wake word detection chime synchronously.

        The chime is ~350ms (two ascending tones) and plays while the mic
        is still open.  The chime frequencies (C5+E5) are non-speech and
        will not trigger the wake word model.
        """
        logger.debug("Playing wake word chime")
        self._write_pcm(self._chime_pcm)

    def stop(self) -> None:
        """Stop the playback thread and close the ALSA device.

        Ensures the mic is unmuted if it was muted during playback.
        """
        self._stop_event.set()

        # Safety: guarantee mic is never left muted on shutdown
        if self._mic_muted_at is not None:
            self._unmute_mic()

        self._thread.join(timeout=2)

        try:
            self._pcm.close()
        except Exception:
            pass

        logger.info("AudioPlayer stopped")

    # ------------------------------------------------------------------
    # Speaker enable
    # ------------------------------------------------------------------

    def _enable_speakers(self) -> None:
        """Turn on Speaker and Master switches at startup."""
        cmds = [
            ["amixer", "-c", "1", "sset", "Speaker", "on"],
            ["amixer", "-c", "1", "sset", "Master", "on"],
            ["amixer", "-c", "1", "sset", "Master", f"{SPEAKER_VOLUME_PCT}%"],
        ]
        for cmd in cmds:
            try:
                subprocess.run(cmd, capture_output=True, check=False)
            except Exception as exc:
                logger.warning("Failed to run %s: %s", " ".join(cmd), exc)
        logger.info(
            "Speakers enabled (Speaker=on, Master=on, volume=%d%%)",
            SPEAKER_VOLUME_PCT,
        )

    # ------------------------------------------------------------------
    # Mic mute / unmute (echo prevention)
    # ------------------------------------------------------------------

    def _mute_mic(self) -> None:
        """Mute the DMIC to prevent echo during TTS playback."""
        try:
            subprocess.run(
                ["amixer", "-c", "1", "sset", "Dmic0", "nocap"],
                capture_output=True,
                check=False,
            )
        except Exception as exc:
            logger.warning("Failed to mute mic: %s", exc)
        self._mic_muted_at = time.monotonic()
        logger.info("Mic muted for playback")

    def _unmute_mic(self) -> None:
        """Unmute the DMIC after TTS playback completes."""
        try:
            subprocess.run(
                ["amixer", "-c", "1", "sset", "Dmic0", "cap"],
                capture_output=True,
                check=False,
            )
        except Exception as exc:
            logger.warning("Failed to unmute mic: %s", exc)
        self._mic_muted_at = None
        logger.info("Mic unmuted")

    # ------------------------------------------------------------------
    # Chime generation
    # ------------------------------------------------------------------

    @staticmethod
    def _generate_chime() -> bytes:
        """Generate a two-tone ascending chime as raw PCM.

        Output: 48kHz stereo S16LE bytes.  Two tones (C5=523Hz, E5=659Hz)
        each 150ms long with a 50ms silence gap.  Envelope applied to
        avoid clicks (25ms fade-in/out).

        Returns:
            Raw PCM bytes for the complete chime (~350ms).
        """
        rate = SPEAKER_SAMPLE_RATE
        amplitude = CHIME_AMPLITUDE
        tone_dur = CHIME_TONE_DURATION_S
        gap_dur = CHIME_GAP_DURATION_S
        freqs = CHIME_FREQUENCIES

        pcm_parts: list[bytes] = []

        for freq in freqs:
            num_samples = int(rate * tone_dur)
            tone_bytes = bytearray()
            for i in range(num_samples):
                t = i / rate
                # Envelope: 25ms fade-in, 25ms fade-out
                env = min(t * 40.0, 1.0) * min((tone_dur - t) * 40.0, 1.0)
                val = int(amplitude * env * math.sin(2.0 * math.pi * freq * t))
                # Clamp to int16 range
                val = max(-32768, min(32767, val))
                sample = struct.pack("<h", val)
                # Duplicate for stereo (left + right)
                tone_bytes.extend(sample)
                tone_bytes.extend(sample)
            pcm_parts.append(bytes(tone_bytes))

            # Add silence gap between tones (not after the last tone)
            if freq != freqs[-1]:
                gap_samples = int(rate * gap_dur)
                pcm_parts.append(b"\x00" * (gap_samples * 2 * 2))  # stereo, 2 bytes/sample

        chime = b"".join(pcm_parts)
        logger.debug(
            "Chime generated: %d bytes (~%dms)",
            len(chime),
            int(len(chime) / (rate * 2 * 2) * 1000),
        )
        return chime

    # ------------------------------------------------------------------
    # Playback loop (runs in background daemon thread)
    # ------------------------------------------------------------------

    def _playback_loop(self) -> None:
        """Consume chunks from the priority queue and play in order.

        Mutes the mic when the first chunk starts playing and unmutes
        when playback completes (sentinel received).  A safety timeout
        forces unmute if the mic stays muted longer than 60 seconds.
        """
        next_index = 0
        pending: dict[int, tuple[bytes, str]] = {}

        while not self._stop_event.is_set():
            # Safety: force unmute if mic stuck muted too long
            if (
                self._mic_muted_at is not None
                and time.monotonic() - self._mic_muted_at > MIC_MUTE_SAFETY_TIMEOUT_S
            ):
                logger.warning(
                    "Mic muted for >%.0fs -- force unmuting (safety timeout)",
                    MIC_MUTE_SAFETY_TIMEOUT_S,
                )
                self._unmute_mic()

            # Block on queue with short timeout so we can check _stop_event
            try:
                item = self._queue.get(timeout=0.1)
            except queue.Empty:
                continue

            idx, audio_bytes, content_type = item

            # Sentinel: all chunks for this utterance have been played
            if content_type == "sentinel":
                try:
                    self._pcm.drain()
                except Exception as exc:
                    logger.warning("ALSA drain error: %s", exc)

                # Always unmute mic after playback, even on error
                try:
                    if self._mic_muted_at is not None:
                        self._unmute_mic()
                finally:
                    self._playing.clear()
                    next_index = 0
                    pending.clear()
                    logger.info("Playback complete, draining ALSA buffer")
                    if self._on_playback_done is not None:
                        try:
                            self._on_playback_done()
                        except Exception as exc:
                            logger.warning("on_playback_done callback error: %s", exc)
                continue

            # Buffer chunk (may be out of order)
            pending[idx] = (audio_bytes, content_type)

            # First chunk: mute mic and set playing state
            if idx == 0:
                self._mute_mic()
                self._playing.set()

            # Play all sequential chunks available
            while next_index in pending:
                chunk_audio, chunk_ct = pending.pop(next_index)
                pcm_data = self._decode_to_pcm(chunk_audio, chunk_ct)
                if pcm_data:
                    self._write_pcm(pcm_data)
                next_index += 1

    # ------------------------------------------------------------------
    # Audio decoding
    # ------------------------------------------------------------------

    def _decode_to_pcm(self, audio_bytes: bytes, content_type: str) -> bytes:
        """Decode audio to raw PCM (48kHz stereo S16LE) via ffmpeg.

        Handles WAV, Opus, and any other format ffmpeg supports.
        Returns empty bytes on decode failure.
        """
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel", "error",
                    "-i", "pipe:0",
                    "-f", "s16le",
                    "-ar", str(SPEAKER_SAMPLE_RATE),
                    "-ac", str(SPEAKER_CHANNELS),
                    "pipe:1",
                ],
                input=audio_bytes,
                capture_output=True,
            )
            if result.returncode != 0:
                logger.warning(
                    "ffmpeg decode failed (rc=%d): %s",
                    result.returncode,
                    result.stderr.decode(errors="replace").strip(),
                )
                return b""
            return result.stdout
        except Exception as exc:
            logger.warning("ffmpeg subprocess error: %s", exc)
            return b""

    # ------------------------------------------------------------------
    # ALSA write
    # ------------------------------------------------------------------

    def _write_pcm(self, pcm_data: bytes) -> None:
        """Write raw PCM to ALSA in period-sized chunks.

        Pads the final chunk with silence (zeros) if shorter than a
        full period to avoid ALSA underruns.
        """
        offset = 0
        while offset < len(pcm_data):
            chunk = pcm_data[offset : offset + _PERIOD_BYTES]
            if len(chunk) < _PERIOD_BYTES:
                chunk += b"\x00" * (_PERIOD_BYTES - len(chunk))
            try:
                self._pcm.write(chunk)
            except Exception as exc:
                logger.warning("ALSA write error: %s", exc)
            offset += _PERIOD_BYTES

"""Silero VAD wrapper for per-frame speech detection.

Uses ONNX Runtime directly (no PyTorch dependency, ~50MB vs ~2GB).
Designed for the two-stage pipeline: VAD gates wake word to save CPU.

Silero VAD expects 512 samples at 16kHz (32ms frames) for streaming mode.
"""

import logging
from pathlib import Path

import numpy as np
import onnxruntime as ort

from jarvis_ear.config import SAMPLE_RATE, FRAME_SIZE

logger = logging.getLogger(__name__)

# Expected frame size in bytes (16-bit PCM = 2 bytes per sample)
_EXPECTED_BYTES = FRAME_SIZE * 2  # 512 * 2 = 1024 bytes

# Default model path: <project_root>/models/silero_vad.onnx
_DEFAULT_MODEL_PATH = Path(__file__).parent.parent.parent / "models" / "silero_vad.onnx"

# High-pass filter cutoff for DMIC noise removal.
# Intel HDA DMICs produce massive low-frequency hum (~80Hz) that drowns
# out speech energy and makes VAD ineffective. A 2nd-order Butterworth
# high-pass at 85Hz removes this while preserving speech (100Hz+).
_HPF_CUTOFF_HZ = 85


def _design_highpass(cutoff_hz: float, sample_rate: int) -> tuple:
    """Design a 2nd-order Butterworth high-pass filter (biquad coefficients).

    Returns (b, a) coefficient arrays for use with lfilter.
    Implemented directly to avoid scipy dependency.
    """
    # Bilinear transform: pre-warp analog frequency
    omega = 2.0 * np.pi * cutoff_hz / sample_rate
    omega_w = np.tan(omega / 2.0)
    omega_w2 = omega_w * omega_w

    # 2nd-order Butterworth high-pass coefficients
    sqrt2 = np.sqrt(2.0)
    norm = 1.0 / (1.0 + sqrt2 * omega_w + omega_w2)

    b0 = norm
    b1 = -2.0 * norm
    b2 = norm
    a1 = 2.0 * (omega_w2 - 1.0) * norm
    a2 = (1.0 - sqrt2 * omega_w + omega_w2) * norm

    return np.array([b0, b1, b2], dtype=np.float32), np.array([1.0, a1, a2], dtype=np.float32)


class VoiceActivityDetector:
    """Silero VAD wrapper for per-frame speech detection.

    Loads the Silero VAD ONNX model and provides streaming speech probability.
    The model is stateful -- it uses hidden states from previous frames for
    temporal context. Call reset() between separate utterances.

    Usage:
        vad = VoiceActivityDetector(threshold=0.5)
        is_speech = vad.is_speech(frame_bytes)  # True/False
        prob = vad.get_probability(frame_bytes)  # 0.0 - 1.0
        vad.reset()  # Between utterances
    """

    def __init__(
        self,
        threshold: float = 0.5,
        model_path: str | None = None,
    ) -> None:
        """Initialize VAD with Silero ONNX model.

        Args:
            threshold: Speech probability threshold. Frames with
                P(speech) >= threshold are classified as speech.
                Default 0.5 is Silero's recommendation.
                Lower (0.3) = more sensitive (fewer missed detections).
                Higher (0.7) = fewer false positives.
            model_path: Path to silero_vad.onnx file. If None, uses
                <project_root>/models/silero_vad.onnx.

        Raises:
            FileNotFoundError: If the ONNX model file does not exist.
            RuntimeError: If ONNX Runtime fails to load the model.
        """
        if model_path is None:
            resolved = _DEFAULT_MODEL_PATH
        else:
            resolved = Path(model_path)

        if not resolved.exists():
            raise FileNotFoundError(
                f"Silero VAD model not found at {resolved}. "
                "Download it with: wget -O models/silero_vad.onnx "
                "https://github.com/snakers4/silero-vad/raw/master/"
                "src/silero_vad/data/silero_vad.onnx"
            )

        # ONNX Runtime session with CPU execution provider
        # Limit to 1 thread to avoid 150%+ CPU from default thread pool
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self._session = ort.InferenceSession(
            str(resolved),
            sess_options=opts,
            providers=["CPUExecutionProvider"],
        )
        self._threshold = threshold

        # Silero VAD hidden state: shape (2, 1, 128) float32
        # Persists across frames for temporal context
        self._state = np.zeros((2, 1, 128), dtype=np.float32)

        # Context window: Silero VAD prepends 64 samples (at 16kHz) from
        # the previous frame to provide overlap context for the model.
        # Without this, the model outputs near-zero probabilities.
        self._context_size = 64 if SAMPLE_RATE == 16000 else 32
        self._context = np.zeros((1, self._context_size), dtype=np.float32)

        # Sample rate as int64 scalar (Silero model input)
        self._sr = np.array(SAMPLE_RATE, dtype=np.int64)

        # High-pass filter to remove DMIC low-frequency hum (~80Hz).
        # Without this, 93%+ of signal energy is sub-100Hz noise that
        # prevents Silero VAD from detecting speech.
        self._hpf_b, self._hpf_a = _design_highpass(_HPF_CUTOFF_HZ, SAMPLE_RATE)
        # Direct Form II Transposed filter state
        self._hpf_w = np.zeros(2, dtype=np.float64)

        logger.info(
            "VAD loaded: model=%s, threshold=%.2f, frame=%d samples (%d ms)",
            resolved.name,
            threshold,
            FRAME_SIZE,
            FRAME_SIZE * 1000 // SAMPLE_RATE,
        )

    @property
    def threshold(self) -> float:
        """Current speech probability threshold."""
        return self._threshold

    @threshold.setter
    def threshold(self, value: float) -> None:
        """Set speech probability threshold (0.0 - 1.0)."""
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"Threshold must be in [0.0, 1.0], got {value}")
        self._threshold = value

    def is_speech(self, frame: bytes) -> bool:
        """Classify a single audio frame as speech or silence.

        Args:
            frame: Raw PCM bytes (16-bit signed little-endian, mono, 16kHz).
                Must be exactly 512 samples = 1024 bytes.

        Returns:
            True if speech probability >= threshold.

        Raises:
            ValueError: If frame is not exactly 1024 bytes.
        """
        return self.get_probability(frame) >= self._threshold

    def get_probability(self, frame: bytes) -> float:
        """Get raw speech probability for a frame.

        Useful for logging, debugging, or custom thresholding logic.

        Args:
            frame: Raw PCM bytes (16-bit signed little-endian, mono, 16kHz).
                Must be exactly 512 samples = 1024 bytes.

        Returns:
            Float in [0.0, 1.0] representing speech probability.

        Raises:
            ValueError: If frame is not exactly 1024 bytes.
        """
        if len(frame) != _EXPECTED_BYTES:
            raise ValueError(
                f"Frame must be exactly {_EXPECTED_BYTES} bytes "
                f"({FRAME_SIZE} samples x 2 bytes), got {len(frame)} bytes"
            )

        # Convert raw PCM int16 -> float32 normalized to [-1.0, 1.0]
        audio_int16 = np.frombuffer(frame, dtype=np.int16)
        audio_float32 = audio_int16.astype(np.float32) / 32768.0

        # Apply high-pass filter (Direct Form II Transposed) to remove
        # DMIC low-frequency hum. Without this, VAD cannot detect speech.
        b, a = self._hpf_b, self._hpf_a
        w0, w1 = self._hpf_w[0], self._hpf_w[1]
        filtered = np.empty_like(audio_float32)
        for i in range(len(audio_float32)):
            x = float(audio_float32[i])
            y = b[0] * x + w0
            w0 = b[1] * x - a[1] * y + w1
            w1 = b[2] * x - a[2] * y
            filtered[i] = y
        self._hpf_w[0] = w0
        self._hpf_w[1] = w1

        # Reshape to batch format: (1, num_samples)
        audio_input = filtered.reshape(1, -1)

        # Prepend context window (64 samples at 16kHz) from previous frame.
        # Silero VAD requires this overlap for accurate detection.
        audio_with_context = np.concatenate([self._context, audio_input], axis=1)

        # Save last context_size samples for next frame
        self._context = audio_input[:, -self._context_size:]

        # Run ONNX inference
        ort_inputs = {
            "input": audio_with_context,
            "state": self._state,
            "sr": self._sr,
        }
        output, state_new = self._session.run(None, ort_inputs)

        # Update hidden state for next frame (temporal context)
        self._state = state_new

        return float(output[0][0])

    def reset(self) -> None:
        """Reset VAD internal state.

        Silero VAD is stateful -- it uses hidden states from previous
        frames for temporal context. Call this between separate
        utterances to avoid state leakage.
        """
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, self._context_size), dtype=np.float32)
        self._hpf_w = np.zeros(2, dtype=np.float64)
        logger.debug("VAD state reset")

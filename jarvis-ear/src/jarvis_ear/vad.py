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
        self._session = ort.InferenceSession(
            str(resolved),
            providers=["CPUExecutionProvider"],
        )
        self._threshold = threshold

        # Silero VAD hidden state: shape (2, 1, 128) float32
        # Persists across frames for temporal context
        self._state = np.zeros((2, 1, 128), dtype=np.float32)

        # Sample rate as int64 scalar (Silero model input)
        self._sr = np.array(SAMPLE_RATE, dtype=np.int64)

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

        # Reshape to batch format: (1, num_samples)
        audio_input = audio_float32.reshape(1, -1)

        # Run ONNX inference
        ort_inputs = {
            "input": audio_input,
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
        logger.debug("VAD state reset")

"""openWakeWord wrapper for 'hey_jarvis' wake word detection.

Uses the pre-trained hey_jarvis ONNX model from the openwakeword package.
Processes audio frames and returns True when "Hey Jarvis" is detected
with sufficient confidence.

openWakeWord internally computes mel-spectrograms and speech embeddings,
accumulating audio and producing predictions every ~1280 samples (80ms).
We feed it 512-sample frames (32ms) from the capture loop; it handles
internal buffering.
"""

import logging

import numpy as np
import openwakeword
from openwakeword import Model as OwwModel

logger = logging.getLogger(__name__)


class WakeWordDetector:
    """openWakeWord wrapper for 'hey_jarvis' wake word detection.

    Processes audio frames and returns True when "Hey Jarvis" is detected
    with sufficient confidence.
    """

    def __init__(self, threshold: float = 0.5):
        """Initialize the wake word detector.

        Args:
            threshold: Detection confidence threshold [0.0, 1.0].
                       Default 0.5 is a good balance. Lower = more false triggers.
                       Higher = may miss quiet/fast utterances.
        """
        # Load only the hey_jarvis model to minimize memory/CPU
        # openwakeword 0.4.x uses wakeword_model_paths (list of ONNX file paths)
        hey_jarvis_path = openwakeword.models["hey_jarvis"]["model_path"]
        self._model = OwwModel(wakeword_model_paths=[hey_jarvis_path])
        self._threshold = threshold
        logger.info(
            "WakeWordDetector loaded: model=hey_jarvis, threshold=%.2f",
            threshold,
        )

    def detect(self, frame: bytes) -> bool:
        """Process a single audio frame and check for wake word.

        Args:
            frame: Raw PCM bytes (16-bit signed LE, mono, 16kHz).
                   Should be 512 samples (1024 bytes) to match our frame size.
                   openWakeWord internally handles frame buffering and only
                   produces predictions after accumulating ~1280 samples.

        Returns:
            True if "Hey Jarvis" was detected with confidence >= threshold.
        """
        # Convert bytes to int16 numpy array
        audio_int16 = np.frombuffer(frame, dtype=np.int16)

        # predict() returns dict: {"hey_jarvis_v0.1": score}
        # The model name in the dict is derived from the ONNX filename
        predictions = self._model.predict(audio_int16)

        # Check all prediction keys for hey_jarvis (name derived from filename)
        for model_name, score in predictions.items():
            if score >= self._threshold:
                logger.debug(
                    "Wake word '%s' score: %.3f (threshold: %.2f)",
                    model_name,
                    score,
                    self._threshold,
                )
                return True

        return False

    def reset(self) -> None:
        """Reset detection state (call after a detection to avoid re-triggering)."""
        self._model.reset()
        logger.debug("Wake word detector reset")

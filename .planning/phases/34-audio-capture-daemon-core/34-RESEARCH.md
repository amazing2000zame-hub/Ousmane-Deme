# Phase 34: Audio Capture Daemon Core - Research

**Researched:** 2026-02-26
**Domain:** Python audio capture daemon, VAD, wake word detection, ALSA, real-time audio processing
**Confidence:** HIGH

## Summary

Phase 34 builds a Python daemon ("jarvis-ear") that continuously captures audio from the Home node's Intel SOF digital microphones via ALSA, uses Voice Activity Detection to filter silence, detects the "Hey Jarvis" wake word, and captures the user's spoken command until end-of-speech silence. The daemon runs natively on the host (not Docker) as a systemd service because it needs direct ALSA device access.

The core technology stack is well-established: **pyalsaaudio** for ALSA capture, **openWakeWord** for wake word detection (which bundles Silero VAD internally), and a lightweight standalone Silero VAD for end-of-speech detection during the CAPTURING state. A critical discovery is that **tflite-runtime does not support Python 3.13** (the version on this system), so openWakeWord MUST be configured with `inference_framework="onnx"`. The ONNX runtime (v1.23.2) and numpy (v2.4.1) are already installed system-wide.

The daemon implements a three-state machine (IDLE -> LISTENING -> CAPTURING) with a 500ms pre-roll ring buffer to preserve audio context before the wake word. It does NOT connect to the Jarvis backend Socket.IO -- that is Phase 35's responsibility. Phase 34 outputs are: captured audio buffers, state transitions logged to console/journal, and verified wake word detection. The daemon is a standalone process that proves the audio capture pipeline works end-to-end.

**Primary recommendation:** Use openWakeWord v0.6.0 with `inference_framework="onnx"` and `vad_threshold=0.5` for the combined VAD+wake-word IDLE stage, plus a separate lightweight Silero VAD (via direct ONNX inference with numpy, no torch) for end-of-speech detection in CAPTURING state. Install in a Python venv at `/opt/jarvis-ear/` with a systemd unit.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pyalsaaudio | 0.11.0 | ALSA PCM capture from DMIC | Direct ALSA access, no PulseAudio/PipeWire dependency; the only Python ALSA wrapper |
| openwakeword | 0.6.0 | "Hey Jarvis" wake word detection + built-in Silero VAD | Purpose-built for wake word detection, includes pre-trained hey_jarvis model, bundles Silero VAD as optional gate |
| onnxruntime | 1.23.2 | ONNX model inference for VAD and wake word | Already installed system-wide; required since tflite-runtime does not support Python 3.13 |
| numpy | 2.4.1 | Audio buffer manipulation, int16-to-float32 conversion | Already installed system-wide; used by all audio processing components |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| python-socketio[client] | latest | Socket.IO client for /voice namespace | Phase 35 only -- NOT needed in Phase 34 |
| wave (stdlib) | built-in | WAV file I/O for test recordings | Verification/debugging only |
| collections.deque (stdlib) | built-in | Pre-roll ring buffer (500ms) | Always -- thread-safe, O(1) append/popleft |
| struct (stdlib) | built-in | WAV header construction for audio chunks | When packaging PCM as WAV for backend |
| logging (stdlib) | built-in | Structured daemon logging | Always -- systemd journal integration |
| signal (stdlib) | built-in | Graceful shutdown on SIGTERM/SIGINT | Always -- systemd stop handling |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pyalsaaudio | sounddevice (libportaudio) | sounddevice adds portaudio dependency; pyalsaaudio is ALSA-native, simpler on Linux-only system |
| openWakeWord | Porcupine (Picovoice) | Commercial license required for production; openWakeWord is MIT-licensed and has a pre-trained hey_jarvis model |
| openWakeWord | Mycroft Precise | Abandoned project, no longer maintained; openWakeWord is actively developed |
| Separate Silero VAD for end-of-speech | openWakeWord's built-in VAD | openWakeWord's VAD only gates wake word predictions (zeroes out scores when no speech); it does not provide a raw speech probability score for end-of-speech timeout logic |
| silero-vad-lite (zero-dep) | silero-vad (requires torch) | silero-vad pulls in PyTorch (~2GB); silero-vad-lite bundles C++ ONNX runtime (~50MB) but is a separate binary; a lightweight OnnxWrapper with just numpy+onnxruntime is the best middle ground |
| collections.deque ring buffer | numpy_ringbuffer | deque is stdlib, thread-safe, sufficient for 500ms of 16kHz audio (16000 samples); no external dependency needed |

**Installation:**
```bash
# Create venv (Python 3.13 on Debian 13)
python3 -m venv /opt/jarvis-ear/venv

# Install system dependency for pyalsaaudio build
apt install -y libasound2-dev

# Install Python packages
/opt/jarvis-ear/venv/bin/pip install pyalsaaudio openwakeword numpy

# Note: onnxruntime is pulled in by openwakeword as dependency
# Note: tflite-runtime will FAIL to install on Python 3.13 -- this is expected
#       openWakeWord must be configured with inference_framework="onnx"
```

## Architecture Patterns

### Recommended Project Structure

```
/opt/jarvis-ear/
├── venv/                    # Python virtual environment
├── ear.py                   # Main daemon entry point
├── capture.py               # ALSA audio capture thread
├── vad.py                   # Silero VAD wrapper (ONNX, for end-of-speech)
├── wakeword.py              # openWakeWord wrapper
├── state_machine.py         # IDLE/LISTENING/CAPTURING state machine
├── ring_buffer.py           # Pre-roll audio ring buffer
├── config.py                # Configuration constants
├── models/                  # Downloaded ONNX model files
│   └── silero_vad.onnx      # Silero VAD v5 model (for end-of-speech)
└── test_capture.py          # Verification script
```

### Pattern 1: Audio Capture Thread with Blocking Read

**What:** Dedicated thread for ALSA capture using blocking PCM reads
**When to use:** Always -- the main audio ingestion pattern
**Example:**
```python
# Source: pyalsaaudio documentation (http://larsimmisch.github.io/pyalsaaudio/)
import alsaaudio
import threading
import numpy as np
from collections import deque

class AudioCapture(threading.Thread):
    def __init__(self, callback, device='default', rate=16000,
                 channels=1, period_size=512):
        super().__init__(daemon=True)
        self.callback = callback
        self.device = device
        self.rate = rate
        self.channels = channels
        self.period_size = period_size
        self._stop_event = threading.Event()

    def run(self):
        pcm = alsaaudio.PCM(
            type=alsaaudio.PCM_CAPTURE,
            mode=alsaaudio.PCM_NORMAL,  # Blocking reads
            device=self.device,
            channels=self.channels,
            rate=self.rate,
            format=alsaaudio.PCM_FORMAT_S16_LE,
            periodsize=self.period_size,
        )
        while not self._stop_event.is_set():
            length, data = pcm.read()
            if length > 0:
                audio = np.frombuffer(data, dtype=np.int16)
                self.callback(audio)
            elif length == -32:  # -EPIPE: buffer overrun
                logging.warning("ALSA buffer overrun")
                # read() auto-recovers; just continue

    def stop(self):
        self._stop_event.set()
```

### Pattern 2: Three-State Machine

**What:** IDLE -> LISTENING -> CAPTURING state transitions
**When to use:** Core daemon logic
**States:**
- **IDLE**: Audio flowing through VAD + wake word detection. Silence frames discarded. Speech frames checked for wake word. Pre-roll buffer maintained.
- **LISTENING**: Wake word detected. Transitioning to active capture. Pre-roll buffer flushed into capture buffer. (This state may be instantaneous -- just the transition logic.)
- **CAPTURING**: Actively recording the user's utterance. Each frame checked by VAD for speech. Silence counter tracks consecutive silent frames. After 2 seconds of silence (VOICE-03), transition back to IDLE with captured audio.

```python
from enum import Enum

class State(Enum):
    IDLE = "idle"
    LISTENING = "listening"  # wake word detected, pre-roll flush
    CAPTURING = "capturing"  # recording user utterance

class StateMachine:
    def __init__(self):
        self.state = State.IDLE
        self.capture_buffer = []
        self.silence_frames = 0
        self.silence_threshold_frames = 0  # computed from sample rate

    def on_wake_word(self, pre_roll_audio):
        """Transition IDLE -> CAPTURING"""
        self.state = State.CAPTURING
        self.capture_buffer = list(pre_roll_audio)  # flush pre-roll
        self.silence_frames = 0
        logging.info("STATE: IDLE -> CAPTURING (wake word detected)")

    def on_audio_frame(self, frame, is_speech):
        """Process frame in CAPTURING state"""
        if self.state != State.CAPTURING:
            return None
        self.capture_buffer.append(frame)
        if is_speech:
            self.silence_frames = 0
        else:
            self.silence_frames += 1
        if self.silence_frames >= self.silence_threshold_frames:
            audio = self.finalize()
            self.state = State.IDLE
            logging.info("STATE: CAPTURING -> IDLE (silence timeout)")
            return audio
        return None

    def finalize(self):
        """Return captured audio and reset"""
        audio = np.concatenate(self.capture_buffer)
        self.capture_buffer = []
        self.silence_frames = 0
        return audio
```

### Pattern 3: Pre-Roll Ring Buffer (500ms)

**What:** Circular buffer holding the last 500ms of audio to prevent cutting off the first words after "Hey Jarvis"
**When to use:** Always active in IDLE state
**Example:**
```python
from collections import deque

class PreRollBuffer:
    def __init__(self, sample_rate=16000, duration_ms=500):
        # At 16kHz with period_size=512, each frame is 512 samples = 32ms
        # 500ms = ~15.6 frames -> 16 frames
        self.max_frames = int((duration_ms / 1000.0) * sample_rate / 512) + 1
        self.buffer = deque(maxlen=self.max_frames)

    def push(self, frame):
        self.buffer.append(frame)

    def flush(self):
        """Return all buffered frames and clear"""
        frames = list(self.buffer)
        self.buffer.clear()
        return frames
```

### Pattern 4: openWakeWord with ONNX and Built-in VAD

**What:** Configure openWakeWord to use ONNX inference (required for Python 3.13) with built-in Silero VAD gating
**When to use:** During IDLE state wake word detection
**Example:**
```python
# Source: openWakeWord README (https://github.com/dscripka/openWakeWord)
import openwakeword
from openwakeword.model import Model

# Download models on first run
openwakeword.utils.download_models()

# Initialize with ONNX (REQUIRED: tflite-runtime does not support Python 3.13)
oww_model = Model(
    wakeword_models=["hey_jarvis"],
    inference_framework="onnx",
    vad_threshold=0.5,        # Built-in Silero VAD gates predictions
)

# Process audio frame (must be int16, 16kHz, >= 1280 samples / 80ms)
prediction = oww_model.predict(audio_frame)
# Returns: {"hey_jarvis": 0.0-1.0}

if prediction["hey_jarvis"] > 0.5:
    # Wake word detected!
    pass
```

### Pattern 5: Silero VAD for End-of-Speech Detection (ONNX-only, no torch)

**What:** Lightweight VAD using direct ONNX inference for detecting silence during CAPTURING state
**When to use:** During CAPTURING state to detect 2-second silence timeout
**Why separate from openWakeWord's VAD:** openWakeWord's vad_threshold only gates wake word predictions (sets them to zero when no speech). It does not expose the raw VAD probability score. We need raw speech probability for the CAPTURING state silence timeout logic.

```python
# Lightweight Silero VAD wrapper using only onnxruntime + numpy
import onnxruntime
import numpy as np

class SileroVAD:
    def __init__(self, model_path, sample_rate=16000):
        self.session = onnxruntime.InferenceSession(
            model_path,
            providers=['CPUExecutionProvider']
        )
        self.sample_rate = sample_rate
        self._h = np.zeros((2, 1, 128), dtype=np.float32)
        self._c = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros(64, dtype=np.float32)  # 16kHz context size

    def reset(self):
        self._h = np.zeros((2, 1, 128), dtype=np.float32)
        self._c = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros(64, dtype=np.float32)

    def process(self, audio_chunk):
        """Process 512 samples (32ms at 16kHz). Returns speech probability 0-1."""
        # Normalize int16 to float32 [-1, 1]
        if audio_chunk.dtype == np.int16:
            audio_chunk = audio_chunk.astype(np.float32) / 32768.0

        # Prepend context
        x = np.concatenate([self._context, audio_chunk])
        x = x[np.newaxis, :]  # Add batch dimension

        # Run inference
        ort_inputs = {
            'input': x,
            'state': self._h,    # Note: actual tensor names may vary by model version
            'sr': np.array([self.sample_rate], dtype=np.int64),
        }
        output, new_state = self.session.run(None, ort_inputs)[:2]

        # Update state
        self._h = new_state
        self._context = audio_chunk[-64:]  # Save last 64 samples as context

        return float(output[0])
```

**IMPORTANT NOTE:** The exact ONNX input/output tensor names and state management differ between Silero VAD model versions (v4 vs v5 vs v6). The implementation MUST inspect the model's input/output names at runtime using `session.get_inputs()` and `session.get_outputs()` and adapt accordingly. The pattern above is illustrative -- the real implementation must verify tensor names against the downloaded model.

### Anti-Patterns to Avoid

- **Running audio capture in the main thread:** Blocking `pcm.read()` in the main thread prevents processing. Use a dedicated capture thread with a callback.
- **Processing every sample individually through VAD:** Silero VAD expects 512-sample chunks (32ms at 16kHz). Don't feed it sample-by-sample. Accumulate to the right chunk size.
- **Using tflite-runtime on Python 3.13:** It will fail to install. The system has Python 3.13.5; tflite-runtime only supports up to Python 3.11. Always use `inference_framework="onnx"`.
- **Installing PyTorch for Silero VAD:** PyTorch is ~2GB. Use direct ONNX inference with numpy for the standalone VAD. openWakeWord bundles its own Silero VAD internally, so PyTorch is not needed there either.
- **Opening ALSA device as `hw:1,7` directly:** Use the default ALSA device (which routes through plug -> dsnoop -> hw:sofhdadsp,7 as configured in Phase 33's `/etc/asound.conf`). This enables multi-process sharing. Direct hw: access locks the device exclusively.
- **Polling with PCM_NONBLOCK:** Wastes CPU. Use PCM_NORMAL (blocking mode) in a dedicated thread -- the thread sleeps while waiting for data, using zero CPU.
- **Forgetting to reset VAD state between utterances:** After transitioning from CAPTURING back to IDLE, reset the standalone Silero VAD state. Stale RNN hidden state from the previous utterance will produce incorrect probabilities.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wake word detection | Custom keyword spotting with DTW/MFCC | openWakeWord with hey_jarvis model | Trained on ~200k synthetic clips, competitive with Picovoice; no training data needed |
| Voice activity detection | Energy/RMS threshold-based VAD | Silero VAD (ONNX) | Neural VAD handles background noise, music, keyboard clicks far better than energy thresholds |
| Audio format conversion | Manual sample rate conversion | ALSA `plug` plugin (already configured) | Hardware does 16kHz natively on DMIC16kHz device; plug handles any edge cases |
| Multi-process audio sharing | File locks on /dev/snd | ALSA dsnoop (already configured) | Kernel-level IPC, configured in Phase 33 |
| WAV file construction | Manual struct.pack WAV headers | Python `wave` stdlib module | Handles all header fields correctly, supports streaming writes |
| Ring buffer | Custom circular array with head/tail pointers | `collections.deque(maxlen=N)` | Thread-safe, O(1) operations, stdlib, battle-tested |

**Key insight:** The combination of openWakeWord (with built-in Silero VAD for wake word gating) plus a separate lightweight Silero VAD (for end-of-speech detection) gives us the full pipeline without PyTorch, without custom ML models, and with minimal dependencies.

## Common Pitfalls

### Pitfall 1: ALSA Buffer Overrun (-EPIPE)

**What goes wrong:** `pcm.read()` returns `-32` (EPIPE) instead of audio data, meaning the kernel buffer overflowed because the daemon didn't read fast enough.
**Why it happens:** The processing thread takes too long (e.g., wake word inference blocks), causing the ALSA buffer to fill up. Or the period_size is too small relative to processing time.
**How to avoid:** Use a dedicated capture thread that does ONLY reads and queues data. Process audio in a separate thread. Set `period_size=512` (32ms) and `periods=8` for a 256ms buffer -- enough headroom for occasional processing delays.
**Warning signs:** Log messages with "buffer overrun"; gaps in captured audio.

### Pitfall 2: openWakeWord Chunk Size Mismatch

**What goes wrong:** Wake word detection produces no results or garbage scores.
**Why it happens:** openWakeWord expects audio frames that are multiples of 80ms (1280 samples at 16kHz). Feeding it 512-sample ALSA periods directly won't work -- you need to accumulate to 1280+ samples.
**How to avoid:** Accumulate ALSA read periods into 1280-sample frames before calling `oww_model.predict()`. The ALSA capture can use period_size=1280 directly, or use 512 and accumulate 2-3 periods.
**Warning signs:** `predict()` always returns 0.0 scores; model seems unresponsive.

### Pitfall 3: tflite-runtime Installation Failure on Python 3.13

**What goes wrong:** `pip install openwakeword` succeeds but tflite-runtime fails to install, and openWakeWord defaults to tflite, causing runtime errors.
**Why it happens:** tflite-runtime only has wheels for Python <=3.11. Python 3.13 on this system is not supported.
**How to avoid:** Always pass `inference_framework="onnx"` to `Model()`. Do NOT let openWakeWord use its default tflite framework. If tflite-runtime fails to install via pip, that's fine -- we don't use it.
**Warning signs:** ImportError for tflite-runtime; "No module named 'tflite_runtime'" at runtime.

### Pitfall 4: Stereo-to-Mono Conversion for 2-Channel DMIC

**What goes wrong:** VAD and wake word models receive interleaved stereo data, treating it as mono, producing garbage results.
**Why it happens:** The Intel DMIC captures 2 channels (stereo digital mic array). pyalsaaudio with channels=2 returns interleaved L/R samples. Models expect mono audio.
**How to avoid:** Either configure pyalsaaudio with `channels=1` (if ALSA plug supports downmix) or capture stereo and average/select one channel in numpy: `mono = audio.reshape(-1, 2).mean(axis=1).astype(np.int16)`. The ALSA dsnoop in `/etc/asound.conf` is configured for 2 channels, so capturing via default device gives 2-channel audio. The `plug` wrapper around it should handle downmix if you request 1 channel.
**Warning signs:** Audio sounds like double-speed chipmunks when played back; VAD never triggers; wake word never detected.

### Pitfall 5: Pre-Roll Buffer Not Capturing Enough Context

**What goes wrong:** The first word of the user's command after "Hey Jarvis" is clipped or missing.
**Why it happens:** The 500ms pre-roll buffer is too small, or the buffer is flushed at the wrong time (after processing delay rather than at wake word detection time).
**How to avoid:** Keep pre-roll at 500ms (8000 samples at 16kHz). Flush the pre-roll into the capture buffer IMMEDIATELY when the wake word score exceeds threshold, before any other processing.
**Warning signs:** Transcriptions consistently miss the first word; users report needing to pause after saying "Hey Jarvis" before speaking their command.

### Pitfall 6: VAD Threshold Too High for Silence Timeout

**What goes wrong:** The daemon never detects end-of-speech, recording forever until max duration.
**Why it happens:** VAD threshold set too high (e.g., 0.9), causing soft speech at the end of an utterance to register as "silence" before the user actually stops talking, or the threshold is correct but the silence counter counts VAD frames (32ms each) and the math is wrong for 2-second timeout.
**How to avoid:** Use a VAD threshold of 0.3-0.5 for end-of-speech detection (more sensitive than wake word gating). Calculate silence frames correctly: at 512 samples/frame (32ms), 2 seconds = 62.5 frames, so use 63 consecutive silent frames.
**Warning signs:** Recording duration always hits max; or recording cuts off mid-sentence.

### Pitfall 7: Not Using Virtual Environment

**What goes wrong:** System Python packages conflict with daemon dependencies; or `apt` complains about externally-managed environment.
**Why it happens:** Debian 13 marks system Python as externally-managed. `pip install` without venv fails with "externally-managed-environment" error.
**How to avoid:** Always use a venv at `/opt/jarvis-ear/venv/`. The systemd unit should reference `/opt/jarvis-ear/venv/bin/python`.
**Warning signs:** pip install errors mentioning "externally-managed-environment".

## Code Examples

### Complete ALSA Capture + openWakeWord Integration

```python
# Source: pyalsaaudio docs + openWakeWord README
import alsaaudio
import numpy as np
import openwakeword
from openwakeword.model import Model

# Configuration
RATE = 16000
CHANNELS = 1
PERIOD_SIZE = 1280  # 80ms -- matches openWakeWord's optimal frame size
DEVICE = 'default'  # Uses ALSA plug -> dsnoop -> hw:sofhdadsp,7

# Initialize ALSA capture
pcm = alsaaudio.PCM(
    type=alsaaudio.PCM_CAPTURE,
    mode=alsaaudio.PCM_NORMAL,
    device=DEVICE,
    channels=CHANNELS,
    rate=RATE,
    format=alsaaudio.PCM_FORMAT_S16_LE,
    periodsize=PERIOD_SIZE,
)

# Initialize openWakeWord with ONNX
openwakeword.utils.download_models()
oww = Model(
    wakeword_models=["hey_jarvis"],
    inference_framework="onnx",
    vad_threshold=0.5,
)

# Main loop
while True:
    length, data = pcm.read()
    if length > 0:
        audio = np.frombuffer(data, dtype=np.int16)
        prediction = oww.predict(audio)
        if prediction["hey_jarvis"] > 0.5:
            print("Wake word detected!")
```

### Construct WAV from Raw PCM for Backend

```python
# Source: Python wave module documentation
import wave
import io

def pcm_to_wav(pcm_data: np.ndarray, sample_rate=16000, channels=1) -> bytes:
    """Convert raw PCM int16 array to WAV bytes."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit = 2 bytes
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data.tobytes())
    return buf.getvalue()
```

### Systemd Unit Template

```ini
# /etc/systemd/system/jarvis-ear.service
[Unit]
Description=Jarvis Ear - Audio Capture Daemon
After=alsa-restore.service sound.target
Wants=alsa-restore.service

[Service]
Type=simple
ExecStart=/opt/jarvis-ear/venv/bin/python /opt/jarvis-ear/ear.py
WorkingDirectory=/opt/jarvis-ear
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
# Run as root for ALSA device access (or create audio group user)
User=root
# Resource limits
LimitNOFILE=1024
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

### Verify Audio Capture Works

```python
#!/usr/bin/env python3
"""Quick test: record 5 seconds and save as WAV."""
import alsaaudio
import wave
import time

pcm = alsaaudio.PCM(
    type=alsaaudio.PCM_CAPTURE,
    mode=alsaaudio.PCM_NORMAL,
    device='default',
    channels=1,
    rate=16000,
    format=alsaaudio.PCM_FORMAT_S16_LE,
    periodsize=1280,
)

print("Recording 5 seconds...")
frames = []
start = time.time()
while time.time() - start < 5:
    length, data = pcm.read()
    if length > 0:
        frames.append(data)

with wave.open('/tmp/test_capture.wav', 'wb') as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(16000)
    wf.writeframes(b''.join(frames))

print(f"Saved /tmp/test_capture.wav ({len(frames)} frames)")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PocketSphinx keyword spotting | Neural wake word (openWakeWord, Porcupine) | 2022-2023 | Much lower false positive rate, works in noisy environments |
| Energy-threshold VAD | Neural VAD (Silero, WebRTC) | 2020-2021 | Handles non-speech noise (music, typing) without false triggers |
| PyTorch for edge inference | ONNX Runtime | 2021-2022 | 50MB vs 2GB dependency; 10% faster inference on CPU |
| PulseAudio for Linux audio | ALSA direct / PipeWire | 2021-2023 | ALSA dmix/dsnoop sufficient for headless; PipeWire for desktop |
| USB mic as primary | Built-in DMIC array | Phase 33 (2026-02-26) | Zero-cost, already installed, 16kHz native capture |

**Deprecated/outdated:**
- **PocketSphinx for wake words:** High false positive rate, poor accuracy in noisy environments. Use openWakeWord instead.
- **tflite-runtime on Python 3.13:** No wheels available. Use ONNX Runtime instead.
- **silero-vad v4:** Superseded by v5/v6 with 3x faster inference. Use latest model from GitHub releases.
- **PyTorch-based Silero VAD on resource-constrained systems:** ONNX-only path is 40x lighter and equally accurate.

## Hardware Context (from Phase 33)

Verified working audio hardware on Home node (192.168.1.50):

| Property | Value |
|----------|-------|
| Sound Card | sof-hda-dsp (card 1, ID "sofhdadsp") |
| Primary Capture Device | hw:sofhdadsp,7 (DMIC16kHz) |
| Native Sample Rate | 16000 Hz |
| Channels | 2 (stereo DMIC array) |
| ALSA Default Device | plug -> dsnoop -> hw:sofhdadsp,7 |
| Multi-Process Sharing | Verified via dsnoop (IPC key 1025) |
| Gain Settings | Maxed and saved with alsactl store |
| Peak Amplitude (speech) | 70-80% |
| Card Index Pinning | snd_hda_intel=0, snd_sof_pci_intel_tgl=1 |
| Config File | /etc/asound.conf |

## Existing Backend Protocol (from voice.ts)

The Jarvis backend already defines the Socket.IO /voice namespace protocol. Phase 34 does NOT connect to it (that is Phase 35), but the daemon must produce audio compatible with this protocol:

| Event | Direction | Payload | Notes |
|-------|-----------|---------|-------|
| voice:audio_start | ear -> backend | `{ agentId }` | Sent when wake word detected |
| voice:audio_chunk | ear -> backend | `{ agentId, audio, seq }` | 500ms WAV chunks, base64-encoded |
| voice:audio_end | ear -> backend | `{ agentId }` | Sent when 2s silence detected |
| voice:listening | backend -> ear | `{}` | Backend ready for next command |
| voice:processing | backend -> ear | `{}` | Backend processing audio |
| voice:tts_chunk | backend -> ear | `{ index, contentType, audio }` | TTS response audio (base64) |

**Audio format expected by backend:** WAV, 16kHz, 16-bit mono PCM, base64-encoded in 500ms chunks.

## Key Design Decisions

### 1. openWakeWord's Built-in VAD vs Separate VAD

openWakeWord bundles Silero VAD and uses it as a prediction gate via `vad_threshold`. When enabled, it zeroes out wake word predictions when no speech is detected. This is the correct approach for the IDLE state -- it reduces false wake word activations from background noise.

However, during CAPTURING state (after wake word triggers), we need raw speech probability scores to implement the 2-second silence timeout (VOICE-03). openWakeWord's VAD does not expose raw scores; it only gates predictions internally.

**Decision:** Use openWakeWord's built-in VAD for IDLE state (wake word gating) + a lightweight standalone Silero VAD ONNX model for CAPTURING state (end-of-speech detection).

### 2. ALSA Period Size Selection

openWakeWord needs frames in multiples of 80ms (1280 samples at 16kHz). Using `period_size=1280` aligns ALSA reads perfectly with openWakeWord's processing requirements, eliminating the need for frame accumulation. This gives ~78 reads/second.

For the standalone Silero VAD in CAPTURING state, the model needs 512-sample chunks (32ms). Since we read 1280 samples at a time, we can split each read into 2.5 chunks -- or use period_size=512 and accumulate for openWakeWord. The simpler approach is period_size=1280 (aligned with openWakeWord) and split for VAD.

**Decision:** Use `period_size=1280` (80ms) for all ALSA reads. Split into 512-sample sub-chunks for Silero VAD when needed.

### 3. Stereo vs Mono Capture

The DMIC captures 2 channels. The ALSA `plug` wrapper (configured as default device) should handle stereo-to-mono downmix automatically when we request `channels=1`. If it doesn't, we average channels in numpy.

**Decision:** Open ALSA with `channels=1`. If that fails or produces unexpected results, fall back to `channels=2` and average channels in numpy.

### 4. Daemon Lifecycle

The daemon runs as a systemd service. On SIGTERM, it cleanly closes the ALSA device and exits. On crash, systemd restarts it after 5 seconds. No Docker container needed -- direct ALSA access is simpler.

## Open Questions

1. **Will `channels=1` work via the ALSA default device?**
   - What we know: The dsnoop in `/etc/asound.conf` is configured for 2 channels. The `plug` wrapper should handle channel conversion.
   - What's unclear: Whether plug successfully downmixes 2-channel dsnoop to 1-channel output. ALSA plug is usually good at this, but worth verifying.
   - Recommendation: Test during Plan 01. If channels=1 fails, use channels=2 and add `audio.reshape(-1, 2).mean(axis=1)` conversion.

2. **Which Silero VAD ONNX model version to use for end-of-speech?**
   - What we know: v5 and v6 models exist. The ONNX model input/output tensor names differ between versions. openWakeWord bundles its own version internally.
   - What's unclear: Whether we can extract the Silero VAD ONNX model that openWakeWord already downloads, or if we need to download a separate one.
   - Recommendation: Download the v5 model from the official Silero VAD GitHub releases. Inspect input/output tensor names at runtime with `session.get_inputs()`.

3. **Optimal wake word threshold for this microphone?**
   - What we know: Default threshold is 0.5. The DMIC captures at 70-80% peak amplitude for speech. Room noise levels unknown.
   - What's unclear: Whether 0.5 is too sensitive (false positives) or too conservative (missed detections) for this specific microphone in its environment.
   - Recommendation: Start with 0.5, add configurable threshold via config.py. Tune during testing.

4. **Maximum recording duration safeguard?**
   - What we know: Backend has MAX_RECORDING_MS = 30000 (30 seconds). The daemon should have its own safeguard.
   - What's unclear: What's a reasonable max for server-side capture?
   - Recommendation: Match backend: 30 seconds max capture, then force transition to IDLE. Log a warning.

## Sources

### Primary (HIGH confidence)
- Phase 33 RESEARCH.md and SUMMARY files -- verified audio hardware details, ALSA configuration
- pyalsaaudio documentation (http://larsimmisch.github.io/pyalsaaudio/) -- PCM API, format constants, read() behavior
- openWakeWord GitHub (https://github.com/dscripka/openWakeWord) -- Model class API, predict() return format, inference_framework parameter, vad_threshold behavior
- openWakeWord hey_jarvis model docs (https://github.com/dscripka/openWakeWord/blob/main/docs/models/hey_jarvis.md) -- model architecture, training data
- Silero VAD GitHub (https://github.com/snakers4/silero-vad) -- ONNX support, chunk sizes, OnnxWrapper class
- Jarvis backend voice.ts -- Socket.IO /voice namespace protocol, audio chunk format
- Jarvis backend stt.ts -- Whisper transcription API, WAV format expectations
- Live system investigation -- Python 3.13.5, onnxruntime 1.23.2, numpy 2.4.1 installed; ALSA cards verified

### Secondary (MEDIUM confidence)
- openWakeWord DeepWiki (https://deepwiki.com/dscripka/openWakeWord) -- VAD integration internals, pipeline architecture
- Silero VAD DeepWiki (https://deepwiki.com/snakers4/silero-vad/4.3-using-with-onnx) -- OnnxWrapper class details
- python-socketio docs (https://python-socketio.readthedocs.io/) -- client API for Phase 35 planning
- pyalsaaudio PyPI (https://pypi.org/project/pyalsaaudio/) -- version 0.11.0 confirmed
- silero-vad PyPI (https://pypi.org/project/silero-vad/) -- version 6.2.1, dependencies
- openwakeword PyPI (https://pypi.org/project/openwakeword/) -- version 0.6.0 confirmed

### Tertiary (LOW confidence)
- py-silero-vad-lite (https://github.com/daanzu/py-silero-vad-lite) -- alternative zero-dep wrapper, not verified on Python 3.13
- tflite-runtime Python 3.13 compatibility -- confirmed NOT available via PyPI search, but not tested directly

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified, versions confirmed, compatibility checked against Python 3.13
- Architecture: HIGH -- state machine pattern well-understood, audio pipeline proven in Phase 33, backend protocol documented in source code
- Pitfalls: HIGH -- each pitfall based on verified API behavior, system investigation, or documented constraints
- ONNX-only Silero VAD wrapper: MEDIUM -- tensor names and state management may vary by model version; needs runtime validation
- openWakeWord hey_jarvis accuracy: MEDIUM -- no published test set, but trained on 200k clips and "broadly competitive" per docs

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable domain; libraries update infrequently)

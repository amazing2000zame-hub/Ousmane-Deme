# Technology Stack: Server-Side Always-On Voice

**Project:** Jarvis 3.1 - Always-On Voice Milestone
**Researched:** 2026-02-25
**Overall confidence:** MEDIUM-HIGH
**Mode:** Ecosystem (Stack dimension for subsequent milestone)

**Scope:** This document covers ONLY the stack additions for always-on server-side voice. The existing stack (Node.js backend, Whisper STT, XTTS/Piper TTS, Socket.IO /voice namespace) is validated and unchanged. See previous STACK.md for those decisions.

---

## Context: What Already Exists (DO NOT Duplicate)

| Component | Status | Location |
|-----------|--------|----------|
| Whisper STT | Running | Docker, port 5051, faster-whisper 1.1.1, medium.en, int8 |
| XTTS v2 TTS | Running | Docker, port 5050, GPU-accelerated, 8GB mem |
| Piper TTS | Running | Docker, port 5000, CPU fallback |
| Socket.IO /voice namespace | Running | jarvis-backend voice.ts handler |
| Node.js backend | Running | Express 5, Socket.IO 4, port 4000 |

The `voice.ts` handler already accepts `voice:audio_start`, `voice:audio_chunk`, `voice:audio_end` events and processes them through Whisper -> LLM -> TTS pipeline. The new daemon needs to BE THE CLIENT that sends these events.

---

## Recommended Stack Additions

### New Service: `jarvis-ear` (Python Daemon)

A standalone Python service running OUTSIDE Docker (directly on the Home node host) that captures audio from physical microphones, detects voice activity, identifies the wake word, and streams post-wake-word audio to the existing backend via Socket.IO.

**Why Python:** Audio libraries (pyalsaaudio, silero-vad, openwakeword) are Python-native. The existing Whisper service is Python. No mature ALSA capture library exists for Node.js. The daemon is I/O-bound, not compute-bound, so Python performance is fine.

**Why NOT Docker:** The daemon needs direct access to ALSA hardware devices (`/dev/snd/*`). While Docker can pass through sound devices, it adds complexity for no benefit. This is a host-level hardware service, not an application service.

---

### 1. Audio Capture

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| pyalsaaudio | 0.11.0 | ALSA PCM capture and playback | Direct ALSA access without PulseAudio/PipeWire dependency. Lightweight, stable, well-maintained. Only 14KB wheel. No PortAudio abstraction layer needed since we target ALSA-only. |

**Why NOT sounddevice/pyaudio:** Both depend on PortAudio, which adds an unnecessary abstraction layer. The system runs ALSA-only (no PulseAudio, no PipeWire). pyalsaaudio talks directly to ALSA, giving precise control over device selection, buffer sizes, and capture parameters. Fewer moving parts means fewer failure modes on a headless server.

**Why NOT sounddevice specifically:** Reported instability on some platforms after approximately 30 seconds of continuous capture. For an always-on daemon, this is disqualifying.

**Confidence:** HIGH - pyalsaaudio v0.11.0 released May 2024, well-established, purpose-built for this use case.

---

### 2. Voice Activity Detection (VAD)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| silero-vad | 6.2.0 | Filter silence from speech | MIT license, 0.004 RTF on CPU (processes 1hr audio in 15s), pre-trained on 6000+ languages, 16kHz support, ONNX backend. Industry standard for open-source VAD. |
| onnxruntime | >=1.17.0,<2 | Silero VAD inference | Run Silero without PyTorch dependency. Dramatically reduces memory footprint (~50MB vs ~2GB for PyTorch). |

**Why Silero over WebRTC VAD:** WebRTC VAD is a simple energy-based detector. Silero is a neural network that distinguishes speech from non-speech sounds (fans, HVAC, dishwashers) far more accurately. For an always-on daemon in a home environment with constant background noise, this accuracy matters. Silero achieves 87.7% TPR at 5% FPR versus WebRTC's much higher false positive rate in noisy environments.

**Why ONNX runtime over PyTorch:** Silero v5+ supports pure ONNX inference. PyTorch would add approximately 2GB of dependencies for a model that runs in milliseconds. ONNX runtime is approximately 50MB and purpose-built for inference.

**VAD role in the pipeline:** VAD runs CONTINUOUSLY on every audio frame (32ms chunks). It gates whether audio is passed to the wake word detector, preventing openwakeword from processing pure silence/noise. This saves CPU and reduces false wake word triggers.

**Confidence:** HIGH - Silero VAD is the de facto standard, used by Home Assistant, Rhasspy, and most open-source voice assistants.

---

### 3. Wake Word Detection

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| openwakeword | 0.6.0 | "Hey Jarvis" wake word detection | Ships with pre-trained `hey_jarvis` model. MIT license, ~200KB ONNX models, runs 15-20 models simultaneously on a single RPi3 core. Negligible CPU on i5-13500HX. |

**Why openwakeword over Porcupine:** Porcupine has a built-in "Jarvis" wake word and better documented accuracy, BUT requires a Picovoice API key and has commercial licensing restrictions. openwakeword is fully open-source (MIT), runs completely offline, and already includes a `hey_jarvis` model trained on approximately 200K synthetic clips. For a self-hosted homelab where we control everything, open-source with no vendor lock-in wins.

**Why NOT pure Whisper-based keyword detection:** Running Whisper continuously on all audio would consume 4 CPU cores permanently. openwakeword uses approximately 1% of a single core. The architecture is: openwakeword detects "Hey Jarvis" -> only THEN stream audio to Whisper for full transcription.

**Model details:** The `hey_jarvis` model was trained on approximately 200K synthetic clips (NVIDIA WAVEGLOW + LibriTTS). It uses a frozen audio embedding model (Google's audio_embedding_model) with a small 3-layer FC network on top. The framework targets accuracy >= 0.7, recall >= 0.5, FPR <= 0.2/hr as general guidelines, though the hey_jarvis model lacks published per-model benchmarks.

**Dependencies of openwakeword 0.6.0:**
- `onnxruntime>=1.10.0,<2` (shared with Silero VAD)
- `speexdsp-ns>=0.1.2,<1` (noise suppression, Linux only)
- `scipy>=1.3,<2`
- `scikit-learn>=1,<2`
- `tqdm>=4.0,<5.0`
- `requests>=2.0,<3`

**Confidence:** MEDIUM - The hey_jarvis model lacks published accuracy metrics. Real-world testing needed. If accuracy is insufficient, two fallback options exist: (1) train a custom openwakeword model using the provided Colab notebook, or (2) switch to Porcupine's free tier (allows 1 custom wake word).

---

### 4. Socket.IO Client (Python -> Node.js)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| python-socketio[asyncio_client] | >=5.16.0,<6 | Connect to existing /voice namespace | Official Python Socket.IO client. Async support for non-blocking audio capture loop. Speaks the exact same protocol the backend already handles. |

**Why Socket.IO over raw WebSocket or HTTP:** The backend already has a `/voice` namespace with defined events (`voice:audio_start`, `voice:audio_chunk`, `voice:audio_end`, `voice:tts_chunk`, `voice:tts_done`). Using the same protocol means zero backend changes for basic integration. python-socketio handles reconnection, namespace joining, and event serialization automatically.

**Confidence:** HIGH - python-socketio v5.16.1 released Feb 2026, actively maintained, version 5.x is compatible with Socket.IO 4 server.

---

### 5. Audio Output (TTS Playback)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| pyalsaaudio | 0.11.0 | Play WAV/PCM audio through ALSA | Same library used for capture. Can open a playback PCM device and write audio data directly. No additional dependency. |
| aplay (alsa-utils) | 1.2.14 | Fallback/debugging audio playback | Already installed. Can play WAV files from command line. Useful for initial testing. |

**Audio output hardware options (ranked by reliability):**

1. **USB Speaker/DAC (RECOMMENDED for Phase 1):** Plug in any USB audio device. Appears as ALSA card immediately with zero driver issues. Cost: $15-30 for a USB speaker or USB DAC + powered speaker. This should be the Phase 1 target because it works independent of SOF driver status.

2. **3.5mm headphone jack (laptop built-in):** Requires Intel SOF audio card to be working. Currently stuck on deferred probe at boot, needs reboot. Once SOF is up, the laptop's built-in speakers and headphone jack become available. Cost: $0.

3. **HDMI audio:** Already working (NVidia card0, 4 HDMI ports available). Requires HDMI monitor/TV with speakers, or an HDMI audio extractor (~$15). Viable if an HDMI display is already connected.

4. **Bluetooth speaker:** Requires installing `bluez` (5.82) + `bluez-alsa` for ALSA integration without PulseAudio. More complex setup but viable for wireless speaker placement around the room.

**Recommendation:** Start with USB audio (plug-and-play, zero driver hassle). Once SOF audio is confirmed working after reboot, the laptop's built-in speakers become available as a zero-cost option.

---

### 6. System-Level Dependencies

| Package | Version | Purpose | Install Method | Status |
|---------|---------|---------|----------------|--------|
| alsa-ucm-conf | 1.2.14-1 | ALSA Use Case Manager profiles for SOF | `apt install alsa-ucm-conf` | NOT installed - CRITICAL for SOF mic |
| firmware-sof-signed | 2025.01-1 | Intel SOF firmware for digital mics | Already installed | Installed, needs reboot |
| alsa-utils | 1.2.14 | arecord, aplay, amixer, alsactl | Already installed | Installed |
| libasound2-dev | 1.2.14-1 | ALSA development headers for pyalsaaudio compilation | `apt install libasound2-dev` | Needs install |
| bluez | 5.82-1.1 | Bluetooth stack (optional, for BT speaker) | `apt install bluez` | NOT installed, optional |

**CRITICAL FINDING:** `alsa-ucm-conf` is NOT installed. This package provides the UCM (Use Case Manager) profiles that tell ALSA how to configure the SOF audio card's digital microphones. Without it, even after a reboot fixes the deferred probe, the digital microphones may not be properly configured. The SOF topology files exist (`sof-hda-generic-2ch.tplg` etc.) but the UCM profiles that map them to ALSA controls are missing.

---

### 7. Python Environment and Service Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Python | 3.11+ | Runtime for jarvis-ear daemon | Available on Debian 13 trixie |
| venv | stdlib | Isolated Python environment | Keep daemon dependencies separate from system Python |
| systemd | (system) | Run jarvis-ear as always-on service | Standard Linux service management. Auto-restart on failure. Boot startup. Journal logging. Already used for jarvis-api (llama-server). |

---

## Complete Dependency Installation

```bash
# System packages (apt) - REQUIRED
apt install -y alsa-ucm-conf libasound2-dev

# Optional: Bluetooth speaker support
# apt install -y bluez

# Reboot to activate SOF audio (REQUIRED - one-time)
# reboot

# After reboot, verify microphone
# arecord -l   # Should show Intel SOF capture device

# Create service directory and Python environment
mkdir -p /opt/jarvis-ear
python3 -m venv /opt/jarvis-ear/venv
source /opt/jarvis-ear/venv/bin/activate

# Python packages (pip)
pip install \
  pyalsaaudio==0.11.0 \
  silero-vad==6.2.0 \
  "onnxruntime>=1.17.0,<2" \
  openwakeword==0.6.0 \
  "python-socketio[asyncio_client]>=5.16.0,<6" \
  "numpy>=1.24,<2"
```

---

## Resource Estimates

### Disk Usage

| Component | Size |
|-----------|------|
| onnxruntime | ~50 MB |
| openwakeword (with models) | ~30 MB |
| scipy + scikit-learn (openwakeword deps) | ~80 MB |
| silero-vad (ONNX model) | ~2 MB |
| pyalsaaudio | <1 MB |
| python-socketio | <1 MB |
| numpy | ~30 MB |
| **Total venv** | **~200 MB** |

Compare: Adding PyTorch would cost approximately 2 GB. This stack avoids it entirely via ONNX runtime.

### Runtime Memory Usage

| Component | RAM |
|-----------|-----|
| Python interpreter + venv | ~30 MB |
| ONNX runtime | ~50 MB |
| Silero VAD model (loaded) | ~10 MB |
| openwakeword models (loaded) | ~20 MB |
| Audio buffers (16kHz, 16-bit, ring buffers) | ~1 MB |
| Socket.IO client | ~5 MB |
| **Total steady-state** | **~120 MB** |

This is well within the Home node's 24 GB RAM budget, alongside the existing Docker stack (~14 GB allocated across all containers).

### CPU Usage (Steady-State)

| Component | CPU % (of 1 core) | Notes |
|-----------|-------------------|-------|
| ALSA capture (16kHz mono) | <1% | Kernel DMA, minimal userspace |
| Silero VAD (per frame) | ~0.4% | 0.004 RTF, runs on every 32ms frame |
| openwakeword (per frame) | ~1-2% | Only runs when VAD detects speech |
| Socket.IO idle | ~0% | Event-driven, no polling |
| **Total always-on** | **~2-3%** of one core | Negligible on 20-thread i5-13500HX |

---

## Integration Points with Existing Stack

### jarvis-ear -> jarvis-backend (Socket.IO)

```
jarvis-ear connects to ws://localhost:4000/voice
  Sends: voice:audio_start { agentId: "ear-home" }
  Sends: voice:audio_chunk { agentId: "ear-home", audio: "<base64 WAV>", seq: N }
  Sends: voice:audio_end   { agentId: "ear-home" }
  Receives: voice:tts_chunk  { index, contentType, audio }  -> plays through ALSA
  Receives: voice:tts_done   { totalChunks }                -> playback complete
  Receives: voice:listening   {}                             -> ready for next wake word
  Receives: voice:error       { error }                      -> log and resume listening
```

This matches exactly what `voice.ts` already implements. The daemon is just another client to the existing namespace.

### jarvis-ear -> ALSA Hardware

```
Capture: hw:X,0 (Intel SOF card, once active) or hw:Y,0 (USB mic)
  Format: S16_LE, 16000 Hz, 1 channel (mono)
  Period: 512 frames (32ms per chunk, optimal for Silero VAD)

Playback: hw:X,0 (Intel SOF) or hw:Y,0 (USB speaker) or hw:0,3 (HDMI)
  Format: Whatever TTS returns (typically S16_LE, 22050-24000 Hz)
  Resampling: May need scipy.signal.resample if TTS rate != device rate
```

### Processing Pipeline

```
ALSA Capture (32ms chunks, 16kHz, mono, S16_LE)
  |
  v
Ring Buffer (accumulates raw PCM)
  |
  v
Silero VAD (every 32ms: speech probability 0.0-1.0)
  |
  +-- probability < threshold (0.5) --> discard frame, continue
  |
  +-- probability >= threshold --> speech detected
       |
       v
  openWakeWord (check 80ms audio window for "hey jarvis")
       |
       +-- no wake word --> continue buffering
       |
       +-- WAKE WORD DETECTED
            |
            v
       Socket.IO: voice:audio_start { agentId: "ear-home" }
            |
            v
       Stream subsequent audio as voice:audio_chunk
       (500ms WAV chunks, base64 encoded, matching existing protocol)
            |
            v
       Silero VAD monitors for silence (no speech for 2s)
            |
            v
       Socket.IO: voice:audio_end { agentId: "ear-home" }
            |
            v
       Backend processes: Whisper STT -> LLM -> TTS
            |
            v
       Receive voice:tts_chunk events -> decode -> play through ALSA
            |
            v
       Receive voice:tts_done -> resume listening for next wake word
```

---

## Hardware Prerequisites (MUST complete before development)

### Step 1: Install alsa-ucm-conf (no reboot needed)
```bash
apt install -y alsa-ucm-conf
```

### Step 2: Reboot Home node
```bash
# This resolves the SOF audio deferred probe:
#   "pci 0000:00:1f.3: deferred probe pending: sof-audio-pci-intel-tgl:
#    init of i915 and HDMI codec failed"
# The i915 driver IS loaded, but SOF tried to probe before i915 was ready.
# A reboot allows proper sequencing.
reboot
```

### Step 3: Verify audio hardware after reboot
```bash
# Should show TWO cards: NVidia HDMI + Intel SOF
cat /proc/asound/cards

# Should show capture devices (digital microphones)
arecord -l

# Test capture (5 seconds)
arecord -D hw:X,Y -f S16_LE -r 16000 -c 1 -d 5 /tmp/test.wav

# Test playback (through available output)
aplay -D hw:X,Y /tmp/test.wav
```

### Step 4: If SOF card appears but mics do not work
```bash
# Check UCM profile loaded
alsaucm -c sof-hda-dsp list _verbs

# Check DMIC topology
dmesg | grep -i dmic

# May need to specify DMIC count kernel parameter:
# echo "options snd-sof-pci-intel-tgl dmic_num=2" > /etc/modprobe.d/sof-dmic.conf
# reboot
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Audio capture | pyalsaaudio 0.11.0 | sounddevice (PortAudio) | Extra abstraction layer; reported 30s stability issues on some platforms; ALSA-only system |
| Audio capture | pyalsaaudio 0.11.0 | pyaudio (PortAudio) | Same PortAudio concern; less actively maintained |
| VAD | Silero VAD 6.2.0 (ONNX) | WebRTC VAD | Energy-based only, too many false positives in noisy home environment |
| VAD | Silero VAD 6.2.0 (ONNX) | Silero VAD (PyTorch) | PyTorch adds ~2GB; ONNX runtime is ~50MB for identical accuracy |
| Wake word | openwakeword 0.6.0 | Porcupine (Picovoice) | Vendor lock-in, API key required, commercial license |
| Wake word | openwakeword 0.6.0 | Snowboy | Abandoned/deprecated, no longer maintained |
| Wake word | openwakeword 0.6.0 | Continuous Whisper | Way too heavy for always-on (4 CPU cores vs <1% of 1 core) |
| Wake word | openwakeword 0.6.0 | Custom CNN+MFCC | Significant ML engineering effort for marginal gain over pre-trained model |
| Audio output | ALSA direct (pyalsaaudio) | PulseAudio | Not installed, adds unnecessary complexity for single-output use case |
| Audio output | ALSA direct (pyalsaaudio) | PipeWire | Not installed, overkill for headless server |
| Language | Python | Node.js | No mature ALSA capture library for Node; pyalsaaudio/silero/openwakeword all Python-native |
| Language | Python | Rust | Development speed matters more than micro-optimization for I/O-bound daemon |
| Deployment | systemd on host | Docker container | Need direct /dev/snd access; Docker adds latency and complexity for hardware I/O |
| Communication | Socket.IO (python-socketio) | gRPC | Backend already has Socket.IO /voice namespace; zero backend changes needed |
| Communication | Socket.IO (python-socketio) | Raw WebSocket | Would need to reimplement event protocol; Socket.IO handles reconnection and namespaces |
| Communication | Socket.IO (python-socketio) | HTTP POST chunks | Higher latency, no bidirectional TTS streaming back |

---

## What We Are NOT Adding (and Why)

| Technology | Reason Not to Add |
|------------|-------------------|
| PulseAudio | Not installed, unnecessary layer for single-app ALSA access |
| PipeWire | Overkill for headless server with one audio consumer |
| PyTorch | ONNX runtime provides same model inference at 1/40th the size |
| whisper (for continuous monitoring) | Way too heavy; openwakeword is 100x lighter for keyword detection |
| Node.js audio libraries (node-alsa, naudiodon) | Immature, poorly maintained, no ALSA capture equivalent to pyalsaaudio |
| Docker for jarvis-ear | Hardware access adds complexity; systemd is simpler for host-level services |
| New Whisper instance | Existing Whisper Docker container is reused via the backend |
| New TTS instance | Existing XTTS/Piper containers are reused via the backend |

---

## Backend Changes Required (Minimal)

The existing `voice.ts` needs only minor additions:

1. **TTS chunk audio format header:** Currently sends raw base64 audio. The daemon needs to know the sample rate to play through ALSA. Add `sampleRate` field to `voice:tts_chunk` events.

2. **Agent registration (optional):** Track connected ear daemons for status display in the UI. Not strictly required for functionality.

3. **No other changes needed.** The existing voice pipeline (Whisper -> LLM -> TTS -> Socket.IO events) works as-is.

---

## Sources

### Audio Capture
- [pyalsaaudio Documentation](https://larsimmisch.github.io/pyalsaaudio/pyalsaaudio.html) - v0.11.0 - HIGH confidence
- [pyalsaaudio PyPI](https://pypi.org/project/pyalsaaudio/) - v0.11.0, May 2024 - HIGH confidence
- [pyalsaaudio GitHub](https://github.com/larsimmisch/pyalsaaudio/) - ALSA wrappers - HIGH confidence

### Voice Activity Detection
- [Silero VAD GitHub](https://github.com/snakers4/silero-vad) - v6.2.0, MIT license, ONNX support - HIGH confidence
- [Silero VAD PyPI](https://pypi.org/project/silero-vad/) - v6.2.0, Nov 2025 - HIGH confidence
- [Silero VAD Wiki: Examples and Dependencies](https://github.com/snakers4/silero-vad/wiki/Examples-and-Dependencies) - ONNX runtime usage - HIGH confidence
- [Picovoice VAD Comparison 2026](https://picovoice.ai/blog/best-voice-activity-detection-vad/) - Accuracy benchmarks - MEDIUM confidence (vendor bias possible)

### Wake Word Detection
- [openWakeWord GitHub](https://github.com/dscripka/openWakeWord) - v0.6.0, MIT license - HIGH confidence
- [openWakeWord hey_jarvis model docs](https://github.com/dscripka/openWakeWord/blob/main/docs/models/hey_jarvis.md) - Training data details - MEDIUM confidence (no accuracy metrics published)
- [openWakeWord PyPI](https://pypi.org/project/openwakeword/) - v0.6.0, Feb 2024 - HIGH confidence
- [openwakeword-trainer](https://github.com/lgpearson1771/openwakeword-trainer) - Custom model training - MEDIUM confidence

### Socket.IO
- [python-socketio PyPI](https://pypi.org/project/python-socketio/) - v5.16.1, Feb 2026 - HIGH confidence
- [python-socketio Client Docs](https://python-socketio.readthedocs.io/en/latest/client.html) - Async client usage - HIGH confidence

### Intel SOF Audio
- [SOF Project Intel Debug Guide](https://thesofproject.github.io/latest/getting_started/intel_debug/suggestions.html) - UCM/topology requirements - HIGH confidence
- [Debian trixie alsa-ucm-conf](https://packages.debian.org/trixie/alsa-ucm-conf) - v1.2.14-1 - HIGH confidence
- [Raptor Lake UCM issues](https://github.com/alsa-project/alsa-ucm-conf/issues/632) - Known Raptor Lake audio quirks - MEDIUM confidence

### Bluetooth Audio (optional)
- [BlueALSA GitHub](https://github.com/arkq/bluez-alsa) - Bluetooth without PulseAudio - MEDIUM confidence
- [Debian Wiki Bluetooth/ALSA](https://wiki.debian.org/Bluetooth/Alsa) - Configuration guide - MEDIUM confidence

### Architecture References
- [Wyoming Satellite (Rhasspy)](https://deepwiki.com/rhasspy/wyoming-satellite) - Voice assistant daemon architecture - MEDIUM confidence
- [Picovoice Linux Voice Assistant](https://picovoice.ai/blog/build-voice-controlled-linux-assistant-with-ai/) - Always-on architecture pattern - MEDIUM confidence

### Codebase Verification (HIGH confidence)
- `/root/jarvis-backend/src/realtime/voice.ts` - Existing voice namespace handler, event protocol
- `/root/jarvis-whisper/server.py` - Existing Whisper STT service
- `/root/docker-compose.yml` - Existing Docker stack configuration
- `/root/jarvis-backend/src/ai/stt.ts` - Existing STT client code
- `dmesg` output on Home node - SOF driver status, deferred probe error
- `/proc/asound/cards` - Current ALSA card enumeration (only NVidia HDMI)
- `dpkg -l` - Installed packages verification (alsa-ucm-conf missing)

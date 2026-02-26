# Architecture Patterns: Server-Side Always-On Voice for Jarvis

**Domain:** Always-on server-side voice assistant integration
**Researched:** 2026-02-25
**Overall Confidence:** HIGH (existing codebase thoroughly analyzed, hardware verified, ecosystem well-understood)

---

## Recommended Architecture

### High-Level Overview

The always-on voice system introduces ONE new component -- a Python "Voice Agent" daemon (`jarvis-ear`) -- that runs as a **systemd service** directly on the Home node host. It captures audio from the host's physical microphone, performs wake word detection and VAD locally, and connects to the existing `/voice` Socket.IO namespace on `jarvis-backend` to leverage the **already-built** STT/LLM/TTS pipeline. For speaker output, the daemon plays TTS audio received back from the backend directly to the host's ALSA output device.

```
                    EXISTING (no changes needed)
                    +-----------------------------------------+
                    |           jarvis-backend :4000           |
                    |  /voice namespace (voice.ts)             |
                    |    |                                     |
                    |    +-> Whisper STT (jarvis-whisper:5051) |
                    |    +-> LLM Router (Claude/Qwen/OpenAI)  |
                    |    +-> TTS (XTTS/Piper -> audio chunks) |
                    +-----------------------------------------+
                         ^                    |
                         | Socket.IO          | Socket.IO
                         | voice:audio_*      | voice:tts_chunk
                         |                    v
                    +----------------------------------+
                    |       jarvis-ear (NEW)            |
  Physical Mic ---> |  ALSA capture -> VAD -> Wake Word |
                    |  Socket.IO client -> backend      |
  Physical Speaker <|  Receive TTS chunks -> ALSA play  |
                    +----------------------------------+
                         systemd service on host
                         (direct ALSA device access)
```

### Why This Architecture

**1. The /voice namespace already expects this exact pattern.** Reading `voice.ts` reveals it was explicitly designed for a server-side voice agent. The file header documents events from an "Agent" client (`voice:audio_start`, `voice:audio_chunk`, `voice:audio_end`) and events back to the agent (`voice:tts_chunk`, `voice:tts_done`, `voice:listening`). The protocol is fully specified and implemented -- it just needs a client.

**2. Zero changes to jarvis-backend.** The entire STT -> LLM -> TTS pipeline in `voice.ts` (lines 185-426) already:
- Concatenates audio chunks into a buffer
- Sends to Whisper for transcription
- Routes the transcript through `routeMessage()` to the LLM
- Streams LLM response through `SentenceAccumulator` for progressive TTS
- Emits TTS audio chunks back over Socket.IO
- Handles session management, abort controllers, and error recovery

**3. Separation of concerns.** Audio I/O (microphone capture, speaker playback) requires ALSA device access and low-level audio processing. This belongs in a dedicated service, not crammed into the Node.js backend. Python is the right language because:
- Silero VAD and openWakeWord are Python-native (PyTorch/ONNX)
- PyAlsaAudio provides clean ALSA bindings
- The `python-socketio` library connects cleanly to Socket.IO servers
- All audio ML models (VAD, wake word) have first-class Python support

**4. Host-level systemd service, not Docker.** The daemon needs direct ALSA hardware access. While Docker can pass through `/dev/snd`, it adds complexity with no benefit:
- Docker device passthrough has known permission bugs (moby #36457)
- SOF driver creates/removes devices dynamically on suspend/resume; Docker mappings break
- Only one process should open ALSA devices -- a host service avoids container scheduling conflicts
- Consistent with how `jarvis-api` (llama-server) already runs on the host as a systemd service

---

## Component Boundaries

| Component | Responsibility | Communicates With | Changes Needed |
|-----------|---------------|-------------------|----------------|
| **jarvis-ear** (NEW) | Audio capture, VAD, wake word, speaker playback | jarvis-backend via Socket.IO /voice | New systemd service + Python venv |
| **jarvis-backend** (EXISTING) | Voice session management, STT routing, LLM pipeline, TTS orchestration | jarvis-whisper, LLM providers, TTS services | **None** -- /voice namespace already handles the protocol |
| **jarvis-whisper** (EXISTING) | Speech-to-text transcription | Receives audio from jarvis-backend | **None** |
| **jarvis-tts / jarvis-piper** (EXISTING) | Text-to-speech synthesis | Receives text from jarvis-backend | **None** |
| **Docker Compose** (EXISTING) | Orchestrates backend + TTS + Whisper + other services | All Docker services | **None** -- jarvis-ear runs outside Docker |
| **Host ALSA** (EXISTING) | Audio device layer | jarvis-ear (direct access) | Needs reboot + possible USB mic |

### What Is New vs What Is Reused

| Capability | Status | Notes |
|-----------|--------|-------|
| Audio capture from mic | **NEW** | ALSA capture in jarvis-ear (pyalsaaudio) |
| Voice Activity Detection | **NEW** | Silero VAD in jarvis-ear (ONNX) |
| Wake word detection | **NEW** | openWakeWord in jarvis-ear |
| Audio -> Socket.IO streaming | **NEW** | python-socketio client in jarvis-ear |
| Socket.IO /voice protocol | **REUSED** | Already fully implemented in voice.ts |
| Audio chunk concatenation | **REUSED** | voice.ts lines 200-203 |
| Whisper STT integration | **REUSED** | voice.ts -> stt.ts -> jarvis-whisper |
| LLM routing and processing | **REUSED** | voice.ts -> router.ts -> providers |
| TTS sentence streaming | **REUSED** | voice.ts -> SentenceAccumulator -> tts.ts |
| TTS audio chunk emission | **REUSED** | voice.ts lines 296-325 |
| Speaker audio playback | **NEW** | ALSA playback in jarvis-ear |
| JWT auth for Socket.IO | **REUSED** | socket.ts auth middleware |

---

## Data Flow: Complete Voice Interaction

### Phase 1: Idle Listening (continuous, low CPU)

```
Host Mic -> ALSA capture (16kHz, 16-bit, mono)
         -> 30ms frames fed to openWakeWord
         -> Low CPU (~0.5% single core for wake word detection)
         -> Waiting for "Jarvis" trigger
```

### Phase 2: Wake Word Detected -> Audio Capture

```
openWakeWord detects "Jarvis" (confidence > threshold)
  |
  +-> jarvis-ear emits Socket.IO: voice:audio_start { agentId: "ear-home" }
  |
  +-> Switch from wake word mode to VAD capture mode
  |
  +-> Silero VAD processes each 30ms frame:
      - Speech detected: accumulate audio, reset silence timer
      - Silence detected: increment silence timer
      - Every 500ms of accumulated audio:
          jarvis-ear emits: voice:audio_chunk { agentId, audio: base64(WAV), seq }
  |
  +-> Silence exceeds threshold (1.5-2s) OR max duration (30s):
      jarvis-ear emits: voice:audio_end { agentId }
```

### Phase 3: Backend Processing (existing pipeline, zero changes)

```
jarvis-backend /voice namespace receives voice:audio_end
  |
  +-> processVoiceSession() (voice.ts line 185)
  |   +-> Concatenate audio chunks
  |   +-> transcribeAudio() -> jarvis-whisper:5051/transcribe
  |   +-> Emit voice:transcript { text }
  |   +-> routeMessage(transcript) -> LLM provider selection
  |   +-> Emit voice:thinking { provider }
  |   +-> provider.chat() with streaming callbacks
  |       +-> SentenceAccumulator detects sentence boundaries
  |       +-> Each sentence -> synthesizeSentenceWithFallback()
  |           +-> XTTS (primary) or Piper (fallback)
  |       +-> Emit voice:tts_chunk { index, contentType, audio }
  |   +-> On completion: emit voice:tts_done { totalChunks }
  |   +-> Emit voice:listening (ready for next wake word)
```

### Phase 4: Speaker Playback (jarvis-ear)

```
jarvis-ear receives voice:tts_chunk events
  |
  +-> Decode base64 audio to buffer
  +-> Queue chunks by index (may arrive out of order due to parallel TTS)
  +-> Play sequentially to ALSA output device
  +-> On voice:tts_done: drain queue, return to idle listening
```

---

## New Component: jarvis-ear

### Internal Architecture

```
/opt/jarvis-ear/
  |-- server.py           # Main entry point and state machine
  |-- config.py           # Environment-based configuration
  |-- audio/
  |   |-- capture.py      # ALSA microphone capture (PyAlsaAudio)
  |   |-- playback.py     # ALSA speaker output
  |   +-- vad.py          # Silero VAD wrapper
  |-- wake/
  |   +-- detector.py     # openWakeWord integration
  |-- transport/
  |   +-- socketio_client.py  # python-socketio connection to backend
  |-- venv/               # Python virtual environment
  +-- sounds/
      +-- chime.wav        # Wake word confirmation chime
```

### State Machine

```
                     +------------+
                     |            |
              +----->|   IDLE     |<---------+
              |      | (wake word |          |
              |      |  listening)|          |
              |      +-----+------+          |
              |            |                 |
              |     wake word detected       |
              |            |                 |
              |      +-----v------+          |
              |      |            |          |
              |      | CAPTURING  |          |
              |      | (VAD +     |     voice:listening
              |      |  audio     |     received
              |      |  chunks)   |          |
              |      +-----+------+          |
              |            |                 |
              |     silence / max duration   |
              |            |                 |
              |      +-----v------+          |
              |      |            |          |
              |      | PROCESSING |          |
              |      | (waiting   |          |
  abort/error |      |  for STT + |          |
              |      |  LLM)      |          |
              |      +-----+------+          |
              |            |                 |
              |     voice:tts_chunk          |
              |            |                 |
              |      +-----v------+          |
              |      |            |          |
              +------+ SPEAKING   +----------+
                     | (playing   |
                     |  TTS audio)|
                     |  mic MUTED |
                     +------------+
```

Note: During SPEAKING state, microphone processing is paused (not hardware muted -- the capture thread continues but frames are discarded). This prevents the echo/feedback loop pitfall where Jarvis transcribes its own TTS output.

### Systemd Service Unit

```ini
# /etc/systemd/system/jarvis-ear.service
[Unit]
Description=Jarvis Ear - Always-On Voice Capture Daemon
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/jarvis-ear/venv/bin/python /opt/jarvis-ear/server.py
WorkingDirectory=/opt/jarvis-ear
Restart=always
RestartSec=5
EnvironmentFile=/opt/jarvis-ear/.env
User=root
Group=audio
CPUAffinity=18 19

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jarvis-ear

[Install]
WantedBy=multi-user.target
```

### Environment Configuration (.env)

```bash
# /opt/jarvis-ear/.env
BACKEND_URL=http://localhost:4000
AGENT_ID=ear-home
WAKE_WORD=hey_jarvis
WAKE_THRESHOLD=0.5
VAD_THRESHOLD=0.5
SILENCE_TIMEOUT_MS=1500
MAX_RECORDING_MS=30000
SAMPLE_RATE=16000
ALSA_CAPTURE_DEVICE=default
ALSA_PLAYBACK_DEVICE=default
JARVIS_PASSWORD=<from /root/.env>
POST_PLAYBACK_SILENCE_MS=500
```

---

## Hardware Reality: Audio Device Situation

### Current State (verified 2026-02-25)

| Finding | Details |
|---------|---------|
| Intel HDA Audio | Raptor Lake High Definition Audio Controller at 0000:00:1f.3 |
| SOF Driver | `sof-audio-pci-intel-tgl` detected, but probe **failed** |
| Failure Reason | `init of i915 and HDMI codec failed` -- Proxmox doesn't load i915 by default |
| NVIDIA HDA | Card 0: HDA NVidia -- HDMI output only, no capture |
| Capture Devices | **Zero** -- `arecord -l` shows no capture hardware |
| Playback Devices | 4x HDMI outputs on NVIDIA card (cards 0 devices 3,7,8,9) |
| SOF Firmware | Present in `/lib/firmware/intel/sof/` (sof-rpl.ri for Raptor Lake) |
| Digital Mics | Detected at boot: `Digital mics found on Skylake+ platform, using SOF driver` |

### Path Forward: Two Options

**Option A: USB Microphone (RECOMMENDED -- pragmatic, reliable)**

A USB microphone (e.g., ReSpeaker USB Mic Array, or any USB condenser mic) will:
- Appear immediately as an ALSA capture device without kernel changes
- Work reliably with direct ALSA access
- Not require a Proxmox host reboot
- Cost $20-50 for a quality USB mic with built-in ADC

For output, use the NVIDIA HDMI output (already working at hw:0,3) or a USB speaker/DAC.

**Option B: Fix Intel SOF DMIC (requires reboot + kernel config)**

The digital mics are physically present but the SOF driver fails because:
1. i915 (Intel GPU driver) is not loaded on Proxmox
2. SOF HDA codec initialization depends on i915 for HDMI audio
3. Possible fix: Add `snd_intel_dspcfg.dsp_driver=3` kernel parameter to force SOF
4. Or load i915 module: add `options i915 modeset=1` to `/etc/modprobe.d/`
5. **Requires reboot** to take effect

Risk: On a Proxmox host, loading i915 may conflict with GPU passthrough or consume GPU resources.

### Recommendation

Start with **Option A (USB mic)** for Phase 1. It is zero-risk, immediately testable, and does not require a Proxmox reboot. The architecture supports both options -- only the `ALSA_CAPTURE_DEVICE` environment variable changes.

---

## Authentication Flow

The jarvis-ear daemon needs to authenticate with the Socket.IO server. The backend uses JWT authentication for all namespaces (see `socket.ts` lines 30-53).

```python
# Jarvis-ear authentication flow:
# 1. POST /api/login { password: JARVIS_PASSWORD } -> { token: JWT }
# 2. Connect Socket.IO with auth: { token: JWT }
# 3. Reconnect with fresh token on expiry

import socketio
import requests

sio = socketio.Client()

def get_auth_token():
    resp = requests.post(f"{BACKEND_URL}/api/login",
                         json={"password": JARVIS_PASSWORD})
    return resp.json()["token"]

token = get_auth_token()
sio.connect(f"{BACKEND_URL}/voice",
            auth={"token": token},
            transports=["websocket"])
```

---

## Patterns to Follow

### Pattern 1: Socket.IO Event Protocol (match existing voice.ts)

The jarvis-ear daemon MUST emit events in the exact format that `voice.ts` expects.

**What:** Use the documented event protocol from voice.ts header comments.
**When:** All communication between jarvis-ear and backend.
**Example:**

```python
# Start capture (wake word detected)
sio.emit("voice:audio_start", {"agentId": AGENT_ID})

# Send audio chunks (500ms WAV segments, base64 encoded)
sio.emit("voice:audio_chunk", {
    "agentId": AGENT_ID,
    "audio": base64.b64encode(wav_chunk).decode(),
    "seq": chunk_sequence
})

# End capture (silence detected)
sio.emit("voice:audio_end", {"agentId": AGENT_ID})
```

### Pattern 2: WAV Format for Whisper Compatibility

**What:** Audio chunks must be valid WAV format (16kHz, 16-bit, mono) because stt.ts sends them to Whisper with `contentType: 'audio/wav'`.
**When:** Every audio chunk emitted to the backend.
**Why:** The Whisper container expects WAV input. The backend concatenates raw buffers (`Buffer.concat(session.audioChunks)`) and sends as-is to Whisper.

**Critical detail:** Since voice.ts concatenates individual WAV chunks by simple `Buffer.concat`, the jarvis-ear daemon should either:
- Send raw PCM data (no WAV headers in chunks) and let the backend add a single header, OR
- Send the first chunk with a WAV header and subsequent chunks as raw PCM

Looking at `voice.ts` closely, it concatenates all buffers and sends to Whisper as a single blob. Whisper's `faster-whisper` library uses ffmpeg internally to decode audio, which handles concatenated WAV files gracefully. The safest approach: **send each chunk as a complete WAV file** -- Whisper/ffmpeg handles the multi-header situation without issues.

### Pattern 3: Bounded Audio Queue for Playback

**What:** Maintain an ordered queue for TTS chunks since they may arrive out of order due to parallel TTS synthesis.
**When:** Receiving `voice:tts_chunk` events.
**Example:**

```python
class AudioPlaybackQueue:
    def __init__(self):
        self.chunks = {}  # index -> audio_bytes
        self.next_index = 0
        self.total_expected = None

    def add_chunk(self, index, audio_bytes):
        self.chunks[index] = audio_bytes
        self._drain()

    def set_total(self, total):
        self.total_expected = total
        self._drain()

    def _drain(self):
        while self.next_index in self.chunks:
            play_audio(self.chunks.pop(self.next_index))
            self.next_index += 1
```

### Pattern 4: Pre-roll Buffer for Wake Word Context

**What:** Keep a rolling 500ms pre-roll buffer so the beginning of the user's speech (right after "Jarvis") is not lost.
**When:** Always, during idle wake word listening.
**Why:** The user often speaks immediately after the wake word: "Jarvis, what's the cluster status?" Without pre-roll, "what's" might be cut off.

```python
from collections import deque

# Keep 500ms of audio before wake word trigger
FRAME_SIZE = 480  # 30ms at 16kHz
PRE_ROLL_FRAMES = int(0.5 * 16000 / FRAME_SIZE)  # ~16 frames
pre_roll_buffer = deque(maxlen=PRE_ROLL_FRAMES)

while in_idle_state:
    frame = capture_audio_frame()
    pre_roll_buffer.append(frame)

    if wake_word_detected(frame):
        # Include pre-roll audio in the capture session
        audio_buffer = b"".join(pre_roll_buffer)
        transition_to_capturing(audio_buffer)
```

### Pattern 5: Mic Mute During TTS Playback (Echo Prevention)

**What:** Stop processing captured audio frames while TTS is playing through the speaker.
**When:** Transition to SPEAKING state; resume on IDLE transition.
**Why:** Prevents the most dangerous failure mode: Jarvis transcribing its own TTS output and creating an infinite feedback loop.

```python
class VoiceAgent:
    def __init__(self):
        self.state = "IDLE"
        self.process_audio = True  # Flag checked by capture thread

    def on_tts_chunk(self, data):
        self.state = "SPEAKING"
        self.process_audio = False  # Mute audio processing
        self.playback_queue.add_chunk(data["index"], data["audio"])

    def on_tts_done(self, data):
        self.playback_queue.drain()
        # Wait for post-playback silence (room reverb)
        time.sleep(POST_PLAYBACK_SILENCE_MS / 1000)
        self.process_audio = True  # Resume audio processing
        self.state = "IDLE"
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Putting Audio Capture in jarvis-backend

**What:** Adding ALSA capture or PyAudio to the Node.js backend container.
**Why bad:**
- Node.js has poor native ALSA support (npm packages are unmaintained C++ bindings)
- Mixes concerns: backend handles routing/LLM/TTS orchestration, not hardware I/O
- Python has far better audio ML ecosystem (Silero VAD, openWakeWord, PyAlsaAudio)
- Would require adding `/dev/snd` device access to the backend container (security concern)
**Instead:** Separate jarvis-ear service that connects as a Socket.IO client.

### Anti-Pattern 2: Running Wake Word + VAD on Backend

**What:** Streaming raw audio from mic to backend, let backend detect wake words.
**Why bad:**
- Continuous streaming of 16kHz audio wastes network bandwidth (32KB/s)
- Backend would need Python ML dependencies (PyTorch, ONNX) mixed with Node.js
- Latency: round-trip through network adds delay to wake word response
- CPU waste: backend processes audio that is 95%+ silence
**Instead:** Wake word + VAD run locally in jarvis-ear, only speech segments are sent.

### Anti-Pattern 3: Running Audio Daemon in Docker

**What:** Containerizing the audio capture daemon with `--device /dev/snd`.
**Why bad:**
- Docker device passthrough has known permission bugs (moby issue #36457)
- SOF driver creates/removes ALSA devices dynamically on suspend/resume; container device mappings break
- Only one process should open ALSA hardware devices; Docker adds scheduling complexity
- No benefit from containerization for a host-level hardware service
**Instead:** Run as systemd service on the host. Communicate with Docker backend via Socket.IO over localhost:4000.

### Anti-Pattern 4: Modifying voice.ts to Handle Wake Words

**What:** Adding "Jarvis" keyword detection in voice.ts after transcription.
**Why bad:**
- Wastes Whisper processing on every silence/noise segment
- The existing protocol assumes wake word is already detected (client-side)
- Transcript-based detection has 2-5s latency (capture + STT) vs 30ms for dedicated detector
**Instead:** openWakeWord in jarvis-ear detects "Jarvis" in real-time at 30ms latency.

### Anti-Pattern 5: Skipping the "Jarvis" Wake Word Check

**What:** Using only VAD (speech detection) without wake word, sending all detected speech to the LLM.
**Why bad:**
- Every conversation in the room triggers Jarvis (TV, phone calls, visitors)
- Wastes Whisper and LLM compute on irrelevant speech
- Privacy concern: all speech gets transcribed
- The `/voice` protocol's `voice:audio_start` event semantically means "wake word detected"
**Instead:** Two-stage detection: openWakeWord (always-on, ultra-low CPU) gates Silero VAD (speech capture).

---

## Integration Points: Detailed Analysis

### Integration Point 1: Socket.IO /voice Namespace

**Status:** Already fully implemented in voice.ts. No modifications needed.
**Connection:** jarvis-ear connects as a Socket.IO client to `ws://localhost:4000/voice`
**Auth:** JWT token obtained via `POST /api/login`
**Protocol:** Fully documented in voice.ts header (lines 1-23)

### Integration Point 2: JWT Authentication

**Status:** Already implemented in socket.ts.
**Requirement:** jarvis-ear needs access to `JARVIS_PASSWORD` to obtain JWT token.
**Implementation:** HTTP POST to `/api/login` endpoint, then pass token in Socket.IO handshake.
**Token refresh:** Implement reconnection with fresh token when JWT expires.

### Integration Point 3: Events Namespace (Dashboard Updates)

**Status:** Already wired in voice.ts (line 393-401). When voice commands process, events are emitted to `/events` namespace automatically. Dashboard will show voice command activity without any changes.

### Integration Point 4: Network Communication

**Status:** jarvis-backend exposes port 4000 on localhost via Docker port mapping.
**Requirement:** jarvis-ear (running on host) connects to `localhost:4000`.
**Protocol:** Socket.IO over WebSocket transport. Same as browser frontend.
**Reconnection:** python-socketio has built-in exponential backoff reconnection.

### Integration Point 5: TTS Audio Format

**Status:** TTS output format depends on configuration:
- Default: WAV (audio/wav) from XTTS or Piper
- Optional: Opus (audio/opus) if `OPUS_ENABLED=true`
**Requirement:** jarvis-ear must handle both formats for ALSA playback.
- WAV: Play directly via ALSA (strip 44-byte header, feed PCM to device)
- Opus: Decode first using `opuslib` Python library, then play PCM

---

## Scalability Considerations

| Concern | Current (1 mic) | Future (multi-room) | Notes |
|---------|-----------------|---------------------|-------|
| Audio capture | 1 jarvis-ear on Home node | 1 daemon per node with mic | Each daemon gets unique agentId (ear-home, ear-kitchen, etc) |
| Wake word CPU | ~0.5% single core | Same per instance | openWakeWord is extremely lightweight |
| VAD CPU | ~0.4% during speech | Same per instance | Silero VAD sub-millisecond per frame |
| Whisper concurrency | 1 session at a time | Needs queue or multiple Whisper instances | Current Whisper has single-model bottleneck |
| TTS concurrency | Already handles parallel synthesis | No change needed | Existing bounded queue in voice.ts |
| Speaker output | HDMI or USB on Home node | Different ALSA devices per node | ALSA_PLAYBACK_DEVICE config per daemon |
| Socket.IO connections | 1 persistent connection | N connections (one per daemon) | voice.ts already uses agentId to track sessions |

---

## Suggested Build Order

The build order is driven by dependency chains and testability at each step.

### Phase 1: Audio Hardware Foundation (no network, no ML)
1. Install `alsa-ucm-conf`, reboot Home node
2. Verify SOF audio card appears; if not, plug in USB mic as fallback
3. Set up `/opt/jarvis-ear/` directory with Python venv
4. Test ALSA capture: record audio from microphone to WAV file
5. Test ALSA playback: play WAV file to speakers
6. Configure `/etc/asound.conf` with dmix/dsnoop if needed

**Test:** Record 5s audio, play it back. Round-trip audio works.

### Phase 2: Wake Word + VAD (local ML, no network)
7. Integrate openWakeWord with "hey_jarvis" pre-trained model
8. Integrate Silero VAD for speech boundary detection
9. Implement state machine: IDLE -> CAPTURING -> back to IDLE
10. Add pre-roll buffer for speech context (500ms)

**Test:** Say "Hey Jarvis, hello world" -- daemon logs wake word detection, captures speech segment, logs VAD boundaries.

### Phase 3: Backend Connection (network, auth)
11. Implement Socket.IO client with JWT auth (login to localhost:4000)
12. Emit `voice:audio_start/chunk/end` events matching voice.ts protocol
13. Handle `voice:listening` event to know when backend is ready
14. Implement auto-reconnection on backend restart

**Test:** Say "Hey Jarvis, what time is it?" -- daemon sends audio to backend, backend transcribes, LLM responds (visible in backend logs).

### Phase 4: Speaker Output + Complete Loop
15. Handle `voice:tts_chunk` events with ordered playback queue
16. Handle `voice:tts_done` to drain queue and return to IDLE
17. Implement mic mute during TTS playback (echo prevention)
18. Add post-playback silence window (500ms)
19. Add wake word confirmation chime

**Test:** Say "Hey Jarvis, how's the cluster?" -- hear Jarvis voice response through speakers. Full loop complete.

### Phase 5: Reliability + Service Management
20. Create systemd service unit with Restart=always
21. Implement graceful degradation (backend down, Whisper down, TTS down)
22. Add status logging and health reporting via Socket.IO
23. Make thresholds configurable via .env file

**Test:** Kill and restart backend -- jarvis-ear reconnects and resumes. `systemctl restart jarvis-ear` works cleanly.

---

## Key Technical Decisions

### Decision 1: openWakeWord over Porcupine

**Choose openWakeWord** because:
- Fully open source (Apache 2.0), no API keys, no vendor lock-in
- Ships with pre-trained "hey_jarvis" model
- Runs 15-20 models simultaneously on a single Raspberry Pi core
- ~200KB ONNX model, negligible memory footprint
- Already used by Home Assistant voice pipeline

Porcupine has a built-in "Jarvis" model but requires API key and has usage limits on the free tier.

### Decision 2: Silero VAD over WebRTC VAD

**Choose Silero VAD** because:
- MIT licensed, no vendor lock
- Better accuracy than WebRTC VAD across noise conditions (87.7% TPR at 5% FPR)
- ~0.4% CPU for real-time processing (measured RTF of 0.004 on AMD CPU)
- 16kHz support matches Whisper's expected input
- ONNX runtime -- same as openWakeWord, shared dependency

### Decision 3: Python over Node.js for Voice Agent

**Choose Python** because:
- Silero VAD: Python-native (PyTorch/ONNX)
- openWakeWord: Python-only library
- PyAlsaAudio: Mature, maintained ALSA bindings
- python-socketio: Well-tested Socket.IO client
- All the ML inference libraries are Python-first

Node.js alternatives exist (node-alsa-capture, @picovoice/porcupine-node) but are less maintained and have fewer options for VAD.

### Decision 4: Systemd Service over Docker Container

**Choose systemd service** because:
- Direct ALSA hardware access without device passthrough complexity
- No Docker permission issues with `/dev/snd` device nodes
- Survives host suspend/resume (Docker device mappings break on hot-plug)
- Consistent with how `jarvis-api` (llama-server) already runs on the host
- Hardware I/O services belong at the OS level, not containerized
- CPUAffinity directive provides dedicated core allocation

### Decision 5: USB Microphone for Initial Deployment

**Choose USB mic** because:
- Zero kernel configuration changes needed
- No Proxmox host reboot required
- Immediately available as ALSA capture device
- Intel SOF DMIC can be pursued later as an optimization
- The `ALSA_CAPTURE_DEVICE` env var makes switching trivial

---

## Sources

### Official Documentation / Verified Sources
- [Silero VAD GitHub](https://github.com/snakers4/silero-vad) -- VAD model, MIT license, performance benchmarks
- [openWakeWord GitHub](https://github.com/dscripka/openWakeWord) -- Wake word detection, Apache 2.0
- [PyAlsaAudio Documentation](https://larsimmisch.github.io/pyalsaaudio/pyalsaaudio.html) -- ALSA Python bindings
- [python-socketio](https://github.com/miguelgrinberg/python-socketio) -- Socket.IO client for Python
- [SOF Project Documentation](https://thesofproject.github.io/latest/architectures/host/linux_driver/architecture/sof_driver_arch.html) -- Intel SOF firmware architecture
- [Porcupine Wake Word](https://picovoice.ai/platform/porcupine/) -- Commercial alternative (built-in "Jarvis" model)
- [openWakeWord Training](https://openwakeword.com/) -- Custom wake word training in under an hour

### Codebase Analysis (PRIMARY source, HIGH confidence)
- `/root/jarvis-backend/src/realtime/voice.ts` -- Existing /voice namespace with full agent protocol
- `/root/jarvis-backend/src/realtime/socket.ts` -- Socket.IO setup and JWT auth middleware
- `/root/jarvis-backend/src/ai/stt.ts` -- Whisper STT client
- `/root/jarvis-backend/src/ai/tts.ts` -- TTS with XTTS/Piper fallback chain
- `/root/jarvis-backend/src/ai/sentence-stream.ts` -- Sentence boundary detection for progressive TTS
- `/root/jarvis-backend/src/config.ts` -- Voice configuration (silence timeout, max recording)
- `/root/docker-compose.yml` -- Existing service orchestration (7 services)
- `/root/jarvis-whisper/server.py` -- Whisper FastAPI server (WAV input, VAD filter built-in)

### Hardware Verification (verified on host 2026-02-25)
- `arecord -l` -- No capture devices available
- `aplay -l` -- NVIDIA HDMI outputs only (card 0 devices 3,7,8,9)
- `lsmod | grep sof` -- SOF modules loaded but probe failed
- `dmesg` -- "Digital mics found... using SOF driver" but "init of i915 and HDMI codec failed"
- `lspci` -- Intel Raptor Lake HDA + NVIDIA AD107 HDA confirmed
- `/lib/firmware/intel/sof/sof-rpl.ri` -- Raptor Lake firmware present
- `/dev/snd/` -- Only NVIDIA HDMI devices, no capture (pcmC0D3p, pcmC0D7p, pcmC0D8p, pcmC0D9p)

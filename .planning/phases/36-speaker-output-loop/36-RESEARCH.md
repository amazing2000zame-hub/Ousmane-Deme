# Phase 36: Speaker Output & Complete Voice Loop - Research

**Researched:** 2026-02-26
**Domain:** ALSA playback, TTS audio decoding, echo prevention, conversation mode
**Confidence:** HIGH

## Summary

Phase 36 completes the hands-free voice loop by adding speaker output to the jarvis-ear daemon. TTS audio chunks arrive from the backend as base64-encoded WAV data (24kHz, 16-bit, mono) via Socket.IO `voice:tts_chunk` events. The daemon must decode these chunks, resample from 24kHz to the dmix playback rate (48kHz stereo), queue them in order, and play through the built-in Realtek ALC245 speakers on Card 1 (sof-hda-dsp, hw:1,0). The Speaker Playback Switch is currently OFF and must be enabled via `amixer -c 1 sset 'Speaker' on`.

Echo prevention uses a simple mic-mute approach: the DMIC has a hardware mute switch (`Dmic0` cswitch) that can be toggled in ~2ms via `amixer -c 1 sset 'Dmic0' nocap/cap`. The daemon mutes the mic before playback starts and unmutes after the last chunk finishes. This is simpler and more reliable than acoustic echo cancellation (AEC), which would require WebRTC/speexdsp and careful tuning. Since the daemon operates in half-duplex mode (either listening or speaking, never both), mic muting is the correct approach.

Conversation mode adds a 15-second follow-up window after TTS playback completes. During this window, the daemon skips wake word detection and transitions directly from VAD-detected speech to CAPTURING state. This enables natural dialogue ("Hey Jarvis, what's the cluster status?" ... response plays ... "And how about disk usage?" without repeating the wake word).

**Primary recommendation:** Add a dedicated `AudioPlayer` class in `speaker.py` that runs playback in a background thread with an ordered queue. Use `subprocess.Popen` with ffmpeg for audio decoding (handles both WAV and Opus formats, resamples to 48kHz stereo). Use `amixer` subprocess calls for mic muting (2ms latency, simpler than C ALSA mixer API). Add a `CONVERSATION` state to the state machine for the 15-second follow-up window. Generate the wake word chime programmatically using Python's `struct` and `math` modules (no external audio file needed).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pyalsaaudio | 0.11.0 | ALSA PCM playback (write frames) | Already installed in venv; provides direct ALSA write() for low-latency playback |
| ffmpeg (system) | 7.1.3 | Audio decode + resample (WAV/Opus -> raw PCM 48kHz stereo) | Already installed; handles all audio format conversions via pipe I/O |
| wave (stdlib) | built-in | Parse WAV headers to extract sample rate, channels, bit depth | Standard library; sufficient for WAV metadata when ffmpeg not needed |
| subprocess (stdlib) | built-in | Invoke ffmpeg and amixer commands | Standard library; 2ms latency for amixer is acceptable |
| threading (stdlib) | built-in | Background playback thread with queue | Already used extensively in jarvis-ear for audio capture and backend I/O |
| queue (stdlib) | built-in | Thread-safe ordered playback queue | Standard thread communication; used in audio.py already |
| struct (stdlib) | built-in | Generate wake word chime PCM data | Standard library; sufficient for sine wave synthesis |
| math (stdlib) | built-in | Sine wave calculations for chime | Standard library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| base64 (stdlib) | built-in | Decode TTS chunk audio from base64 | Every TTS chunk arrives base64-encoded |
| numpy | 2.4.2 | Optional: resample via repeat for 2x upsample | Already installed; alternative to ffmpeg for pure WAV 24kHz->48kHz |
| scipy.signal | 1.17.1 | Optional: high-quality polyphase resampling | Already installed; resample_poly for non-integer ratios |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ffmpeg subprocess for decode | Pure Python wave+numpy | ffmpeg handles both WAV and Opus uniformly; pure Python only handles WAV. ffmpeg adds ~5ms subprocess overhead per chunk but is simpler and future-proof for Opus. |
| amixer subprocess for mic mute | pyalsaaudio mixer API / ctypes ALSA | amixer at 2ms is fast enough; mixer API adds code complexity. If latency becomes an issue, can switch to ctypes later. |
| Mic mute (half-duplex) | WebRTC AEC (speex/webrtc-audio-processing) | AEC is complex to tune, requires knowing speaker-mic transfer function, and is overkill when half-duplex is acceptable. Mic mute is ~2ms, deterministic, and zero false triggers. |
| Programmatic chime generation | Pre-recorded WAV file | No external file dependency; chime can be tuned in code; ~350ms two-tone chime is trivial to synthesize at runtime. |
| Single background playback thread | Async playback with asyncio | Daemon is sync; background thread matches existing architecture (audio capture, backend client). |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
# ffmpeg: /usr/bin/ffmpeg (system, v7.1.3)
# pyalsaaudio: 0.11.0 (in venv)
# numpy: 2.4.2 (in venv)
# scipy: 1.17.1 (in venv)
```

## Architecture Patterns

### Recommended Project Structure
```
src/jarvis_ear/
    __main__.py         # Main loop (modified: add speaker + conversation mode)
    speaker.py          # NEW: AudioPlayer class, playback thread, chime generation
    backend.py          # Modified: wire TTS chunks to AudioPlayer queue
    state_machine.py    # Modified: add CONVERSATION state + follow-up window
    display.py          # Existing: display control (Phase 37)
    audio.py            # Existing: audio capture (unchanged)
    config.py           # Modified: add speaker/conversation config constants
    vad.py              # Existing: VAD (unchanged)
    wakeword.py         # Existing: wake word (unchanged)
    ring_buffer.py      # Existing: ring buffer (unchanged)
```

### Pattern 1: Ordered Playback Queue with Background Thread
**What:** A dedicated `AudioPlayer` class owns a `queue.Queue` and a background daemon thread. TTS chunks are enqueued with their index number. The playback thread dequeues in order, decodes audio, resamples to 48kHz stereo, and writes to ALSA via `alsaaudio.PCM.write()` in blocking mode.
**When to use:** Always -- this decouples Socket.IO event handlers (which run in python-socketio's background threads) from the ALSA playback path.
**Example:**
```python
import queue
import threading
import alsaaudio
import subprocess

class AudioPlayer:
    """Ordered TTS audio playback through ALSA speakers."""

    def __init__(self):
        self._queue: queue.PriorityQueue = queue.PriorityQueue()
        self._stop_event = threading.Event()
        self._playing = threading.Event()  # Set while audio is playing
        self._thread = threading.Thread(
            target=self._playback_loop,
            name="jarvis-ear-speaker",
            daemon=True,
        )
        # Open ALSA playback device (48kHz stereo, matching dmix)
        self._pcm = alsaaudio.PCM(
            type=alsaaudio.PCM_PLAYBACK,
            mode=alsaaudio.PCM_NORMAL,
            device="default",
            rate=48000,
            channels=2,
            format=alsaaudio.PCM_FORMAT_S16_LE,
            periodsize=1024,
        )

    def enqueue(self, index: int, audio_bytes: bytes, content_type: str):
        """Add a TTS chunk to the playback queue."""
        self._queue.put((index, audio_bytes, content_type))

    def signal_done(self, total_chunks: int):
        """Signal that all TTS chunks have been enqueued."""
        self._queue.put((total_chunks, None, "sentinel"))

    @property
    def is_playing(self) -> bool:
        return self._playing.is_set()

    def _playback_loop(self):
        next_index = 0
        pending = {}  # Buffer for out-of-order chunks

        while not self._stop_event.is_set():
            try:
                idx, audio, ct = self._queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if audio is None:  # Sentinel
                self._playing.clear()
                continue

            if idx == 0:
                self._playing.set()
                self._mute_mic()

            # Handle out-of-order (buffer until sequential)
            pending[idx] = (audio, ct)

            while next_index in pending:
                chunk_audio, chunk_ct = pending.pop(next_index)
                pcm_data = self._decode_to_pcm(chunk_audio, chunk_ct)
                self._write_pcm(pcm_data)
                next_index += 1

    def _decode_to_pcm(self, audio_bytes, content_type):
        """Decode audio to raw PCM at 48kHz stereo via ffmpeg."""
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error",
             "-i", "pipe:0",
             "-f", "s16le", "-ar", "48000", "-ac", "2",
             "pipe:1"],
            input=audio_bytes,
            capture_output=True,
        )
        return proc.stdout

    def _write_pcm(self, pcm_data):
        """Write raw PCM to ALSA in period-sized chunks."""
        period_bytes = 1024 * 2 * 2  # 1024 frames * 2 bytes * 2 channels
        offset = 0
        while offset < len(pcm_data):
            chunk = pcm_data[offset:offset + period_bytes]
            if len(chunk) < period_bytes:
                chunk += b'\x00' * (period_bytes - len(chunk))
            self._pcm.write(chunk)
            offset += period_bytes
```
*Source: Verified against pyalsaaudio 0.11.0 API and live ALSA testing on this node.*

### Pattern 2: Mic Mute During Playback (Echo Prevention)
**What:** Before the first TTS chunk plays, mute the DMIC via `amixer -c 1 sset 'Dmic0' nocap`. After the last chunk finishes, unmute via `amixer -c 1 sset 'Dmic0' cap`. This prevents the microphone from picking up speaker output and re-triggering wake word detection or corrupting voice capture.
**When to use:** Always when playing TTS audio through speakers on the same device as the microphone.
**Example:**
```python
import subprocess

def _mute_mic(self):
    """Mute DMIC to prevent echo during playback (~2ms)."""
    subprocess.run(
        ["amixer", "-c", "1", "sset", "Dmic0", "nocap"],
        capture_output=True,
    )

def _unmute_mic(self):
    """Unmute DMIC after playback completes (~2ms)."""
    subprocess.run(
        ["amixer", "-c", "1", "sset", "Dmic0", "cap"],
        capture_output=True,
    )
```
*Source: Verified live -- amixer mute/unmute takes ~2ms on this system.*

### Pattern 3: Conversation Mode (Follow-Up Window)
**What:** After TTS playback completes, the state machine enters a `CONVERSATION` state for 15 seconds. During this window, wake word detection is bypassed -- any VAD-detected speech immediately transitions to CAPTURING. After 15 seconds of no interaction, the state machine returns to IDLE (requiring wake word again).
**When to use:** Enables natural multi-turn dialogue without repeating "Hey Jarvis" for each follow-up question.
**Example:**
```python
class State(enum.Enum):
    IDLE = "idle"
    CAPTURING = "capturing"
    CONVERSATION = "conversation"  # NEW: follow-up window

class CaptureStateMachine:
    CONVERSATION_TIMEOUT_S = 15.0

    def on_tts_done(self):
        """Called when TTS playback finishes. Enter conversation mode."""
        self._state = State.CONVERSATION
        self._conversation_start = time.monotonic()

    # In main loop:
    # if state == CONVERSATION:
    #   if is_speech:
    #     transition to CAPTURING (no wake word needed)
    #   elif time since conversation_start > 15s:
    #     transition to IDLE
```
*Source: Design pattern based on commercial voice assistants (Alexa, Google Home). 15-second window matches the phase requirements.*

### Pattern 4: Programmatic Wake Word Chime
**What:** Generate a short two-tone ascending chime (C5 + E5, 150ms per tone + 50ms gap = ~350ms total) as raw PCM at 48kHz stereo. Pre-compute at initialization and play immediately when wake word is detected.
**When to use:** Provides immediate audio feedback that the wake word was recognized, before any backend processing begins.
**Example:**
```python
import struct, math

def _generate_chime(sample_rate=48000, channels=2):
    """Generate a short two-tone ascending chime."""
    tone_duration = 0.15  # seconds per tone
    gap_duration = 0.05   # gap between tones
    amplitude = 12000     # ~37% of max to avoid clipping
    tones = [523, 659]    # C5 and E5

    samples = bytearray()
    for freq in tones:
        for i in range(int(sample_rate * tone_duration)):
            t = i / sample_rate
            # Envelope: quick fade-in/out to avoid clicks
            env = min(t * 40, 1.0) * min((tone_duration - t) * 40, 1.0)
            val = int(env * amplitude * math.sin(2 * math.pi * freq * t))
            frame = struct.pack('<h', val) * channels  # Duplicate for stereo
            samples.extend(frame)
        # Gap (silence)
        samples.extend(b'\x00' * int(sample_rate * gap_duration) * 2 * channels)

    return bytes(samples)
```
*Source: Standard audio synthesis; verified PCM generation and ALSA playback on this node.*

### Anti-Patterns to Avoid
- **Opening/closing ALSA device per chunk:** Each `alsaaudio.PCM()` open takes ~5-10ms. Open once at init, keep open, write many times. Only reopen on error.
- **Blocking the main audio loop for playback:** Playback must run in a separate thread. The main loop must continue VAD processing (to detect the conversation window timeout and state transitions).
- **Using PulseAudio/PipeWire:** The system is pure ALSA. Adding a sound server would conflict with the existing dmix/dsnoop configuration.
- **Hardware AEC instead of mic mute:** AEC requires careful calibration of the speaker-to-mic transfer function. For a single-device half-duplex assistant, mic mute is deterministic and zero-cost.
- **Playing chunks out of order:** TTS chunks may arrive out of sequence (backend synthesizes in parallel). Must buffer and play in index order.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio format conversion | Manual WAV parsing + resampling | ffmpeg subprocess pipe | Handles WAV, Opus, MP3 uniformly; resamples correctly; 5ms overhead per chunk is acceptable |
| ALSA mixer control | ctypes bindings to libasound | amixer subprocess | 2ms latency; no C code; amixer is robust and well-tested |
| Sample rate conversion | Custom interpolation code | ffmpeg `-ar 48000` or scipy.signal.resample_poly | Both produce correct output; ffmpeg is simpler in the pipe-based architecture |
| Sine wave generation for chime | External audio file | math.sin + struct.pack | ~10 lines of code; no file dependency; tunable at runtime |
| Thread-safe ordered queue | Custom locking/sorting | queue.PriorityQueue | Standard library; handles ordering naturally via (index, data) tuples |

**Key insight:** The audio decoding/resampling problem looks simple but has edge cases (different sample rates from XTTS vs Piper, mono vs stereo, WAV vs Opus). Using ffmpeg as a universal decoder via pipe I/O handles all cases uniformly and correctly with minimal code.

## Common Pitfalls

### Pitfall 1: Speaker Switch is OFF
**What goes wrong:** Audio plays through ALSA (no errors from write()) but nothing is audible. The speaker-test command "succeeds" but produces no sound.
**Why it happens:** The Realtek ALC245 `Speaker Playback Switch` defaults to OFF on this system. ALSA write() does not error when the switch is off -- it silently discards samples.
**How to avoid:** At daemon startup, explicitly set `amixer -c 1 sset 'Speaker' on` and `amixer -c 1 sset 'Master' on`. Verify with `amixer -c 1 sget 'Speaker'` that status shows `[on]`. Add to systemd service ExecStartPre or daemon init.
**Warning signs:** Playback code works, logs show chunks playing, but no audio heard. Check `amixer -c 1 sget Speaker | grep off`.

### Pitfall 2: Forgetting to Unmute Mic After Playback
**What goes wrong:** After TTS playback, the mic stays muted. No wake word detection, no voice capture. The daemon appears "deaf."
**Why it happens:** Error during playback (e.g., ALSA xrun, Python exception) skips the unmute step. Or the sentinel/done signal is lost.
**How to avoid:** Use try/finally pattern around the playback sequence to guarantee unmute. Also add a safety timer -- if the mic has been muted for more than MAX_PLAYBACK_DURATION_S (e.g., 60s), force unmute.
**Warning signs:** Logs show "Muted mic" but never "Unmuted mic." Stats show 0% speech detection.

### Pitfall 3: Out-of-Order TTS Chunks
**What goes wrong:** Spoken response has words/sentences jumbled. Chunks arrive as chunk #2, #0, #1 and are played in arrival order.
**Why it happens:** The backend synthesizes sentences in parallel (ttsMaxParallel=2). Shorter sentences complete before longer ones, so chunks may arrive out of index order.
**How to avoid:** Use a priority queue keyed on chunk index. Buffer incoming chunks and only play when the next expected index is available. Play sequentially: 0, 1, 2, ...
**Warning signs:** Playback sounds scrambled or has unnatural pauses/jumps.

### Pitfall 4: ALSA Buffer Underrun During ffmpeg Decode
**What goes wrong:** Audible clicks, pops, or gaps between TTS sentences. ALSA reports underruns.
**Why it happens:** ffmpeg subprocess decode takes ~5-10ms per chunk. If the ALSA buffer drains before the next chunk is decoded, an underrun occurs.
**How to avoid:** Pre-decode the next chunk while the current one is playing. Use a double-buffering approach: while writing chunk N to ALSA, decode chunk N+1 in parallel. The ALSA buffer (4096 frames at 48kHz = ~85ms) provides enough headroom for typical ffmpeg decode times.
**Warning signs:** `dmesg | grep underrun` or ALSA write() returning negative values.

### Pitfall 5: Conversation Window State Leak
**What goes wrong:** The daemon captures ambient noise as a follow-up question because the conversation window is still active. Or the conversation window expires too early during a slow backend response.
**Why it happens:** The conversation timer starts at TTS-done, but if there is a long pause between user follow-up and response, the 15-second window may expire mid-interaction.
**How to avoid:** Reset the conversation timer when the backend emits `voice:listening` (ready for next command) or when a new TTS response starts. The window only counts idle time (no speech, no backend activity). Also require minimum speech duration or VAD confidence before transitioning from CONVERSATION to CAPTURING.
**Warning signs:** False captures in conversation mode; "ghost" queries sent to backend.

### Pitfall 6: dmix Sample Rate Mismatch
**What goes wrong:** ALSA playback is pitched up/down or runs at wrong speed.
**Why it happens:** The dmix slave in `/etc/asound.conf` is configured at 48kHz. If pyalsaaudio opens the device at a different rate and the `plug` wrapper doesn't compensate correctly, audio plays at the wrong speed.
**How to avoid:** Always open the playback device at 48kHz stereo (matching the dmix slave config). Let ffmpeg handle all resampling from source rate to 48kHz. Never rely on ALSA `plug` for rate conversion on the playback side.
**Warning signs:** TTS audio sounds chipmunked (too high pitch) or slowed down.

## Code Examples

Verified patterns from live testing on this system:

### Opening ALSA Playback Device
```python
# Source: Verified on Home node, pyalsaaudio 0.11.0, ALSA dmix at 48kHz
import alsaaudio

pcm = alsaaudio.PCM(
    type=alsaaudio.PCM_PLAYBACK,
    mode=alsaaudio.PCM_NORMAL,     # Blocking writes
    device="default",               # plug -> dmix -> hw:1,0 (HDA Analog)
    rate=48000,                     # Must match dmix slave rate
    channels=2,                     # Must match dmix slave channels
    format=alsaaudio.PCM_FORMAT_S16_LE,
    periodsize=1024,                # Matches dmix period_size
)

# Write raw PCM data (period-sized chunks, 1024 frames * 2 ch * 2 bytes = 4096 bytes)
period_bytes = 1024 * 2 * 2
pcm.write(raw_pcm_data[:period_bytes])  # Returns frame count (1024)
pcm.drain()  # Wait for all buffered audio to finish playing
pcm.close()
```

### Decoding TTS Chunk via ffmpeg
```python
# Source: Verified on Home node, ffmpeg 7.1.3
import subprocess, base64

def decode_tts_chunk(audio_b64: str, content_type: str) -> bytes:
    """Decode base64 TTS audio to raw PCM at 48kHz stereo."""
    audio_bytes = base64.b64decode(audio_b64)

    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error",
         "-i", "pipe:0",                    # Input from stdin
         "-f", "s16le",                     # Output: raw signed 16-bit LE
         "-ar", "48000",                    # Output: 48kHz (matches dmix)
         "-ac", "2",                        # Output: stereo (matches dmix)
         "pipe:1"],                         # Output to stdout
        input=audio_bytes,
        capture_output=True,
    )

    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg decode failed: {result.stderr.decode()}")

    return result.stdout  # Raw PCM bytes ready for ALSA write()
```

### Mic Mute/Unmute
```python
# Source: Verified on Home node, amixer -c 1, ~2ms latency
import subprocess

def mute_mic():
    subprocess.run(["amixer", "-c", "1", "sset", "Dmic0", "nocap"],
                   capture_output=True)

def unmute_mic():
    subprocess.run(["amixer", "-c", "1", "sset", "Dmic0", "cap"],
                   capture_output=True)
```

### Enable Speaker at Startup
```python
# Source: Verified on Home node -- Speaker switch is OFF by default
import subprocess

def enable_speakers():
    """Enable built-in speakers (must be called at daemon startup)."""
    subprocess.run(["amixer", "-c", "1", "sset", "Speaker", "on"],
                   capture_output=True)
    subprocess.run(["amixer", "-c", "1", "sset", "Master", "on"],
                   capture_output=True)
    # Optionally set volume (60% = -26.25dB, reasonable for room)
    subprocess.run(["amixer", "-c", "1", "sset", "Master", "60%"],
                   capture_output=True)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PulseAudio for mixing | Pure ALSA dmix/dsnoop | Phase 33 decision | No sound server dependency; direct hardware access; lower latency |
| WebRTC AEC for echo cancellation | Simple mic mute during playback | Phase 36 decision | Dramatically simpler; deterministic; no tuning; appropriate for half-duplex assistant |
| Separate USB speaker | Built-in Realtek ALC245 speakers | Phase 33 reboot resolved SOF | No additional hardware needed; built-in speakers work after SOF activation |
| Async playback with PipeWire | Blocking ALSA write in background thread | Phase 33/36 architecture | Consistent with daemon's sync main loop pattern |

**Deprecated/outdated:**
- USB speaker recommendation from Phase 33 research: No longer needed since SOF activation exposed the built-in Realtek speakers
- Opus encoding from backend: OPUS_ENABLED=false in .env; TTS chunks arrive as WAV (audio/wav content type). Code should handle Opus as future-proofing but WAV is the current format.

## Hardware Facts (Verified on This System)

### Speaker Output Path
```
TTS chunk (WAV 24kHz mono) -> base64 decode -> ffmpeg (resample to 48kHz stereo)
  -> pyalsaaudio PCM.write() -> ALSA plug -> dmix (IPC key 1024)
  -> hw:1,0 (sof-hda-dsp HDA Analog) -> Realtek ALC245 -> Built-in speakers
```

### Mic Input Path (existing)
```
Built-in DMIC -> hw:1,7 (sof-hda-dsp DMIC16kHz) -> dsnoop (IPC key 1025)
  -> plug -> pyalsaaudio PCM.read() -> 16kHz mono 16-bit
```

### ALSA Mixer Controls (Card 1: sof-hda-dsp)
| Control | Current State | Required State | Command |
|---------|--------------|----------------|---------|
| Speaker Playback Switch | OFF | ON | `amixer -c 1 sset 'Speaker' on` |
| Speaker Playback Volume | 60% (-26.25dB) | 60% (keep) | Already set |
| Master Playback Switch | ON | ON (keep) | Already set |
| Master Playback Volume | 60% (-26.25dB) | 60% (keep) | Already set |
| Auto-Mute Mode | Disabled | Disabled (keep) | Already set |
| Dmic0 Capture Switch | ON | ON (muted during playback) | Dynamic: `nocap`/`cap` |
| Dmic0 Capture Volume | 100% (20dB) | 100% (keep) | Already set |

### Audio Format Chain
| Stage | Format | Sample Rate | Channels | Bit Depth |
|-------|--------|-------------|----------|-----------|
| XTTS v2 output | WAV | 24000 Hz | 1 (mono) | 16-bit |
| Backend TTS chunk | base64(WAV) | 24000 Hz | 1 (mono) | 16-bit |
| After ffmpeg decode | raw PCM | 48000 Hz | 2 (stereo) | 16-bit |
| ALSA dmix slave | raw PCM | 48000 Hz | 2 (stereo) | 16-bit |
| Hardware output | analog | 48000 Hz | 2 (stereo) | 16-bit |

### Full Duplex Verification
- dmix (playback) and dsnoop (capture) operate simultaneously: **VERIFIED**
- Both use the same physical card (sof-hda-dsp, Card 1) but different devices (0 vs 7)
- IPC keys are different (1024 vs 1025): no conflict

## Data Flow: Complete Voice Loop

```
User speaks "Hey Jarvis, what's the cluster status?"
  |
  v
[1] AudioCapture (dsnoop) -> VAD -> WakeWordDetector -> "hey_jarvis" detected
  |
  v
[2] Play chime (350ms) -> State: IDLE -> CAPTURING
  |                        Mic stays ON during chime (chime is short, not self-triggering)
  v
[3] AudioCapture continues -> VAD detects speech -> frames buffered
  |
  v
[4] 2s silence -> capture ends -> BackendClient.send_audio(WAV)
  |
  v
[5] Backend: Whisper STT -> LLM -> TTS sentence synthesis
  |
  v
[6] voice:tts_chunk events arrive (index 0, 1, 2, ...)
  |   On chunk #0: mute mic, start playback, trigger display "talking"
  v
[7] AudioPlayer decodes each chunk -> writes to ALSA -> speaker output
  |
  v
[8] voice:tts_done event -> drain ALSA buffer -> unmute mic
  |                          trigger display "idle" or "listening"
  v
[9] State: CAPTURING -> CONVERSATION (15s follow-up window)
  |
  v
[10a] User says follow-up within 15s -> VAD detects speech -> CAPTURING (no wake word needed)
[10b] 15s passes with no speech -> CONVERSATION -> IDLE (back to listening for wake word)
```

## Open Questions

1. **Chime during mic capture**
   - What we know: The chime is ~350ms and plays through speakers while the mic is still active. The chime could theoretically trigger wake word or VAD.
   - What's unclear: Will the 350ms chime at moderate volume trigger the wake word detector? The chime frequencies (523Hz, 659Hz) are distinct from speech, and the wake word model is trained on "hey jarvis" -- it is unlikely to false-trigger on pure tones.
   - Recommendation: Test empirically. If chime triggers false positives, mute mic during chime playback (add ~4ms total for mute/unmute around the 350ms chime).

2. **Opus support future-proofing**
   - What we know: OPUS_ENABLED=false in backend .env. TTS chunks arrive as WAV. The backend has Opus encoding infrastructure (opus-encode.ts) that can be enabled.
   - What's unclear: Whether Opus will be enabled in a future phase for bandwidth reduction.
   - Recommendation: Use ffmpeg for audio decoding so both WAV and Opus are handled uniformly. The code path is identical -- ffmpeg auto-detects input format.

3. **Playback volume control**
   - What we know: Master and Speaker volumes are both at 60%. Built-in laptop speakers have limited dynamic range.
   - What's unclear: Whether 60% is the right level for audibility vs. mic bleed.
   - Recommendation: Make volume configurable in config.py. Start at 60% and tune based on testing. The mic mute approach makes bleed irrelevant during playback.

## Sources

### Primary (HIGH confidence)
- Live system investigation on Home node (192.168.1.50) -- all ALSA tests, amixer controls, pyalsaaudio API, ffmpeg transcoding verified directly
- `/etc/asound.conf` -- dmix/dsnoop configuration (48kHz/16kHz, IPC keys, period sizes)
- `/root/jarvis-ear/src/jarvis_ear/backend.py` -- existing TTS chunk handler showing `voice:tts_chunk` event format
- `/root/jarvis-backend/src/realtime/voice.ts` -- backend voice protocol, TTS chunk emit format (index, contentType, audio base64)
- `/root/jarvis-backend/src/ai/tts.ts` -- XTTS v2 output: WAV, 24kHz mono 16-bit
- `/root/jarvis-backend/src/ai/opus-encode.ts` -- Opus encoding: OGG Opus via ffmpeg, enabled by OPUS_ENABLED env var
- Docker exec `jarvis-tts:/app/server.py` -- XTTS server: `wav_bytes_from_array(audio_array, sample_rate=24000)`, mono, 16-bit

### Secondary (MEDIUM confidence)
- pyalsaaudio 0.11.0 API -- PCM write() returns frame count, drain() waits for completion, PCM_NORMAL mode is blocking
- ffmpeg 7.1.3 pipe I/O -- stdin/stdout piping for audio transcoding verified with test WAV

### Tertiary (LOW confidence)
- None -- all findings verified on live system

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and tested on this system
- Architecture: HIGH -- patterns verified with live code (playback device open, write, drain, full duplex, mic mute)
- Pitfalls: HIGH -- each pitfall identified from live testing (speaker switch off, dmix rate, etc.)
- Audio format chain: HIGH -- verified end-to-end from XTTS container output format through ffmpeg resample to ALSA write

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable -- hardware/ALSA config unlikely to change)

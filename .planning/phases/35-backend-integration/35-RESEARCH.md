# Phase 35: Backend Integration - Research

**Researched:** 2026-02-26
**Domain:** Python Socket.IO client integration with existing Node.js Jarvis backend
**Confidence:** HIGH

## Summary

Phase 35 connects the jarvis-ear Python daemon (Phase 34) to the existing Jarvis backend's `/voice` Socket.IO namespace. The backend already has a fully implemented voice protocol in `/root/jarvis-backend/src/realtime/voice.ts` that accepts `voice:audio_start`, `voice:audio_chunk` (base64-encoded audio), and `voice:audio_end` events, processes them through Whisper STT, routes through the LLM, and returns `voice:tts_chunk` events with synthesized audio. The daemon must authenticate via JWT, match the exact event protocol, wrap raw PCM audio in WAV format (Whisper requires WAV headers), and handle reconnection gracefully. Zero backend modifications required.

The standard library for this is `python-socketio[client]` (v5.16.1), which provides a synchronous Socket.IO client that spawns background threads for I/O -- compatible with the daemon's existing synchronous main loop architecture. The `requests` library handles JWT token acquisition via the `/api/auth/login` endpoint.

**Primary recommendation:** Use `socketio.Client` (sync, not async) with `python-socketio[client]` extras. Send the entire captured utterance as a single WAV-wrapped audio chunk (not multiple chunks) to avoid concatenation issues. Implement JWT token refresh before expiry to maintain long-running daemon connections.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| python-socketio | 5.16.1 | Socket.IO client for /voice namespace | Official Python Socket.IO implementation by Miguel Grinberg; supports Socket.IO protocol v5 compatible with JS server v4.x |
| requests | >=2.31 | HTTP client for JWT login and health checks | Industry-standard sync HTTP library; dependency of python-socketio[client] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| websocket-client | >=1.7 | WebSocket transport for Socket.IO | Auto-installed with python-socketio[client]; enables direct websocket transport |
| wave (stdlib) | built-in | Create WAV headers for raw PCM audio | Wrapping raw PCM bytes into WAV format before sending to backend |
| struct (stdlib) | built-in | Binary data formatting | WAV header construction (alternative to wave module) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| python-socketio sync Client | python-socketio AsyncClient | AsyncClient requires asyncio event loop; daemon uses sync main loop with threading. Sync Client is simpler and compatible. |
| python-socketio | socketIO-client-2 | Abandoned package, incompatible with Socket.IO v4. Do not use. |
| requests (for JWT login) | urllib3 / aiohttp | requests is already a dependency of python-socketio[client]; no additional dep needed |
| Single WAV chunk | Multiple 500ms WAV chunks | Backend uses `Buffer.concat()` which would break multi-WAV-header concatenation. Single chunk is safer. |

**Installation:**
```bash
pip install "python-socketio[client]>=5.16"
```
This installs: `python-socketio`, `python-engineio`, `requests`, `websocket-client`

## Architecture Patterns

### Recommended Project Structure
```
src/jarvis_ear/
    __main__.py         # Main loop (Phase 34, modified in Phase 35)
    backend.py          # NEW: Socket.IO client, JWT auth, voice protocol
    audio.py            # Audio capture (Phase 34, unchanged)
    config.py           # Config constants (Phase 34, add backend config)
    state_machine.py    # Capture state machine (Phase 34, unchanged)
    vad.py              # VAD (Phase 34, unchanged)
    wakeword.py         # Wake word (Phase 34, unchanged)
    ring_buffer.py      # Ring buffer (Phase 34, unchanged)
```

### Pattern 1: Sync Socket.IO Client with Background Thread I/O
**What:** python-socketio's sync Client spawns background threads for the Socket.IO connection. The main audio loop calls `emit()` synchronously, and event handlers run in Socket.IO's background threads.
**When to use:** When the main loop is synchronous (like jarvis-ear's while loop).
**Example:**
```python
import socketio

sio = socketio.Client(
    reconnection=True,
    reconnection_delay=1,
    reconnection_delay_max=30,
    reconnection_attempts=0,      # 0 = infinite
    randomization_factor=0.5,
    logger=False,
)

@sio.on('voice:listening', namespace='/voice')
def on_listening(data):
    logger.info("Backend ready for audio")

@sio.on('voice:tts_chunk', namespace='/voice')
def on_tts_chunk(data):
    logger.info("Received TTS chunk #%d (%s)", data.get('index', -1), data.get('contentType', '?'))

sio.connect(
    'http://localhost:4000',
    namespaces=['/voice'],
    auth={'token': jwt_token},
    transports=['websocket'],
    wait=True,
    wait_timeout=10,
)
```

### Pattern 2: JWT Token Acquisition and Refresh
**What:** Login to the backend via HTTP POST to get a JWT, cache it, refresh before 7-day expiry.
**When to use:** On daemon startup, and periodically (every 6 days) to prevent token expiry during long runs.
**Example:**
```python
import requests
import time

BACKEND_URL = "http://localhost:4000"
JARVIS_PASSWORD = "jarvis"  # from config

def get_jwt_token() -> str:
    """Login to Jarvis backend and get JWT token."""
    resp = requests.post(
        f"{BACKEND_URL}/api/auth/login",
        json={"password": JARVIS_PASSWORD},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["token"]

# Token valid for 7 days; refresh at 6 days
TOKEN_REFRESH_INTERVAL = 6 * 24 * 3600  # 6 days in seconds
```

### Pattern 3: Raw PCM to WAV Conversion
**What:** Wrap raw PCM bytes in a WAV header using Python's wave module. Required because Whisper (via faster-whisper/PyAV) needs a decodable audio format.
**When to use:** Before base64-encoding audio for voice:audio_chunk.
**Example:**
```python
import wave
import io
import base64

def pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000,
               sample_width: int = 2, channels: int = 1) -> bytes:
    """Wrap raw PCM bytes in a WAV header."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()

# Usage:
wav_bytes = pcm_to_wav(captured_audio)
audio_b64 = base64.b64encode(wav_bytes).decode('ascii')
sio.emit('voice:audio_chunk', {
    'agentId': agent_id,
    'audio': audio_b64,
    'seq': 0,
}, namespace='/voice')
```

### Pattern 4: Voice Protocol Sequence
**What:** The complete event sequence for a voice interaction.
**When to use:** After wake word detection and capture completion.
**Example:**
```python
# After wake word detected and audio captured:
def send_captured_audio(sio, agent_id: str, captured_audio: bytes):
    """Send captured audio to backend using the voice protocol."""
    # 1. Signal start of voice session
    sio.emit('voice:audio_start', {'agentId': agent_id}, namespace='/voice')

    # 2. Convert PCM to WAV and send as single chunk
    wav_bytes = pcm_to_wav(captured_audio)
    audio_b64 = base64.b64encode(wav_bytes).decode('ascii')
    sio.emit('voice:audio_chunk', {
        'agentId': agent_id,
        'audio': audio_b64,
        'seq': 0,
    }, namespace='/voice')

    # 3. Signal end of audio -- triggers STT -> LLM -> TTS pipeline
    sio.emit('voice:audio_end', {'agentId': agent_id}, namespace='/voice')
```

### Anti-Patterns to Avoid
- **Sending multiple WAV chunks:** Backend uses `Buffer.concat(session.audioChunks)` which would produce invalid WAV if each chunk has its own header. Send one chunk per utterance, or send raw PCM chunks with WAV header only in the first chunk.
- **Using AsyncClient with sync main loop:** Introduces unnecessary complexity. The sync Client handles threading internally and is the right fit.
- **Blocking the main audio loop on Socket.IO operations:** `emit()` on the sync client is non-blocking (queued to background thread). Never `sio.wait()` in the main loop.
- **Hardcoding the JWT token:** Token expires after 7 days. Always fetch via login endpoint and refresh periodically.
- **Connecting to default namespace `/`:** Must specify `namespaces=['/voice']` explicitly. Connecting to `/` is unnecessary and wastes resources.
- **Not handling connection failures gracefully:** On startup, if the backend is down, the daemon should still run (audio capture continues, Socket.IO reconnects in background).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Socket.IO protocol | Custom WebSocket client with manual protocol handling | python-socketio[client] | Socket.IO protocol is complex (Engine.IO handshake, packet framing, namespace negotiation, acknowledgments) |
| Reconnection with backoff | Custom reconnection loop with sleep | python-socketio built-in reconnection (reconnection=True) | Library handles exponential backoff, jitter, connection state tracking, thread safety |
| WAV header construction | Manual struct.pack for RIFF/WAV headers | Python stdlib `wave` module | wave module handles byte ordering, chunk sizes, data alignment correctly |
| JWT token parsing/validation | Manual base64 decode + JSON parse | Just treat token as opaque string | Daemon doesn't need to validate JWT; it just passes it to Socket.IO auth |

**Key insight:** python-socketio handles the entire Socket.IO lifecycle including Engine.IO transport negotiation, heartbeats, reconnection with exponential backoff, and namespace management. Do not attempt to manage WebSocket connections manually.

## Common Pitfalls

### Pitfall 1: WAV Format Mismatch
**What goes wrong:** Backend receives audio but Whisper returns empty transcript or error. Audio plays as static/noise.
**Why it happens:** Raw PCM sent without WAV header, or wrong sample rate/bit depth/channel count in WAV header.
**How to avoid:** Always wrap PCM in WAV using `wave.open()` with exact params: 16kHz, 16-bit (sample_width=2), mono (channels=1). These match the daemon's capture config and Whisper's expectation.
**Warning signs:** Whisper logs show "transcription failed" or returns empty transcript for valid speech.

### Pitfall 2: Socket.IO Namespace Must Be Specified
**What goes wrong:** Client connects but events are never received by voice handlers.
**Why it happens:** python-socketio defaults to the `/` (root) namespace. The backend voice handlers are on `/voice`.
**How to avoid:** Always pass `namespaces=['/voice']` to `connect()` and `namespace='/voice'` to all `emit()` and `@sio.on()` calls.
**Warning signs:** Backend logs show connection to root `/` namespace but no "[Voice] Agent connected" message.

### Pitfall 3: JWT Auth Token in Socket.IO Handshake
**What goes wrong:** Socket.IO connection rejected with "Authentication required" or "Invalid or expired token".
**Why it happens:** Token passed incorrectly (wrong key name, missing, or expired).
**How to avoid:** Pass token in connect() `auth` parameter as `{'token': jwt_string}`. The backend middleware reads `socket.handshake.auth.token` (see `/root/jarvis-backend/src/realtime/socket.ts:34`).
**Warning signs:** `connect_error` event fires immediately after connection attempt.

### Pitfall 4: Blocking Main Audio Loop
**What goes wrong:** Audio frames are dropped, VAD/wake word detection degrades.
**Why it happens:** Socket.IO operations (connect, emit) block the main thread longer than 32ms (one frame period).
**How to avoid:** Use `sio.connect(wait=True, wait_timeout=10)` only at startup (not in the main loop). `sio.emit()` is non-blocking on the sync client. If backend is down at startup, use `retry=True` or connect in a background thread.
**Warning signs:** Audio capture `drop_count` increases in stats logs.

### Pitfall 5: Reconnection After Backend Restart
**What goes wrong:** Daemon reconnects Socket.IO transport but events fail silently because the JWT auth state is stale.
**Why it happens:** python-socketio reconnects the Engine.IO transport, which re-runs the Socket.IO handshake (including auth). If the auth dict is stale, the new handshake fails.
**How to avoid:** Use a callable for the `auth` parameter: `auth=lambda: {'token': get_current_token()}`. This way, each reconnection attempt uses the latest token. Alternatively, refresh the token on `connect_error` events.
**Warning signs:** Reconnection attempts succeed at Engine.IO level but fail at Socket.IO namespace level.

### Pitfall 6: Base64 Encoding Bloat
**What goes wrong:** Audio chunks exceed Socket.IO's max buffer size, causing silent drops.
**Why it happens:** Base64 encoding increases data size by ~33%. A 30-second capture at 16kHz/16-bit/mono = 960KB raw, ~1.28MB base64. Within the 5MB limit set in socket.ts but could be a concern for very long recordings.
**How to avoid:** The backend sets `maxHttpBufferSize: 5 * 1024 * 1024` (5MB). 30 seconds of 16-bit mono 16kHz audio = 960KB raw = ~1.3MB base64, well within limits. For safety, cap utterance length at the daemon's existing MAX_RECORDING_MS (30s).
**Warning signs:** Chunks silently dropped, Whisper receives partial audio.

### Pitfall 7: Connect Timeout vs Wait Timeout
**What goes wrong:** `sio.connect()` raises timeout error even though the server is reachable.
**Why it happens:** The `wait_timeout` parameter (default 1 second) is too short. The backend may take longer to process the initial namespace handshake.
**How to avoid:** Set `wait_timeout=10` for the initial connection. For production daemon, consider `wait=False` with a manual connection check, or `retry=True` to enable reconnection logic on initial failure.
**Warning signs:** `TimeoutError` on first connect attempt.

## Code Examples

### Complete Backend Client Module
```python
"""Socket.IO client for Jarvis backend /voice namespace."""

import base64
import io
import logging
import threading
import time
import wave

import requests
import socketio

from jarvis_ear.config import (
    BACKEND_URL, JARVIS_PASSWORD, AGENT_ID,
    SAMPLE_RATE, SAMPLE_WIDTH, CHANNELS,
)

logger = logging.getLogger("jarvis_ear.backend")

# Token refresh interval (6 days, token valid for 7 days)
_TOKEN_REFRESH_S = 6 * 24 * 3600


def pcm_to_wav(pcm_bytes: bytes) -> bytes:
    """Wrap raw PCM bytes in a WAV header."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


class BackendClient:
    """Manages Socket.IO connection to Jarvis backend /voice namespace."""

    def __init__(self):
        self._token: str | None = None
        self._token_acquired_at: float = 0
        self._connected = False
        self._lock = threading.Lock()

        self._sio = socketio.Client(
            reconnection=True,
            reconnection_delay=1,
            reconnection_delay_max=30,
            reconnection_attempts=0,  # infinite
            randomization_factor=0.5,
            logger=False,
        )

        # Register event handlers
        self._sio.on('connect', self._on_connect, namespace='/voice')
        self._sio.on('disconnect', self._on_disconnect, namespace='/voice')
        self._sio.on('connect_error', self._on_connect_error)
        self._sio.on('voice:listening', self._on_listening, namespace='/voice')
        self._sio.on('voice:processing', self._on_processing, namespace='/voice')
        self._sio.on('voice:transcript', self._on_transcript, namespace='/voice')
        self._sio.on('voice:thinking', self._on_thinking, namespace='/voice')
        self._sio.on('voice:tts_chunk', self._on_tts_chunk, namespace='/voice')
        self._sio.on('voice:tts_done', self._on_tts_done, namespace='/voice')
        self._sio.on('voice:error', self._on_error, namespace='/voice')

    @property
    def connected(self) -> bool:
        return self._connected

    def _get_token(self) -> str:
        """Get a valid JWT token, refreshing if needed."""
        now = time.time()
        if self._token and (now - self._token_acquired_at) < _TOKEN_REFRESH_S:
            return self._token

        resp = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"password": JARVIS_PASSWORD},
            timeout=10,
        )
        resp.raise_for_status()
        self._token = resp.json()["token"]
        self._token_acquired_at = now
        logger.info("JWT token acquired (valid 7 days)")
        return self._token

    def connect(self) -> bool:
        """Connect to backend. Returns True if connected."""
        try:
            token = self._get_token()
            self._sio.connect(
                BACKEND_URL,
                namespaces=['/voice'],
                auth={'token': token},
                transports=['websocket'],
                wait=True,
                wait_timeout=10,
            )
            return True
        except Exception as e:
            logger.warning("Failed to connect: %s", e)
            return False

    def disconnect(self):
        """Disconnect from backend."""
        try:
            self._sio.disconnect()
        except Exception:
            pass

    def send_audio(self, captured_audio: bytes) -> None:
        """Send captured audio through the voice protocol."""
        if not self._connected:
            logger.warning("Not connected, dropping audio")
            return

        agent_id = AGENT_ID

        # 1. Signal start
        self._sio.emit('voice:audio_start',
                        {'agentId': agent_id},
                        namespace='/voice')

        # 2. Convert PCM to WAV, base64-encode, send as single chunk
        wav_bytes = pcm_to_wav(captured_audio)
        audio_b64 = base64.b64encode(wav_bytes).decode('ascii')
        self._sio.emit('voice:audio_chunk', {
            'agentId': agent_id,
            'audio': audio_b64,
            'seq': 0,
        }, namespace='/voice')

        # 3. Signal end -- triggers STT -> LLM -> TTS pipeline
        self._sio.emit('voice:audio_end',
                        {'agentId': agent_id},
                        namespace='/voice')

        duration_s = len(captured_audio) / (SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS)
        logger.info(
            "Sent %.1fs audio to backend (%d bytes raw, %d bytes WAV, %d bytes b64)",
            duration_s, len(captured_audio), len(wav_bytes), len(audio_b64),
        )

    # --- Event handlers (run in Socket.IO background thread) ---

    def _on_connect(self):
        self._connected = True
        logger.info("Connected to backend /voice namespace")

    def _on_disconnect(self, reason):
        self._connected = False
        logger.info("Disconnected from backend: %s", reason)

    def _on_connect_error(self, data):
        self._connected = False
        logger.warning("Connection error: %s", data)

    def _on_listening(self, data):
        logger.debug("Backend listening for audio")

    def _on_processing(self, data):
        logger.info("Backend processing audio (STT)")

    def _on_transcript(self, data):
        logger.info("Transcript: '%s'", data.get('text', ''))

    def _on_thinking(self, data):
        logger.info("Backend thinking (%s)", data.get('provider', '?'))

    def _on_tts_chunk(self, data):
        # Phase 36 will handle playback; for now just log
        idx = data.get('index', -1)
        ct = data.get('contentType', 'unknown')
        audio = data.get('audio', '')
        size = len(audio) if isinstance(audio, (str, bytes)) else 0
        logger.info("TTS chunk #%d received (%s, %d bytes)", idx, ct, size)

    def _on_tts_done(self, data):
        total = data.get('totalChunks', 0)
        logger.info("TTS complete (%d chunks)", total)

    def _on_error(self, data):
        logger.error("Backend error: %s", data.get('error', 'unknown'))
```

### Main Loop Integration Point
```python
# In __main__.py, after capture complete:
if captured_audio is not None:
    duration_s = len(captured_audio) / (SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS)
    captures_completed += 1
    logger.info("Capture #%d complete: %.1fs (%d bytes)",
                captures_completed, duration_s, len(captured_audio))

    # Phase 35: Send to backend
    backend.send_audio(captured_audio)

    vad.reset()
```

### Health Check Pattern
```python
def check_backend_health() -> bool:
    """Quick health check on backend API."""
    try:
        resp = requests.get(
            f"{BACKEND_URL}/api/health?liveness",
            timeout=5,
        )
        return resp.status_code == 200
    except Exception:
        return False
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| socketIO-client (pip) | python-socketio[client] | 2020+ | Old library abandoned; python-socketio is the maintained implementation |
| python-socketio 4.x (protocol v3) | python-socketio 5.x (protocol v5) | 2021 | Must use 5.x for compatibility with Socket.IO JS server 4.x |
| Long-polling default transport | Direct websocket transport | Always available | Reduces latency; specify `transports=['websocket']` |
| Manual reconnection loops | Built-in reconnection with backoff | Built into library | Library handles exponential backoff with jitter natively |

**Deprecated/outdated:**
- `socketIO-client`: Unmaintained since 2018, incompatible with Socket.IO v3/v4. Do not use.
- `socketIO-client-2`: Fork of socketIO-client, also abandoned. Do not use.
- python-socketio < 5.0: Incompatible Socket.IO protocol version. Backend uses Socket.IO v4.x which requires protocol v5.

## Open Questions

1. **Audio chunk strategy: single vs multiple**
   - What we know: Backend calls `Buffer.concat(session.audioChunks)` and sends the result as `audio.wav` to Whisper. If each chunk has a WAV header, concatenation produces invalid multi-header WAV.
   - What's unclear: Whether faster-whisper/PyAV can handle a buffer that starts with a valid WAV header followed by raw PCM from subsequent chunks (i.e., the WAV header's data size field is wrong).
   - Recommendation: Send the entire utterance as a single audio_chunk with a complete WAV file. This is simple, correct, and avoids the concatenation issue entirely. Maximum utterance is 30s = ~960KB raw = ~1.3MB base64, well within the 5MB buffer limit.

2. **Token refresh on reconnection**
   - What we know: python-socketio re-runs the auth handshake on reconnection. The `auth` parameter can be a callable.
   - What's unclear: Whether the callable-auth feature works in python-socketio 5.16.x (documentation mentions it but behavior may vary).
   - Recommendation: Test callable auth; if it doesn't work, refresh token in the `connect_error` handler and manually reconnect. The simpler approach of refreshing on a timer (every 6 days) covers most cases since the daemon rarely disconnects.

3. **Daemon startup without backend**
   - What we know: The daemon should function (audio capture, VAD, wake word) even when the backend is unavailable.
   - What's unclear: Exact behavior when `sio.connect()` fails with `wait=True` -- does it block? Does it throw?
   - Recommendation: Wrap initial `connect()` in try/except. If it fails, log a warning and let built-in reconnection handle it. The main audio loop must never be blocked by Socket.IO failures. Use `retry=True` in connect() to enable reconnection logic on initial failure.

## Existing Backend Protocol Reference

### Event Payloads (extracted from `/root/jarvis-backend/src/realtime/voice.ts`)

**Incoming (daemon -> backend):**
```
voice:audio_start  { agentId: string }
voice:audio_chunk  { agentId: string, audio: string (base64), seq: number }
voice:audio_end    { agentId: string }
voice:ping         { agentId: string }
```

**Outgoing (backend -> daemon):**
```
voice:listening    { }                              # Ready for audio
voice:processing   { }                              # STT in progress
voice:transcript   { text: string }                 # STT result
voice:thinking     { provider: string }             # LLM processing
voice:tts_chunk    { index: number, contentType: string, audio: string (base64) }
voice:tts_done     { totalChunks: number }           # All TTS sent
voice:error        { error: string }                 # Error
voice:pong         { agentId: string }               # Keepalive reply
```

### Auth Flow (from `/root/jarvis-backend/src/auth/jwt.ts` and `/root/jarvis-backend/src/realtime/socket.ts`)
1. POST `http://localhost:4000/api/auth/login` with `{"password": "jarvis"}`
2. Response: `{"token": "<jwt>", "expiresIn": "7d"}`
3. Connect Socket.IO with `auth: {'token': '<jwt>'}`
4. Backend middleware validates JWT on handshake (`socket.handshake.auth.token`)

### Backend Session Lifecycle (from `voice.ts:86-169`)
1. On `voice:audio_start`: creates VoiceSession, stores agentId -> session mapping
2. On `voice:audio_chunk`: base64-decodes audio, appends Buffer to session.audioChunks
3. On `voice:audio_end`: calls processVoiceSession() which:
   - Concatenates all chunks: `Buffer.concat(session.audioChunks)`
   - Sends to Whisper STT for transcription
   - Routes transcript through LLM (Claude/Qwen/OpenAI)
   - Streams TTS audio back as voice:tts_chunk events
4. On disconnect: aborts any active sessions for that socket

### Key Backend Constants
- `maxHttpBufferSize`: 5MB (socket.ts:19)
- `MAX_RECORDING_MS`: 30,000ms (voice.ts:69)
- `SILENCE_TIMEOUT_MS`: 2,000ms (voice.ts:66, env-configurable)
- `pingInterval`: 25,000ms (socket.ts:17)
- `pingTimeout`: 10,000ms (socket.ts:18)

## Config Constants Needed (for jarvis_ear/config.py)

```python
# Backend connection (Phase 35)
BACKEND_URL = "http://localhost:4000"   # Jarvis backend on same host
JARVIS_PASSWORD = "jarvis"              # Login credential (matches .env)
AGENT_ID = "jarvis-ear"                 # Unique identifier for this voice agent
```

Note: The backend runs in Docker on port 4000, mapped to host. Since jarvis-ear runs on the host (systemd), `localhost:4000` is correct. The password matches the `.env` file value.

## Sources

### Primary (HIGH confidence)
- `/root/jarvis-backend/src/realtime/voice.ts` - Complete voice namespace protocol implementation
- `/root/jarvis-backend/src/realtime/socket.ts` - Socket.IO setup, auth middleware, namespace configuration
- `/root/jarvis-backend/src/auth/jwt.ts` - JWT generation, verification, login handler
- `/root/jarvis-backend/src/ai/stt.ts` - Whisper STT client (expects WAV format)
- `/root/jarvis-backend/src/config.ts` - Backend configuration (ports, secrets, limits)
- `/root/jarvis-whisper/server.py` - Whisper service (faster-whisper, accepts WAV via multipart)
- `/root/jarvis-ear/src/jarvis_ear/__main__.py` - Daemon main loop with Phase 35 TODO at line 122
- `/root/jarvis-ear/src/jarvis_ear/config.py` - Audio config constants (16kHz, 16-bit, mono)
- `/root/jarvis-ui/src/services/socket.ts` - Reference Socket.IO client implementation (JS, auth pattern)
- `/root/docker-compose.yml` - Backend port mapping (4000:4000), network config

### Secondary (MEDIUM confidence)
- [python-socketio client documentation](https://python-socketio.readthedocs.io/en/stable/client.html) - Client API, connection, events, namespaces
- [python-socketio API reference](https://python-socketio.readthedocs.io/en/stable/api_client.html) - Constructor parameters, reconnection config, auth
- [python-socketio PyPI](https://pypi.org/project/python-socketio/) - Version 5.16.1, Python >=3.8, extras
- [Python wave module docs](https://docs.python.org/3/library/wave.html) - WAV file creation from raw PCM

### Tertiary (LOW confidence)
- [faster-whisper raw PCM discussion](https://github.com/SYSTRAN/faster-whisper/issues/1077) - PyAV audio decoding requirements (suggests WAV headers needed)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - python-socketio is the only maintained Socket.IO Python client; version 5.x confirmed compatible with backend's Socket.IO v4
- Architecture: HIGH - Codebase fully inspected; voice.ts protocol, auth flow, and audio format requirements are directly read from source
- Pitfalls: HIGH - Every pitfall identified from reading actual backend code (auth middleware, Buffer.concat, WAV format, namespace requirements)
- WAV format strategy: MEDIUM - Single-chunk approach is safest and simplest; multi-chunk WAV concatenation issues identified from code reading but not tested

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable domain, unlikely to change)

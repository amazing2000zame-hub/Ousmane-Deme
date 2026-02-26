"""Socket.IO client for Jarvis backend /voice namespace.

Handles JWT authentication, Socket.IO connection management, PCM-to-WAV
conversion, and the voice protocol (audio_start/chunk/end).  Designed to
be called from the synchronous main loop -- python-socketio's sync Client
runs I/O in background threads.

Phase 35 -- backend integration with reconnection resilience, health
monitoring, token refresh, and non-blocking startup.
"""

import base64
import io
import logging
import threading
import time
import wave

import requests
import socketio

from jarvis_ear.config import (
    AGENT_ID,
    BACKEND_PING_INTERVAL_S,
    BACKEND_PING_TIMEOUT_S,
    BACKEND_URL,
    CHANNELS,
    JARVIS_PASSWORD,
    SAMPLE_RATE,
    SAMPLE_WIDTH,
)

logger = logging.getLogger("jarvis_ear.backend")

# Token refresh interval (6 days; token valid for 7 days)
_TOKEN_REFRESH_S = 6 * 24 * 3600


def pcm_to_wav(pcm_bytes: bytes) -> bytes:
    """Wrap raw PCM bytes in a valid WAV header.

    Uses the audio format constants from config: 16 kHz, 16-bit, mono.
    Returns a complete WAV file as bytes.
    """
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(SAMPLE_WIDTH)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


class BackendClient:
    """Manages Socket.IO connection to Jarvis backend /voice namespace.

    Features:
    - Non-blocking startup via start() method
    - Automatic reconnection with exponential backoff (python-socketio built-in)
    - JWT token refresh before expiry (6-day interval, 7-day token lifetime)
    - Health monitoring with voice:ping / voice:pong keepalive
    - Connection state tracking with status() method
    """

    def __init__(self) -> None:
        self._token: str | None = None
        self._token_acquired_at: float = 0.0
        self._connected = False
        self._lock = threading.Lock()

        # Connection state tracking
        self._reconnect_count: int = 0
        self._last_connected_at: float = 0.0
        self._last_disconnect_at: float = 0.0
        self._last_pong_time: float = 0.0

        # Health monitor shutdown control
        self._shutdown_event = threading.Event()
        self._health_thread: threading.Thread | None = None

        self._sio = socketio.Client(
            reconnection=True,
            reconnection_delay=1,
            reconnection_delay_max=30,
            reconnection_attempts=0,  # infinite
            randomization_factor=0.5,
            logger=False,
        )

        # Register event handlers on /voice namespace
        self._sio.on("connect", self._on_connect, namespace="/voice")
        self._sio.on("disconnect", self._on_disconnect, namespace="/voice")
        self._sio.on("connect_error", self._on_connect_error)
        self._sio.on("voice:listening", self._on_listening, namespace="/voice")
        self._sio.on("voice:processing", self._on_processing, namespace="/voice")
        self._sio.on("voice:transcript", self._on_transcript, namespace="/voice")
        self._sio.on("voice:thinking", self._on_thinking, namespace="/voice")
        self._sio.on("voice:tts_chunk", self._on_tts_chunk, namespace="/voice")
        self._sio.on("voice:tts_done", self._on_tts_done, namespace="/voice")
        self._sio.on("voice:error", self._on_error, namespace="/voice")
        self._sio.on("voice:pong", self._on_pong, namespace="/voice")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def connected(self) -> bool:
        """Whether the client is connected to the backend."""
        return self._connected

    def start(self) -> None:
        """Non-blocking startup: attempt connection in a background thread.

        The main audio loop is never blocked on startup.  If the initial
        connection fails, python-socketio's built-in reconnection handles
        retries with exponential backoff.
        """
        t = threading.Thread(
            target=self._background_connect,
            name="backend-connect",
            daemon=True,
        )
        t.start()
        self._start_health_monitor()

    def connect(self) -> bool:
        """Connect to backend /voice namespace (synchronous).

        Returns True on success, False on failure.  Never raises.
        Kept for backward compatibility; prefer start() for non-blocking.
        """
        try:
            token = self._get_token()
            self._sio.connect(
                BACKEND_URL,
                namespaces=["/voice"],
                auth={"token": token},
                transports=["websocket"],
                wait=True,
                wait_timeout=10,
            )
            return True
        except Exception as exc:
            logger.warning("Failed to connect to backend: %s", exc)
            return False

    def disconnect(self) -> None:
        """Disconnect from backend.  Safe to call even when not connected.

        Stops the health monitor thread, then disconnects Socket.IO.
        """
        # Signal health monitor to stop
        self._shutdown_event.set()

        # Wait for health monitor thread to finish
        if self._health_thread is not None and self._health_thread.is_alive():
            self._health_thread.join(timeout=5)

        try:
            self._sio.disconnect()
        except Exception:
            pass

    def send_audio(self, captured_audio: bytes) -> None:
        """Send captured audio through the voice protocol.

        Emits audio_start, a single audio_chunk (PCM wrapped in WAV,
        base64-encoded), and audio_end on the /voice namespace.
        """
        if not self._connected:
            logger.warning("Not connected to backend, dropping audio")
            return

        agent_id = AGENT_ID

        # 1. Signal start of voice session
        self._sio.emit(
            "voice:audio_start", {"agentId": agent_id}, namespace="/voice"
        )

        # 2. Convert PCM to WAV, base64-encode, send as single chunk
        wav_bytes = pcm_to_wav(captured_audio)
        audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
        self._sio.emit(
            "voice:audio_chunk",
            {"agentId": agent_id, "audio": audio_b64, "seq": 0},
            namespace="/voice",
        )

        # 3. Signal end -- triggers STT -> LLM -> TTS pipeline on backend
        self._sio.emit(
            "voice:audio_end", {"agentId": agent_id}, namespace="/voice"
        )

        duration_s = len(captured_audio) / (SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS)
        logger.info(
            "Sent %.1fs audio to backend (%d bytes raw, %d bytes WAV, %d bytes b64)",
            duration_s,
            len(captured_audio),
            len(wav_bytes),
            len(audio_b64),
        )

    def status(self) -> dict:
        """Return connection metrics for status reporting."""
        return {
            "connected": self._connected,
            "reconnect_count": self._reconnect_count,
            "last_connected": self._last_connected_at,
            "last_disconnect": self._last_disconnect_at,
            "token_age_hours": (
                (time.time() - self._token_acquired_at) / 3600
                if self._token
                else 0
            ),
        }

    # ------------------------------------------------------------------
    # Background startup
    # ------------------------------------------------------------------

    def _background_connect(self) -> None:
        """Attempt initial connection in a background thread."""
        try:
            token = self._get_token()
            self._sio.connect(
                BACKEND_URL,
                namespaces=["/voice"],
                auth={"token": token},
                transports=["websocket"],
                wait=True,
                wait_timeout=10,
            )
        except Exception as exc:
            logger.warning(
                "Backend not available, will reconnect automatically: %s", exc
            )

    # ------------------------------------------------------------------
    # Health monitoring
    # ------------------------------------------------------------------

    def _start_health_monitor(self) -> None:
        """Start a background daemon thread that sends keepalive pings."""
        self._health_thread = threading.Thread(
            target=self._health_loop,
            name="backend-health",
            daemon=True,
        )
        self._health_thread.start()

    def _health_loop(self) -> None:
        """Periodically send voice:ping and check for voice:pong replies."""
        while not self._shutdown_event.wait(timeout=BACKEND_PING_INTERVAL_S):
            if not self._connected:
                continue

            try:
                self._sio.emit(
                    "voice:ping",
                    {"agentId": AGENT_ID},
                    namespace="/voice",
                )
                logger.debug("Ping sent")
            except Exception as exc:
                logger.debug("Ping failed: %s", exc)

            # Check for stale connection (no pong within timeout)
            if self._last_pong_time > 0:
                since_pong = time.time() - self._last_pong_time
                if since_pong > BACKEND_PING_TIMEOUT_S:
                    logger.warning(
                        "No pong received in %.0fs (threshold %ds) -- possible stale connection",
                        since_pong,
                        BACKEND_PING_TIMEOUT_S,
                    )

    def _on_pong(self, data: dict | None = None) -> None:
        """Handle voice:pong keepalive reply from backend."""
        self._last_pong_time = time.time()
        logger.debug("Pong received")

    # ------------------------------------------------------------------
    # Token management
    # ------------------------------------------------------------------

    def _get_token(self) -> str:
        """Get a valid JWT token, refreshing if needed."""
        with self._lock:
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

    # ------------------------------------------------------------------
    # Socket.IO event handlers (run in background thread)
    # ------------------------------------------------------------------

    def _on_connect(self) -> None:
        with self._lock:
            self._connected = True
            self._last_connected_at = time.time()

        if self._reconnect_count > 0:
            logger.info(
                "Reconnected to backend (attempt #%d)", self._reconnect_count
            )
            # Refresh token on reconnection if it's old (>6 days)
            try:
                self._get_token()
            except Exception as exc:
                logger.warning("Token refresh on reconnect failed: %s", exc)
        else:
            logger.info("Connected to backend /voice namespace")

        self._reconnect_count += 1

    def _on_disconnect(self, reason: str = "") -> None:
        with self._lock:
            self._connected = False
            self._last_disconnect_at = time.time()
        logger.info("Disconnected from backend: %s", reason)

    def _on_connect_error(self, data: object = None) -> None:
        with self._lock:
            self._connected = False
        logger.warning("Connection error: %s", data)

    def _on_listening(self, data: dict | None = None) -> None:
        logger.debug("Backend listening for audio")

    def _on_processing(self, data: dict | None = None) -> None:
        logger.info("Backend processing audio (STT)")

    def _on_transcript(self, data: dict | None = None) -> None:
        text = data.get("text", "") if data else ""
        logger.info("Transcript: '%s'", text)

    def _on_thinking(self, data: dict | None = None) -> None:
        provider = data.get("provider", "?") if data else "?"
        logger.info("Backend thinking (%s)", provider)

    def _on_tts_chunk(self, data: dict | None = None) -> None:
        # Phase 36 will add actual audio playback; for now just log
        if data:
            idx = data.get("index", -1)
            ct = data.get("contentType", "unknown")
            audio = data.get("audio", "")
            size = len(audio) if isinstance(audio, (str, bytes)) else 0
            logger.info("TTS chunk #%d received (%s, %d bytes)", idx, ct, size)

    def _on_tts_done(self, data: dict | None = None) -> None:
        total = data.get("totalChunks", 0) if data else 0
        logger.info("TTS complete (%d chunks)", total)

    def _on_error(self, data: dict | None = None) -> None:
        error = data.get("error", "unknown") if data else "unknown"
        logger.error("Backend error: %s", error)

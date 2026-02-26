"""Non-blocking HTTP client for the Jarvis display daemon.

Calls the display daemon's HTTP API to show/hide the Jarvis HUD
on the physical kiosk display. All calls are fire-and-forget via
daemon threads -- they never block the audio capture main loop.

Phase 37 -- Display Control integration.
"""

import logging
import threading

import requests

from jarvis_ear.config import DISPLAY_DAEMON_URL

logger = logging.getLogger("jarvis_ear.display")


class DisplayClient:
    """Fire-and-forget HTTP client for the display daemon.

    Every public method spawns a daemon thread to make the HTTP call,
    so the caller (main audio loop) is never blocked. Exceptions in
    the daemon thread are caught and logged at debug level -- display
    control is non-critical and must never interfere with audio capture.
    """

    def __init__(self) -> None:
        self._url = DISPLAY_DAEMON_URL

    def _fire(self, endpoint: str, payload: dict) -> None:
        """Fire-and-forget HTTP POST to the display daemon.

        Spawns a daemon thread that makes the request with a 2-second
        timeout. All exceptions are caught and logged at debug level.
        """

        def _do_post() -> None:
            try:
                requests.post(
                    f"{self._url}{endpoint}",
                    json=payload,
                    timeout=2,
                )
            except Exception as exc:
                logger.debug("Display call to %s failed: %s", endpoint, exc)

        t = threading.Thread(target=_do_post, daemon=True)
        t.start()

    def on_wake_word(self) -> None:
        """Show the HUD in listening state on wake word detection."""
        logger.info("Display: showing HUD (listening)")
        self._fire("/display/hud", {"state": "listening"})

    def on_tts_start(self) -> None:
        """Show the HUD in talking state when TTS playback begins."""
        logger.info("Display: showing HUD (talking)")
        self._fire("/display/hud", {"state": "talking"})

    def on_tts_done(self) -> None:
        """Restore camera feeds when TTS playback is complete."""
        logger.info("Display: restoring camera feeds")
        self._fire("/display/restore", {})

"""Central configuration constants for jarvis-ear audio capture daemon."""

# Audio format
SAMPLE_RATE = 16000          # 16kHz -- matches hw:sofhdadsp,7 native rate and Whisper expectation
SAMPLE_WIDTH = 2             # 16-bit = 2 bytes per sample
CHANNELS = 1                 # Mono -- dsnoop will downmix stereo DMIC to mono via plug

# Frame sizing (aligned to Silero VAD's native 512-sample window at 16kHz)
FRAME_DURATION_MS = 32       # 32ms frames
FRAME_SIZE = 512             # 512 samples per frame -- matches Silero VAD expectation exactly

# Pre-roll buffer (audio kept before wake word detection)
PREROLL_DURATION_MS = 500    # 500ms pre-roll buffer before wake word
PREROLL_FRAMES = int(PREROLL_DURATION_MS / FRAME_DURATION_MS)  # 15 frames

# Silence detection
SILENCE_TIMEOUT_S = 2.0      # 2 seconds of silence = end of utterance

# VAD tuning for Intel HDA DMIC
VAD_THRESHOLD = 0.15         # Lower than Silero default (0.5) because DMIC signal
                             # has heavy low-freq hum that reduces speech probability.
                             # High-pass filter in vad.py compensates, but peaks at ~0.3-0.9
                             # for speech vs <0.05 for quiet. 0.15 gives <5% false positives.

# ALSA device configuration
ALSA_DEVICE = "default"      # Uses the plug->dsnoop->hw:sofhdadsp,7 chain from /etc/asound.conf
ALSA_PERIOD_SIZE = 512       # One frame worth of samples, aligned to Silero VAD
ALSA_PERIODS = 4             # 4 periods in ALSA buffer = ~128ms, enough headroom

# Backend connection (Phase 35)
BACKEND_URL = "http://localhost:4000"   # Jarvis backend Docker container mapped to host port
JARVIS_PASSWORD = "jarvis"              # Login password (matches backend .env JARVIS_PASSWORD)
AGENT_ID = "jarvis-ear"                 # Unique agent identifier for voice sessions

# Health monitoring (Phase 35)
BACKEND_PING_INTERVAL_S = 60           # Keepalive ping interval
BACKEND_PING_TIMEOUT_S = 120           # Stale connection warning threshold

# Display daemons (Phase 37)
DISPLAY_DAEMON_URL = "http://localhost:8766"            # Home node eDP-1 (default for jarvis-ear)
DISPLAY_DAEMON_KIOSK_URL = "http://192.168.1.65:8765"  # Management VM kiosk

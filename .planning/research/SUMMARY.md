# Research Summary: Server-Side Always-On Voice for Jarvis

**Domain:** Always-on server-side voice input/output for AI assistant
**Researched:** 2026-02-25
**Overall confidence:** HIGH

## Executive Summary

This research investigates the architecture, technology stack, feature requirements, and pitfalls for adding always-on server-side voice capabilities to the existing Jarvis 3.1 system. The system currently has a browser-based voice pipeline (mic capture in browser -> Socket.IO -> Whisper STT -> LLM -> TTS -> browser playback). The new capability adds physical microphone capture and speaker playback on the Home node, enabling hands-free "Hey Jarvis" interaction without a browser.

The most significant finding is that **the existing backend already fully supports this feature**. The `/voice` Socket.IO namespace in `voice.ts` was designed from the start as a server-side voice agent protocol. It documents incoming events from an "Agent" client (audio_start, audio_chunk, audio_end) and outgoing events (tts_chunk, tts_done, listening). The complete STT -> LLM -> TTS pipeline is implemented and working. The only missing piece is the client -- a Python daemon that captures audio from a physical microphone, detects the "Hey Jarvis" wake word, and plays TTS responses through physical speakers.

The hardware situation introduces the primary risk: Intel SOF audio firmware failed to initialize on the headless Proxmox server because the i915 GPU driver did not complete initialization. No ALSA capture devices are currently available. However, this is solvable via two approaches: a USB microphone (zero-risk, no reboot needed) or fixing the SOF driver (requires reboot, possible kernel parameter changes). USB microphone is recommended for Phase 1.

The recommended technology stack is a Python daemon using pyalsaaudio (ALSA capture/playback), Silero VAD (voice activity detection), openWakeWord (wake word detection with pre-trained "hey jarvis" model), and python-socketio (backend connection). Total resource footprint is approximately 120MB RAM and 2-3% of a single CPU core during idle listening. This is well within the Home node's budget.

## Key Findings

**Stack:** Python daemon on host (systemd service) using pyalsaaudio + Silero VAD + openWakeWord + python-socketio. ONNX runtime for ML inference (~50MB vs ~2GB for PyTorch).

**Architecture:** Single new component (`jarvis-ear`) connects to existing `/voice` Socket.IO namespace. Zero changes to jarvis-backend, jarvis-whisper, or TTS services. The protocol is already implemented and documented.

**Critical pitfall:** Intel SOF audio driver failed to initialize (i915 dependency on headless Proxmox). No capture devices exist. USB microphone is the safe fallback. Secondary critical pitfall: echo/feedback loop -- Jarvis must mute the mic during TTS playback to prevent self-triggering.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Audio Hardware Foundation** - Get audio working first
   - Addresses: Hardware activation (install alsa-ucm-conf, reboot, verify SOF), USB mic fallback, ALSA dmix/dsnoop config, Docker vs systemd decision
   - Avoids: Pitfall 1 (SOF firmware failure), Pitfall 3 (Docker ALSA access), Pitfall 4 (ALSA device sharing)
   - This MUST be completed before any software development

2. **Audio Capture Daemon Core** - Basic capture + VAD + wake word
   - Addresses: Continuous audio capture, Silero VAD filtering, openWakeWord integration, state machine (IDLE -> CAPTURING -> IDLE)
   - Avoids: Pitfall 5 (CPU exhaustion via two-stage pipeline), Pitfall 6 (false positives via VAD gating), Pitfall 7 (buffer overflow via pyalsaaudio)
   - Pre-roll buffer for wake word context (500ms)

3. **Backend Integration** - Connect to existing /voice pipeline
   - Addresses: Socket.IO client with JWT auth, voice:audio_start/chunk/end protocol, auto-reconnection
   - Avoids: Pitfall 8 (WAV format compatibility with Whisper)
   - Uses existing backend as-is -- zero backend modifications needed

4. **Speaker Output + Complete Loop** - Hear Jarvis respond
   - Addresses: TTS chunk reception, ordered playback queue, ALSA output, Opus decoding support
   - Avoids: Pitfall 2 (echo loop via mic mute during playback), post-playback silence window
   - Audio feedback chime on wake word detection

5. **Reliability + Service Management** - Production-ready daemon
   - Addresses: systemd service unit, auto-restart, graceful degradation, status reporting, health monitoring
   - Avoids: Pitfall 7 (long-running daemon stability)
   - Configurable thresholds (VAD, wake word sensitivity)

**Phase ordering rationale:**
- Phase 1 must be first because all subsequent phases depend on working audio hardware
- Phase 2 before Phase 3 because the capture pipeline should work locally before adding network communication (testable in isolation)
- Phase 3 before Phase 4 because the backend must process audio before TTS output makes sense
- Phase 4 includes the echo prevention (mic mute during playback) which is the most critical safety feature
- Phase 5 is last because reliability polish builds on a working system

**Research flags for phases:**
- Phase 1: LIKELY needs deeper research if SOF driver does not initialize after reboot (may need kernel parameters, topology file selection, or BIOS settings)
- Phase 2: openWakeWord "hey_jarvis" model accuracy is unverified in this specific environment (no published per-model benchmarks). May need custom model training.
- Phase 3: Standard patterns, unlikely to need research (Socket.IO protocol is already defined)
- Phase 4: Sample rate conversion between TTS output (22050/24000Hz) and ALSA device may need investigation
- Phase 5: Standard patterns for systemd services

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | pyalsaaudio, Silero VAD, openWakeWord are well-established. ONNX runtime avoids PyTorch bloat. |
| Features | HIGH | Table stakes are clear and well-defined. Anti-features (echo cancellation, continuous STT) correctly identified. |
| Architecture | HIGH | Existing voice.ts protocol is the strongest evidence -- it was designed for this exact use case. Zero backend changes needed. |
| Pitfalls | HIGH | SOF driver failure verified on host. Echo loop is well-documented across all voice assistant projects. ALSA sharing limitations are fundamental. |
| Hardware | MEDIUM | SOF may work after reboot + alsa-ucm-conf install, but this is unverified. USB mic is the guaranteed fallback. |
| Wake word accuracy | MEDIUM | openWakeWord "hey_jarvis" model lacks published accuracy metrics. Real-world testing needed in deployment environment. |

## Key Architecture Decision: Systemd vs Docker

Both STACK.md and ARCHITECTURE.md analyze this decision. **The recommendation is systemd service on the host.**

**Why systemd (not Docker):**
- Direct ALSA device access without Docker device passthrough complexity
- No permission issues with `/dev/snd` device nodes
- Survives host suspend/resume (Docker device mappings break on hot-plug)
- Consistent with how `jarvis-api` (llama-server) already runs on the host
- Hardware I/O services belong at the OS level, not containerized

**The voice-agent communicates with the backend via Socket.IO over localhost:4000** (backend already exposes this port via Docker port mapping). This is the same pattern the existing browser frontend uses.

## Gaps to Address

- **SOF driver status after reboot**: Unknown if digital mics will work. Need to verify after installing `alsa-ucm-conf` and rebooting. This is a hard prerequisite.
- **openWakeWord "hey_jarvis" accuracy**: No published per-model benchmarks. Need empirical testing in the deployment environment. Fallback: train custom model (1 hour on Google Colab) or switch to Porcupine free tier.
- **TTS sample rate compatibility**: The TTS services output at 22050Hz or 24000Hz. ALSA hardware may require 48000Hz. Need to verify if `plughw:` automatic resampling suffices or if manual resampling (scipy) is needed.
- **HDMI audio output usability**: NVIDIA HDMI outputs exist (card 0, devices 3/7/8/9) but require a connected display with speakers. Need to confirm if this is viable for the deployment location or if USB speaker is required.
- **Multi-turn voice conversation**: Current voice.ts creates a new session per utterance. Multi-turn voice (asking follow-up questions without repeating context) would require backend changes to maintain session state within a time window. Deferred to future milestone.

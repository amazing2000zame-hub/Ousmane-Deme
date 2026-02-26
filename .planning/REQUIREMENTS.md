# Requirements: Jarvis 3.1 — v1.8 Always-On Voice Assistant

**Defined:** 2026-02-25
**Core Value:** Walk into the room, speak to Jarvis, see and hear the response — no browser needed.

## v1.8 Requirements

### Audio Hardware

- [ ] **AUDIO-01**: System captures audio from physical microphone on Home node
- [ ] **AUDIO-02**: Built-in Intel SOF digital mics activated after reboot and tested
- [ ] **AUDIO-03**: USB microphone works as fallback if built-in mics are insufficient

### Voice Detection

- [ ] **VOICE-01**: Voice Activity Detection filters silence and background noise from mic stream
- [ ] **VOICE-02**: "Hey Jarvis" wake word triggers audio processing pipeline
- [ ] **VOICE-03**: Silence timeout (2s) detects end of utterance and triggers STT
- [ ] **VOICE-04**: Detected speech streams to backend via existing Socket.IO /voice namespace

### Speaker Output

- [ ] **SPEAK-01**: TTS audio plays through physical speaker on Home node
- [ ] **SPEAK-02**: Microphone mutes during TTS playback to prevent echo/self-triggering
- [ ] **SPEAK-03**: Conversation mode allows follow-up questions without repeating wake word (15s window)
- [ ] **SPEAK-04**: Audio confirmation chime plays when wake word is detected

### Display Control

- [ ] **DISP-01**: Jarvis can show camera feeds on physical display via voice command
- [ ] **DISP-02**: Jarvis can open the dashboard on physical display via voice command
- [ ] **DISP-03**: Jarvis can open any URL in browser on physical display via voice command
- [ ] **DISP-04**: Kiosk mode shows Jarvis listening/status indicator when idle
- [ ] **DISP-05**: Display shows Jarvis "face" or HUD animation during voice interaction

### Service Management

- [ ] **SVC-01**: Voice agent runs as systemd service with auto-restart on crash/reboot
- [ ] **SVC-02**: Auto-reconnects to backend after container restart or network disconnect
- [ ] **SVC-03**: Voice agent status visible in Jarvis dashboard (connected, listening, last interaction)

## Future Requirements (v1.9+)

### Multi-Room
- **MULTI-01**: Multiple voice agents in different rooms connecting to same backend
- **MULTI-02**: Room-aware responses ("Jarvis, turn on the kitchen lights" from kitchen agent)

### Advanced Audio
- **ADV-01**: Barge-in support (interrupt Jarvis mid-response with new command)
- **ADV-02**: Speaker diarization (identify who is speaking)
- **ADV-03**: Echo cancellation via hardware AEC or software DSP

### Display Advanced
- **DADV-01**: Multi-display routing (show camera on one display, dashboard on another)
- **DADV-02**: Picture-in-picture mode for camera overlays

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile voice interaction | Browser-based voice already works for mobile |
| Custom wake word model training | Pre-trained "hey_jarvis" model sufficient for v1 |
| Multi-room deployment | Get single room working first |
| Software echo cancellation | Too complex; mic mute during playback is sufficient |
| Continuous STT (always transcribing) | CPU-intensive, defeats purpose of wake word |
| Home Assistant voice integration | Separate ecosystem, not needed for cluster management |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUDIO-01 | — | Pending |
| AUDIO-02 | — | Pending |
| AUDIO-03 | — | Pending |
| VOICE-01 | — | Pending |
| VOICE-02 | — | Pending |
| VOICE-03 | — | Pending |
| VOICE-04 | — | Pending |
| SPEAK-01 | — | Pending |
| SPEAK-02 | — | Pending |
| SPEAK-03 | — | Pending |
| SPEAK-04 | — | Pending |
| DISP-01 | — | Pending |
| DISP-02 | — | Pending |
| DISP-03 | — | Pending |
| DISP-04 | — | Pending |
| DISP-05 | — | Pending |
| SVC-01 | — | Pending |
| SVC-02 | — | Pending |
| SVC-03 | — | Pending |

**Coverage:**
- v1.8 requirements: 19 total
- Mapped to phases: 0
- Unmapped: 19

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after initial definition*

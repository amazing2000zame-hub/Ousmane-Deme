# Feature Landscape: Server-Side Always-On Voice Assistant

**Domain:** Always-on server-side voice assistant with physical mic/speaker I/O
**Researched:** 2026-02-25
**Mode:** Ecosystem research for new milestone on existing Jarvis 3.1 system

---

## Context: What Already Exists

Before defining features, it is critical to understand the existing voice pipeline (shipped in v1.2-v1.5) that this milestone extends:

| Component | Status | Details |
|-----------|--------|---------|
| Whisper STT server | Running | faster-whisper medium.en, Docker port 5051, CPU int8, 4 threads |
| XTTS v2 TTS | Running | Custom JARVIS voice, Docker port 5050, GPU-accelerated |
| Piper TTS fallback | Running | CPU-only, <200ms latency, Docker port 5000 |
| Streaming TTS pipeline | Shipped | Sentence-by-sentence synthesis with parallel workers |
| TTS disk cache + LRU | Shipped | 500-entry disk cache, 200-entry in-memory cache |
| Opus encoding | Shipped | Optional 8-10x compression for remote access |
| Voice Socket.IO namespace | Shipped | `/voice` namespace with full event protocol |
| Voice processing pipeline | Shipped | audio_start -> audio_chunk -> audio_end -> STT -> LLM -> TTS |
| Pre-warmed phrases | Shipped | 40+ common JARVIS phrases pre-synthesized |

The backend `/voice` namespace (`voice.ts`) already implements the full server-side processing loop: receive audio chunks via Socket.IO, concatenate, transcribe via Whisper, route through LLM, stream sentence-by-sentence TTS back to the caller. **What is missing is the physical audio agent** -- the Python service that captures from a real microphone, detects when to listen, and plays audio through real speakers.

---

## Table Stakes

Features users expect from any always-on voice assistant. Missing any of these makes the product feel broken or unusable.

### TS-1: Physical Microphone Capture
| Aspect | Detail |
|--------|--------|
| **What** | Continuous audio capture from a USB microphone on the server |
| **Why expected** | Fundamental requirement -- without mic capture, nothing works |
| **Complexity** | Low |
| **Implementation** | PyAudio or sounddevice library reading from ALSA/PulseAudio device at 16kHz, 16-bit, mono PCM (matches Whisper input). For ALSA without PulseAudio, pyalsaaudio provides direct PCM access |
| **Dependencies** | USB microphone or USB speakerphone hardware, ALSA drivers on Debian 13 |
| **Testable** | `arecord -f S16_LE -r 16000 -c 1 -d 3 test.wav && aplay test.wav` succeeds on the server with clear audio |

### TS-2: Voice Activity Detection (VAD)
| Aspect | Detail |
|--------|--------|
| **What** | Distinguish speech from silence and background noise in the audio stream |
| **Why expected** | Without VAD, the system either records everything (wasting STT resources on 4 CPU threads) or nothing |
| **Complexity** | Low-Medium |
| **Implementation** | Silero VAD v6 -- processes 30ms chunks in <1ms on CPU, MIT license, supports 16kHz, ~2MB model |
| **Behavior** | Continuously evaluate audio frames; when speech probability exceeds threshold (default 0.5), begin buffering; when speech drops below threshold for configurable duration (1.5-2s), mark end of utterance |
| **Dependencies** | torch or onnxruntime (Silero supports both backends) |
| **Testable** | VAD correctly identifies speech segments in a test recording with >95% accuracy; does not trigger on ambient fan noise alone |
| **Confidence** | HIGH -- Silero VAD is the industry standard, used in Home Assistant, LiveKit, RealtimeSTT, and virtually all open-source voice projects |

### TS-3: Wake Word / Name Detection ("Jarvis" Trigger)
| Aspect | Detail |
|--------|--------|
| **What** | Detect "Jarvis" (or "Hey Jarvis") to trigger the assistant, filtering out background conversations and TV audio |
| **Why expected** | Without a trigger, the assistant either processes all speech (privacy/resource problem) or requires manual activation (defeats "always-on" purpose) |
| **Complexity** | Medium |
| **Implementation** | Two viable approaches (see Wake Word Strategy section below). MVP recommendation: VAD + STT + keyword check for "soft wake" behavior |
| **Dependencies** | TS-2 (VAD), Whisper STT (existing), or openWakeWord (pre-trained "hey_jarvis" model, ~0.42MB) |
| **Testable** | Say "Jarvis, check the cluster" from 3 meters -- system activates. Hold random conversation for 10 minutes -- zero false activations |
| **Confidence** | MEDIUM -- the "soft wake" concept (detecting "Jarvis" naturally in speech, not requiring "Hey Jarvis" cadence) is harder than traditional strict wake word detection |

### TS-4: Physical Speaker Output
| Aspect | Detail |
|--------|--------|
| **What** | Play TTS audio through physical speakers connected to the server |
| **Why expected** | The entire point -- user hears Jarvis respond out loud in the room |
| **Complexity** | Low |
| **Implementation** | Receive `voice:tts_chunk` events from backend (base64 WAV), decode, play through ALSA/PulseAudio using sounddevice or pyaudio. Sample rate conversion may be needed if TTS output rate differs from device |
| **Dependencies** | USB speaker, USB speakerphone, or 3.5mm powered speakers; ALSA drivers configured |
| **Testable** | `aplay /path/to/test.wav` produces audible, clear sound from connected speaker |

### TS-5: End-to-End Voice Loop
| Aspect | Detail |
|--------|--------|
| **What** | Complete pipeline: mic capture -> VAD -> name check -> STT -> LLM -> TTS -> speaker |
| **Why expected** | The fundamental promise. User speaks, Jarvis responds vocally |
| **Complexity** | Medium |
| **Implementation** | Python agent service connecting to existing jarvis-backend `/voice` Socket.IO namespace. The agent IS the Socket.IO client that sends `voice:audio_start`, `voice:audio_chunk`, `voice:audio_end` events and receives `voice:tts_chunk`, `voice:tts_done` events back |
| **Latency target** | < 8 seconds from end-of-speech to first audio output (realistic target given ~2-4s STT + ~0.5-3s LLM first token + ~0.2-4s TTS) |
| **Dependencies** | TS-1 through TS-4, existing Whisper/LLM/TTS infrastructure |
| **Testable** | Say "Jarvis, what is the cluster status?" -- hear a spoken response starting within 8 seconds of finishing the sentence |

### TS-6: Listening State Audio Feedback
| Aspect | Detail |
|--------|--------|
| **What** | Audible indication that Jarvis heard the trigger word and is now listening for the command |
| **Why expected** | Every commercial voice assistant (Alexa, Google, Siri, Sonos) provides an audible activation cue. Without it, users say commands into the void wondering if they were heard |
| **Complexity** | Low |
| **Implementation** | Play a short WAV chime (100-300ms) when wake word/name is detected. A subtle electronic tone matching the Iron Man JARVIS aesthetic. Optionally play a second sound when processing begins |
| **Dependencies** | TS-4 (speaker output working) |
| **Testable** | Say "Jarvis" -- hear activation chime within 500ms |

### TS-7: Silence and Timeout Handling
| Aspect | Detail |
|--------|--------|
| **What** | Stop listening and return to idle after configurable silence period or max recording duration |
| **Why expected** | Without this, the system hangs in "listening" mode forever if the user walks away or hesitates |
| **Complexity** | Low |
| **Implementation** | VAD-based silence detection (1.5-2s silence = end of utterance, matches existing `VOICE_SILENCE_TIMEOUT_MS` config in voice.ts) + hard timeout (30s max, matches existing `MAX_RECORDING_MS`) |
| **Behavior** | After silence timeout: process what was captured. After hard timeout: process and warn. After wake word with no speech: return to idle with no action |
| **Dependencies** | TS-2 (VAD) |
| **Testable** | Activate Jarvis, say nothing for 3 seconds -- system returns to idle without error |

### TS-8: Graceful Error Recovery and Auto-Reconnect
| Aspect | Detail |
|--------|--------|
| **What** | System recovers from failures (Whisper down, LLM timeout, TTS failure, mic disconnect, backend restart) without crashing or requiring manual intervention |
| **Why expected** | An always-on service that crashes on first error is unusable. Docker containers restart independently; the agent must handle this |
| **Complexity** | Medium |
| **Implementation** | Try/catch around each pipeline stage. Spoken error messages where possible ("I'm having trouble right now, sir"). python-socketio built-in reconnection with exponential backoff. Watchdog for mic device availability |
| **Behavior** | Backend disconnect -> reconnect with backoff (already built into python-socketio). Whisper failure -> speak cached error phrase, return to listening. Mic disconnect -> log, retry every 5s until device reappears. TTS failure -> log, return to listening |
| **Dependencies** | TS-4 (speaker for error messages), existing error handling in voice.ts backend |
| **Testable** | Kill Whisper container, speak a command -- hear error message, not a crash. Restart Whisper -- next command works. Restart Docker stack -- agent reconnects within 30s |

### TS-9: Always-On Systemd Service
| Aspect | Detail |
|--------|--------|
| **What** | The voice agent runs as a systemd service that starts on boot and auto-restarts on crash |
| **Why expected** | "Always-on" means surviving reboots and crashes without manual intervention. The jarvis-api (llama-server) already runs as a systemd service |
| **Complexity** | Low |
| **Implementation** | systemd unit file with `Restart=always`, `RestartSec=5`, `WantedBy=multi-user.target`. Log to journal for `journalctl -u jarvis-ear` monitoring |
| **Dependencies** | TS-5 (end-to-end loop working), TS-8 (error recovery) |
| **Testable** | Reboot the server -- voice agent comes back online within 30 seconds. Kill the process -- it restarts within 10 seconds |

---

## Differentiators

Features that elevate the experience beyond basic functionality. Not expected by default, but significantly improve how natural the interaction feels.

### D-1: Conversation Mode (Follow-Up Without Re-Triggering)
| Aspect | Detail |
|--------|--------|
| **What** | After Jarvis responds, keep listening for a follow-up command for 5-10 seconds without requiring the wake word again |
| **Why valuable** | Natural conversation flow. "Jarvis, check disk usage." [response] "What about on pve?" -- no need to say "Jarvis" again. Alexa launched this as "Conversation Mode" in 2021; Google launched "Continued Conversation" in 2018. It is now an expected pattern for premium voice assistants |
| **Complexity** | Medium |
| **Implementation** | After TTS playback completes, re-enter VAD listening with a shorter timeout (5-10s) that does NOT require the wake word. If speech detected within the window, process as continuation of the same conversation. If silence exceeds timeout, return to wake-word-only mode. Exit conversation mode on explicit "that's all" or "thanks Jarvis" |
| **Backend change** | Currently `voice.ts` creates a new session UUID per utterance. Conversation mode requires reusing the same sessionId within a time window so the LLM gets conversation context |
| **Dependencies** | TS-5 (end-to-end loop), TS-7 (silence handling) |

### D-2: Mic Mute During Playback (Self-Trigger Prevention)
| Aspect | Detail |
|--------|--------|
| **What** | Mute/ignore the microphone while Jarvis is speaking through the speaker to prevent the system from hearing its own voice and re-triggering |
| **Why valuable** | Without this, Jarvis's TTS output goes into the microphone, potentially triggering wake word detection or corrupting STT input. This is the simplest and most reliable solution to the acoustic echo problem |
| **Complexity** | Low |
| **Implementation** | Set a `playback_active` flag when TTS audio starts. While flag is set, discard all VAD/wake-word processing. Clear flag when playback completes. Simple, zero-DSP solution |
| **Tradeoff** | Prevents barge-in (D-3). User cannot interrupt Jarvis while it is speaking. This is acceptable for v1 |
| **Dependencies** | TS-4 (speaker), TS-2 (VAD) |

### D-3: Barge-In / Interruption Support
| Aspect | Detail |
|--------|--------|
| **What** | User can interrupt Jarvis mid-response by speaking, and Jarvis stops talking immediately |
| **Why valuable** | Essential for natural interaction with long responses. If Jarvis gives a detailed cluster report, the user should be able to say "stop" or redirect |
| **Complexity** | High |
| **Implementation** | During TTS playback, continue running VAD on mic input. If speech detected while playing audio, stop playback immediately, clear audio queue, start listening for new input. Requires acoustic echo cancellation to distinguish user speech from Jarvis's own audio in the microphone |
| **AEC options** | (1) Hardware AEC via USB speakerphone -- zero software effort, most reliable. (2) Software AEC via speexdsp -- complex, environment-dependent, fragile. (3) Wake-word-only barge-in: only interrupt if "Hey Jarvis" detected during playback (simpler than full speech detection during playback) |
| **Dependencies** | TS-2 (VAD), TS-4 (speaker), AEC solution (hardware recommended) |
| **Confidence** | MEDIUM -- hardware AEC via USB speakerphone is proven but must be tested. Software AEC is explicitly an anti-feature for v1 |

### D-4: Proactive Voice Announcements
| Aspect | Detail |
|--------|--------|
| **What** | Jarvis speaks unprompted to announce important events (security alerts, doorbell, cluster issues) |
| **Why valuable** | Transforms Jarvis from reactive tool to proactive assistant. "Sir, an unknown person has been detected at the front door" feels exactly like Iron Man JARVIS. Leverages existing alert infrastructure from Phase 29 (proactive alerts) and Phase 27 (presence intelligence) |
| **Complexity** | Low-Medium |
| **Implementation** | Backend events push announcements to the voice agent via Socket.IO (new event type `voice:announce`). Agent interrupts idle state, plays TTS. Priority queue: critical alerts (security) override everything; low-priority info waits for idle. Announcement cooldown prevents spam |
| **Dependencies** | TS-4 (speaker), existing alert/presence infrastructure |
| **Testable** | Trigger a test alert -- Jarvis announces through the speaker within 10 seconds |

### D-5: Configurable Sensitivity Thresholds
| Aspect | Detail |
|--------|--------|
| **What** | Expose VAD threshold, wake word sensitivity, silence timeout, and conversation mode timeout as configuration parameters |
| **Why valuable** | Different environments (quiet office vs noisy server room) need different tuning. Avoids hardcoding values that only work in one room |
| **Complexity** | Low |
| **Implementation** | YAML or JSON config file (`/etc/jarvis-ear/config.yml`) with sensible defaults. Parameters: `vad_threshold` (float, default 0.5), `wake_word_threshold` (float, default 0.5), `silence_timeout_ms` (int, default 1500), `conversation_timeout_ms` (int, default 8000), `max_recording_ms` (int, default 30000) |
| **Dependencies** | TS-2 (VAD), TS-3 (wake word) |

### D-6: Voice State Indicator in Web UI
| Aspect | Detail |
|--------|--------|
| **What** | Visual indicator in the existing Jarvis web UI showing the voice agent's current state: idle, listening, processing, speaking, error |
| **Why valuable** | When the browser UI is open, a glanceable indicator shows what Jarvis is doing. Extends the existing audio visualizer |
| **Complexity** | Low |
| **Implementation** | Voice agent emits state changes via Socket.IO to a new `voice:agent_state` event. The existing UI picks this up and displays a status badge or animates the existing AudioVisualizer |
| **Dependencies** | Existing Jarvis UI, TS-5 (state machine inherent in the voice loop) |

### D-7: Audio Level Monitoring and Gain Control
| Aspect | Detail |
|--------|--------|
| **What** | Monitor input audio levels and provide auto-gain or manual gain adjustment |
| **Why valuable** | USB microphone sensitivity varies by device and distance. Auto-gain helps with far-field capture (user across the room). Level monitoring helps diagnose "why isn't it hearing me?" issues |
| **Complexity** | Medium |
| **Implementation** | Calculate RMS audio level per frame. Log periodically. Optionally adjust ALSA capture volume via mixer controls (pyalsaaudio or `amixer` commands). Expose current level via status reporting |
| **Dependencies** | TS-1 (mic capture), ALSA mixer access |

---

## Anti-Features

Features to explicitly NOT build. These are tempting but would waste effort or harm the product.

### AF-1: Continuous Full-Time STT (Transcribe Everything Always)
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Transcribing all audio at all times regardless of VAD or wake word | Massive CPU waste: Whisper medium.en uses 4 CPU threads for 2-4s per utterance. The Home node has 20 threads shared with LLM inference, Docker, and TTS. Continuous STT would starve other services. Also a privacy concern -- recording and transcribing all conversations | Use VAD to gate STT. Only transcribe audio segments that contain detected speech after wake word activation. With the "soft wake" approach (Option B), every speech segment gets a lightweight STT pass, but only segments containing "jarvis" trigger full processing |

### AF-2: Cloud-Based Wake Word Detection
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Sending audio to cloud for wake word detection | Defeats privacy-first, local-processing philosophy. Adds internet dependency to a LAN-only system. Picovoice Porcupine has usage limits and requires API keys | Use openWakeWord or Silero VAD -- both 100% local, MIT license, zero telemetry, no API keys, no registration |

### AF-3: Software Echo Cancellation / Full DSP Pipeline (v1)
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Building software AEC, beamforming, dereverberation, or noise suppression | Enormous engineering effort that Amazon/Google/Apple spend years perfecting with dedicated DSP teams and custom silicon. Software AEC (speexdsp, WebRTC) is fragile and environment-dependent. A single-user server room does not warrant this | Use a USB speakerphone with hardware AEC (ReSpeaker, Jabra, Anker) which handles echo cancellation and noise suppression in dedicated hardware. For v1, simple mic muting during playback (D-2) is the reliable zero-effort alternative |

### AF-4: NLU/Intent Parsing in the Voice Agent
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Building intent classification, slot filling, or NLU in the Python agent | The LLM (Claude/Qwen) already handles all natural language understanding through the MCP tool system. Duplicating intelligence in the agent adds complexity with zero benefit | The agent's job is simple: capture audio, detect speech/wake word, stream to backend, play response. All intelligence stays in the existing backend pipeline |

### AF-5: Multi-Language Support (v1)
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Supporting multiple languages in the listener | Single-user English-only deployment. Whisper is already configured as medium.en (English-only, faster and more accurate). Multilingual complicates wake word, VAD, and TTS for zero benefit | English-only throughout the stack |

### AF-6: Multi-Room Satellite Architecture (v1)
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Building distributed multi-room satellite infrastructure from the start | Over-engineering for single-room deployment. Adds networking (MQTT/Wyoming protocol), synchronization, room detection, and audio routing complexity | Build for one room. The Socket.IO agent pattern with `agentId` already supports multiple agents connecting simultaneously -- multi-room extension requires only deploying additional agents later, not architectural changes now |

### AF-7: Streaming / Real-Time Partial STT
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time streaming transcription with partial results as user speaks | Requires fundamentally different architecture (WebSocket streaming, partial hypothesis management, correction/rollback). The existing Whisper server processes batch utterances. Latency benefit is marginal for 2-5 second voice commands | Batch STT: record complete utterance, transcribe in one shot. The 2-4s STT time is acceptable. Can optimize later with faster models (tiny.en) for the name-detection pass |

### AF-8: Custom TTS Voice Per Room / Per Context
| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Different TTS voices for different rooms or contexts | The JARVIS voice is the product identity. Multiple voices confuse the experience and multiply TTS configuration complexity | Use the same XTTS JARVIS voice (with Piper fallback) everywhere. Voice is configured once at the backend level |

---

## Feature Dependencies

```
TS-1 (Mic Capture) ───────────────────┐
                                       ├──> TS-5 (Voice Loop) ──> TS-8 (Error Recovery)
TS-2 (VAD) ──> TS-3 (Wake Word) ──────┤         |                        |
                                       │         |                        └──> TS-9 (Systemd)
TS-4 (Speaker Output) ────────────────┘         |
        |                                        ├──> D-1 (Conversation Mode)
        ├──> TS-6 (Listening Chime)              ├──> D-2 (Mic Mute) [simple]
        |                                        ├──> D-3 (Barge-In) [needs AEC]
        └──> TS-7 (Silence/Timeout)              ├──> D-4 (Announcements)
                                                 └──> D-6 (UI State Indicator)

TS-2 (VAD) ──> D-5 (Configurable Thresholds)
TS-1 (Mic)  ──> D-7 (Gain Control)

D-2 (Mic Mute) ──conflicts──> D-3 (Barge-In)
   [choose one per deployment: simple mute OR hardware AEC barge-in]
```

Key ordering constraints:
- TS-1 through TS-4 are independent infrastructure and can be built in parallel
- TS-5 integrates all four and is the central milestone deliverable
- TS-6 and TS-7 are trivial additions once TS-4 and TS-2 exist
- TS-8 and TS-9 make the system production-grade (always-on)
- D-1 through D-4 all require the complete TS-5 loop
- D-2 (mic mute) and D-3 (barge-in) are mutually exclusive strategies; pick one per deployment

---

## Wake Word Strategy: Detailed Analysis

The user wants a "soft wake" -- saying "Jarvis, check the cluster" as a natural sentence, not requiring the stilted "Hey Jarvis" pause-then-speak pattern. This is the most architecturally consequential decision for the milestone.

### Option A: Pure Wake Word Engine (openWakeWord "hey_jarvis")

openWakeWord runs continuously on all audio at <1ms per frame. When it detects "hey jarvis," it signals the start of a command. Audio after detection is recorded and sent to STT.

| Aspect | Assessment |
|--------|------------|
| Resource usage | Ultra-low (~0.42MB model, <1ms per frame on CPU) |
| False positive rate | <0.5 per hour (openWakeWord target) |
| False reject rate | <5% (openWakeWord target) |
| Supports "Hey Jarvis" | Yes -- the model is specifically trained for this phrase |
| Supports "Jarvis, do X" (mid-sentence) | No -- model expects the specific "hey jarvis" phrase |
| Supports "What do you think, Jarvis?" (name at end) | No |
| Latency to activation | <300ms from utterance |
| STT resource consumption | Minimal -- only transcribes post-wake-word audio |

### Option B: VAD + Full STT + Keyword Check (Recommended for MVP)

Silero VAD runs continuously. When speech is detected, buffer the entire utterance. Send to Whisper STT. Check transcript for "jarvis" (case-insensitive). If found, process transcript as command. If not found, discard.

| Aspect | Assessment |
|--------|------------|
| Resource usage | Moderate (every speech segment gets a Whisper pass) |
| False positive rate | Very low (Whisper rarely hallucinates "jarvis" from non-speech) |
| False reject rate | Low (full STT is more accurate than keyword spotting for name detection) |
| Supports "Hey Jarvis" | Yes |
| Supports "Jarvis, do X" (mid-sentence) | Yes |
| Supports "What do you think, Jarvis?" (name at end) | Yes |
| Latency to activation | 2-4s (must complete STT before knowing if "jarvis" was said) |
| STT resource consumption | Higher -- every speech segment transcribed |

**Resource impact mitigation:** In a home environment, speech occurs intermittently (every few minutes at most). Whisper medium.en on 4 threads processes a 5-second utterance in ~2 seconds. Use a lighter model (tiny.en or base.en, 4-10x faster) for the name-detection pass only; re-transcribe with medium.en only when "jarvis" is detected for higher-quality final transcript.

### Option C: Hybrid (Phase 2+ Optimization)

Run openWakeWord AND VAD+STT in parallel. openWakeWord provides instant response for "Hey Jarvis" (low latency fast path). VAD+STT provides flexible "Jarvis, do X" path (natural but slower).

**Recommendation:** Start with **Option B** for MVP -- simplest implementation, most flexible trigger patterns, matches the user's "soft wake" requirement exactly. Add Option A as a fast-path optimization later if the STT-on-every-utterance latency or resource usage becomes a problem.

---

## Latency Budget Analysis

| Stage | Estimated Latency | Notes |
|-------|-------------------|-------|
| VAD detection | <50ms | Silero VAD processes 30ms chunks in <1ms |
| Audio buffering (end-of-speech) | 1.5-2s | Silence timeout after user stops speaking |
| STT (Whisper medium.en) | 2-4s | Depends on utterance length, CPU load |
| Name check | <1ms | String search in transcript |
| Network to backend (Socket.IO) | <5ms | LAN, same machine or same subnet |
| LLM first token | 0.5-3s | Claude API ~0.5-1s, local Qwen ~1-3s |
| TTS first sentence | 0.2-4s | Piper <200ms, XTTS 3-10s (cache hit <10ms) |
| Audio playback start | <50ms | Local USB device, negligible |
| **Total: end-of-speech to first audio** | **~4-10s** | Best case ~4s (Piper + Claude + cache), worst ~12s (XTTS cold + Qwen) |

**Comparison to commercial assistants:**
- Alexa/Google: 1-3s simple queries, 3-8s complex queries
- Conversational UX research: 300-800ms feels natural, >1.4s is typical production voice AI
- Jarvis target: 4-10s is acceptable for a local, private, CPU-inference assistant

**Optimization levers (future phases):**
- Whisper tiny.en for name detection pass (~4x faster), medium.en only for final transcript
- TTS cache hits eliminate synthesis latency entirely for common phrases
- Speculative LLM warm-up during STT processing
- openWakeWord fast-path for "Hey Jarvis" (skips STT name-detection latency entirely)

---

## Hardware Recommendation

### Primary: USB Speakerphone with Hardware AEC

A USB conference speakerphone provides microphone + speaker + hardware echo cancellation in one device, eliminating the need for any software audio processing.

| Device | Mic Range | AEC | Est. Price | Linux Support | Best For |
|--------|-----------|-----|------------|---------------|----------|
| ReSpeaker USB Mic Array | 5m, 360 deg | Yes | ~$70 | Excellent (standard USB audio, no drivers) | Voice assistant projects specifically. Used by HA/Rhasspy communities |
| Anker PowerConf S330 | 5m | Yes | ~$50 | Good (standard USB audio) | Budget-friendly, better speaker quality |
| Jabra Speak 410 | 3m | Yes | ~$80 | Excellent | Proven enterprise reliability |
| Jabra Speak 510 | 4m | Yes | ~$100 | Excellent | Bluetooth + USB, portable |

**Recommendation:** ReSpeaker USB Mic Array for its 360-degree far-field pickup and purpose-built voice assistant design, OR Anker PowerConf S330 as a budget alternative with better speaker output quality.

### Alternative: Separate Mic + Speaker

If separate devices are used:
- **Challenge:** No hardware AEC -- must implement mic muting during playback (D-2), which prevents barge-in (D-3)
- **Mic:** Any USB condenser mic works but lacks far-field optimization
- **Speaker:** Any USB or 3.5mm powered speaker

### Server Audio Configuration (Home node, Debian 13, headless)

```bash
# Verify USB audio recognized
aplay -l    # List playback devices
arecord -l  # List capture devices

# Set defaults via PulseAudio (if installed)
pactl set-default-sink <usb-device-name>
pactl set-default-source <usb-device-name>

# Or via ALSA directly (if no PulseAudio)
# Edit /etc/asound.conf or ~/.asoundrc
```

---

## MVP Recommendation Summary

### Phase 1: Core Pipeline (all Table Stakes)
1. Hardware setup (USB speakerphone, ALSA verification)
2. Audio capture daemon with VAD (TS-1, TS-2)
3. Wake word / name detection via STT keyword check (TS-3)
4. Speaker output for TTS playback (TS-4)
5. End-to-end Socket.IO voice loop integration (TS-5)
6. Listening chime feedback (TS-6)
7. Silence/timeout handling (TS-7)
8. Error recovery and auto-reconnect (TS-8)
9. systemd service (TS-9)

**Deliverable:** Say "Jarvis, check the cluster" -- hear a spoken response.

### Phase 2: Natural Interaction (key Differentiators)
1. Mic mute during playback (D-2) -- prevents self-triggering
2. Conversation mode follow-ups (D-1) -- no re-triggering needed
3. Proactive announcements (D-4) -- leverages existing alerts
4. Configurable thresholds (D-5) -- environment tuning
5. UI state indicator (D-6)

### Phase 3: Polish
1. Barge-in support (D-3) -- if hardware AEC works well
2. Audio gain control (D-7)

### Defer
- Speaker identification (only if false triggers are a real problem)
- Multi-room satellites (architecture supports it; do not build orchestration)
- Streaming STT (marginal benefit for short commands)

---

## Sources

### Voice Activity Detection
- [Silero VAD GitHub](https://github.com/snakers4/silero-vad) -- v6.2.1, MIT license, <1ms/chunk, trained on 6000+ languages (HIGH confidence)
- [Silero VAD PyAudio streaming examples](https://github.com/snakers4/silero-vad/blob/master/examples/pyaudio-streaming/pyaudio-streaming-examples.ipynb) -- Reference for real-time mic capture + VAD (HIGH confidence)

### Wake Word Detection
- [openWakeWord GitHub](https://github.com/dscripka/openWakeWord) -- Open-source framework, MIT license, pre-trained models (HIGH confidence)
- [openWakeWord hey_jarvis model](https://github.com/dscripka/openWakeWord/blob/main/docs/models/hey_jarvis.md) -- ~200K synthetic training clips, ~0.42MB, dual-stage architecture (HIGH confidence)
- [Picovoice Wake Word Guide 2026](https://picovoice.ai/blog/complete-guide-to-wake-word/) -- Technical overview of wake word approaches (MEDIUM confidence)

### Reference Implementations
- [RealtimeSTT GitHub](https://github.com/KoljaB/RealtimeSTT) -- Combines Silero VAD + openWakeWord + faster-whisper (MEDIUM confidence)
- [Home Assistant Voice Satellite](https://www.home-assistant.io/voice_control/about_wake_word/) -- Wyoming protocol, satellite architecture patterns (MEDIUM confidence)

### Hardware
- [ReSpeaker USB Mic Array Wiki](https://wiki.seeedstudio.com/ReSpeaker-USB-Mic-Array/) -- 4-mic, 360-deg, hardware AEC (HIGH confidence)
- [HA Voice Satellite hardware discussion](https://community.home-assistant.io/t/assist-microphone-usb-conference-mic-speaker/725164) -- Community recommendations (MEDIUM confidence)

### UX and Latency
- [Twilio Voice Agent Latency Guide](https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents) -- <300ms magical, 300-800ms natural, >1.4s typical (MEDIUM confidence)
- [Alexa Conversation Mode](https://voicebot.ai/2021/11/18/new-alexa-conversation-mode-skips-wake-word-repetition/) -- Follow-up without wake word (MEDIUM confidence)
- [HA Assist chime request](https://community.home-assistant.io/t/assist-chime-or-other-acknowledgement-it-is-listening/703716) -- Audio feedback patterns (MEDIUM confidence)

### Barge-In and Echo Cancellation
- [Barge-In Interruption Guide](https://medium.com/@roshini.rafy/handling-interruptions-in-speech-to-speech-services-a-complete-guide-4255c5aa2d84) -- AEC requirements, implementation patterns (LOW confidence)
- [Vocal.com AEC Barge-In](https://vocal.com/echo-cancellation/aec-barge-in/) -- Technical AEC requirements (MEDIUM confidence)
- [Optimizing Voice Agent Barge-In 2025](https://sparkco.ai/blog/optimizing-voice-agent-barge-in-detection-for-2025) -- Current best practices (LOW confidence)

### Audio Configuration
- [PulseAudio ArchWiki](https://wiki.archlinux.org/title/PulseAudio) -- Comprehensive Linux audio reference (HIGH confidence)
- [PulseAudio Command Line](https://www.shallowsky.com/linux/pulseaudio-command-line.html) -- pacmd/pactl usage (MEDIUM confidence)

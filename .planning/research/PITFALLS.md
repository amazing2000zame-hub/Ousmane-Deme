# Domain Pitfalls -- Server-Side Always-On Voice Input/Output

**Domain:** Adding always-on server-side voice capture and playback to an existing Node.js/Docker AI assistant running on a headless Proxmox laptop server
**Researched:** 2026-02-25
**Confidence:** HIGH (verified against official SOF documentation, ALSA project docs, Docker device sharing bugs, voice-engine/ec project, Silero/openWakeWord benchmarks, Proxmox forum reports, and existing codebase analysis)

**Scope:** This document focuses on pitfalls specific to ADDING server-side always-on voice to the EXISTING Jarvis 3.1 system. The system currently has a working browser-based voice pipeline (mic capture in browser, WebSocket to backend, Whisper STT, LLM, TTS response streamed back). The new capability adds physical microphone capture and speaker playback on the Home node (i5-13500HX laptop running as headless Proxmox server), running alongside 6 Docker containers, llama-server, and Proxmox cluster services.

**Key system constraints:**
- Home node: i5-13500HX (14 cores / 20 threads), 24GB RAM
- OS: Debian 13 (trixie) / PVE kernel 6.14.11-5-pve
- Audio: Intel SOF firmware just installed, not yet rebooted; no PulseAudio/PipeWire
- Docker containers: jarvis-backend, jarvis-frontend, jarvis-tts, jarvis-piper, jarvis-searxng, jarvis-whisper
- llama-server: 16 threads on CPU, systemd service
- Existing voice pipeline: browser-based (must continue working)

---

## Critical Pitfalls

Mistakes that cause hardware lockups, audio device conflicts, or require fundamental redesigns.

---

### Pitfall 1: Intel SOF Firmware Fails to Initialize on Headless Proxmox Server

**What goes wrong:** The SOF (Sound Open Firmware) driver requires the Intel i915 graphics driver to initialize the HDMI audio codec. On a headless Proxmox server with no display connected, the i915 driver may fail to probe or be blacklisted (common in Proxmox GPU passthrough configurations). The SOF driver then reports "init of i915 and HDMI codec failed" and enters a deferred probe loop. This has already been observed on this system -- the firmware-sof-signed package was installed but the driver failed at boot with "deferred probe pending."

The critical nuance: on modern Intel laptops (Raptor Lake like the i5-13500HX), the SOF driver handles ALL audio -- not just HDMI. The digital microphone array (DMIC) and the internal speaker codec (typically Realtek or Cirrus Logic) are all routed through the SOF DSP. If SOF fails to load, there are NO ALSA devices at all -- not even the internal mics.

**Why it happens:** Proxmox kernels may have i915 loaded but without proper display initialization (no connected monitor). The SOF driver on newer kernels uses -EPROBE_DEFER to wait for i915, but if i915 never completes initialization (headless), SOF may remain in deferred probe indefinitely. On Proxmox systems where i915 is sometimes blacklisted for GPU passthrough, this completely prevents audio hardware from appearing.

**Consequences:**
- `aplay -l` shows no soundcards
- `/dev/snd/` directory is empty or missing PCM devices
- The entire always-on voice feature is impossible without working ALSA devices
- Rebooting does not help if the root cause is i915 initialization order

**Prevention:**
1. **After reboot, verify SOF loaded successfully.** Run `dmesg | grep -i sof` and `dmesg | grep -i "snd_hda\|snd_soc"`. Look for "Firmware boot complete" and card registration messages. If you see "deferred probe pending" after 30+ seconds, SOF is stuck.
2. **Ensure i915 is loaded and not blacklisted.** Check `/etc/modprobe.d/` for any `blacklist i915` entries (common in Proxmox GPU passthrough setups). The Home node does NOT use GPU passthrough (VM 100 was migrated without it), so i915 should be loadable.
3. **Try the legacy HDA driver as a fallback diagnostic.** Add `options snd-intel-dspcfg dsp_driver=1` to `/etc/modprobe.d/alsa-base.conf`. This forces legacy HD-Audio mode instead of SOF. It may work for the speaker codec but will NOT enable digital microphones (DMICs require DSP).
4. **Check NHLT ACPI tables for DMIC presence.** Run `dmesg | grep NHLT` after boot. If it reports "DMICs detected in NHLT tables: 2" (or 4), the hardware supports digital mics. If no NHLT entry, the laptop may not expose DMICs to the host (rare on modern laptops).
5. **Consider a USB sound card as a guaranteed fallback.** A USB audio adapter (e.g., USB conference speakerphone like Jabra Speak) completely bypasses SOF/i915 dependency. It appears as a standard USB audio class device, works with vanilla ALSA, and provides both mic and speaker in one unit. Cost: $20-80.

**Detection:** After reboot, run: `aplay -l && arecord -l`. If either shows no devices, SOF did not initialize. Check `cat /proc/asound/cards` for registered cards.

**Which phase should address it:** Phase 1 (Audio Hardware Foundation). This is a hard blocker. If SOF does not work, the entire feature requires a USB audio fallback strategy. Must be resolved before any software development begins.

**Confidence:** HIGH -- SOF/i915 dependency is documented in official SOF project docs. The deferred probe behavior is confirmed in kernel mailing list patches.

---

### Pitfall 2: Echo/Feedback Loop -- Jarvis Transcribes Its Own TTS Speech

**What goes wrong:** When Jarvis speaks through a physical speaker and the microphone is always-on, the mic captures the TTS audio output. Without acoustic echo cancellation (AEC), the system transcribes Jarvis's own speech, interprets it as a new user command, responds to it, creating an infinite feedback loop. This is the single most dangerous failure mode for an always-on voice assistant with co-located mic and speaker.

Even with a wake word, this is still dangerous: if Jarvis's TTS output contains the wake word or a phonetically similar phrase (e.g., Jarvis saying "as I mentioned earlier" could sound like "Jarvis" to a wake word detector), the system can self-trigger.

**Why it happens:** On a laptop, the built-in digital microphones are centimeters from the speaker. Even with the lid closed, sound conducts through the chassis. The microphone array is designed to be sensitive (it was built for video calls). Without AEC, the mic will clearly capture any audio the speaker plays.

**Consequences:**
- Infinite loop: Jarvis responds to itself forever, burning CPU and API credits
- Whisper transcribes garbage (TTS audio re-encoded through mic/speaker acoustics)
- System becomes unresponsive as multiple voice sessions stack up
- If using Claude API, runaway costs from infinite conversation loops

**Prevention:**
1. **Implement a "speaking" state lock (MANDATORY, Phase 1).** When TTS is playing through the speaker, the audio capture daemon MUST stop processing captured audio. This is not echo cancellation -- it is a hard mute during playback. Implementation: set a shared flag (file, socket message, or shared memory) that the capture process checks before processing each audio frame. This is the simplest and most reliable approach.
2. **Add a post-playback silence window.** After TTS finishes playing, wait 500-1000ms before resuming audio processing. Room reverberations and the laptop's built-in DSP may still be producing residual audio after playback "stops."
3. **Implement software AEC as a secondary defense (Phase 2+).** Use the voice-engine/ec project (SpeexDSP-based) with ALSA named pipes. This provides proper echo cancellation by subtracting the known playback signal from the recorded signal. However, SpeexDSP AEC takes several seconds to converge and has limited attenuation (~20-30dB), so it supplements but does not replace the speaking state lock.
4. **Never include wake word text in TTS output.** If the wake word is "Jarvis," strip it from any TTS output text. The system prompt already says "You are Jarvis" -- ensure TTS never says the trigger phrase aloud.
5. **Add a self-detection safety check.** After Whisper transcribes audio, compare it against the last TTS output text. If the transcript is >70% similar to what Jarvis just said, discard it silently. This is a last-resort safety net.

**Detection:** Monitor for rapid successive voice sessions (more than 2 per 10 seconds). Log when transcript text matches recent TTS output. Alert on API cost spikes.

**Which phase should address it:** The speaking state lock MUST be in Phase 1 (Audio Hardware Foundation). AEC is Phase 2+. Self-detection is a safety net added alongside wake word detection.

**Confidence:** HIGH -- This is a well-documented problem in all voice assistants with co-located mic/speaker. Home Assistant forums, Rhasspy community, and Mycroft all document this issue extensively.

---

### Pitfall 3: Docker Containers Cannot Access Host ALSA Devices Without Specific Configuration

**What goes wrong:** The existing Jarvis backend runs in a Docker container (jarvis-backend). If the audio capture service runs inside a Docker container and needs access to ALSA devices on the host, `--device /dev/snd` must be passed at container creation time. But even with device passthrough, there are permission issues: Docker versions have had bugs where `/dev/snd` devices are mounted with group root instead of group audio (Docker/moby issue #36457, fixed in runc 1.0.0-rc5 but can recur). Additionally, if the SOF driver creates/removes devices dynamically (e.g., on suspend/resume), the container loses access to devices that were mapped at startup.

**Why it happens:** Docker's device isolation is a security feature. ALSA device nodes (`/dev/snd/controlC0`, `/dev/snd/pcmC0D0c`, etc.) are character devices with specific major/minor numbers. The container must have both the device node and the correct group permissions. On Proxmox, the audio group GID on the host may not match what the container expects.

**Consequences:**
- Container sees devices but gets "Permission denied" when opening them
- Audio capture works on first start but breaks after host suspend/resume
- Multiple containers fighting over ALSA device access (only one can open a non-shared device)

**Prevention:**
1. **Run the audio capture daemon on the HOST, not in Docker (RECOMMENDED).** This completely avoids Docker-ALSA permission complexity. Run it as a systemd service on the Proxmox host. It communicates with the jarvis-backend container via Socket.IO over the Docker bridge network (the backend already exposes port 4000). This is the architecture the existing voice.ts handler was designed for -- it expects a remote "agent" to connect to the /voice namespace.
2. **If Docker is required, use `--privileged` or `--device /dev/snd` with `--group-add audio`.** The `--group-add` flag adds the host audio group to the container process. Verify the audio GID matches: `getent group audio` on host.
3. **Never share ALSA devices between multiple containers.** ALSA does not support concurrent access to the same PCM device without dmix/dsnoop. If the audio capture container opens the capture device, no other container can.
4. **For playback inside Docker, use network audio.** The TTS containers (jarvis-tts, jarvis-piper) already output audio as HTTP responses. The host-side daemon receives this audio and plays it through ALSA. Do not try to make TTS containers play audio directly.

**Detection:** Test audio access in the target environment before building the full pipeline: `docker run --rm --device /dev/snd -it debian:13 bash -c "apt update && apt install -y alsa-utils && arecord -d 2 test.wav"`. If this fails, the full feature will fail.

**Which phase should address it:** Phase 1 (Architecture Decision). Decide host-daemon vs Docker before any code is written.

**Confidence:** HIGH -- Docker/moby issue #36457 is publicly documented. Proxmox forum threads confirm ALSA device passthrough challenges.

---

### Pitfall 4: ALSA Without PulseAudio/PipeWire Has No Automatic Device Sharing

**What goes wrong:** On a pure ALSA system (no PulseAudio, no PipeWire), only one application can open a hardware PCM device at a time unless dmix (for playback) or dsnoop (for capture) is configured. If the always-on capture daemon opens `hw:0,0` for recording, no other process (including Docker containers with device passthrough) can record from the same device. Similarly, if TTS playback opens the hardware playback device, the capture daemon cannot simultaneously operate if the card does not support full-duplex.

**Why it happens:** ALSA hardware PCM access is exclusive by default. PulseAudio/PipeWire abstract this by proxying all audio through a single daemon that manages mixing and sharing. Without them, every application must use the ALSA dmix/dsnoop plugins explicitly, or only one application can access the device at a time.

**Consequences:**
- Capture daemon locks the mic; Docker containers cannot record
- Playback for TTS fails because capture daemon has the device open
- Race condition on boot: whichever service starts first claims the device
- No automatic sample rate conversion (ALSA dmix has a fixed rate)

**Prevention:**
1. **Configure asound.conf with dmix and dsnoop on day one.** Create `/etc/asound.conf` with an `asym` device combining `dmix` (output) and `dsnoop` (input) on the same hardware card. Set this as the default ALSA device. This allows multiple processes to share capture and playback simultaneously.
2. **Pin the sample rate in dmix/dsnoop to match your pipeline.** The voice pipeline uses 16kHz for STT input and 22050Hz or 24000Hz for TTS output. ALSA dmix locks to a single sample rate. Choose 48000Hz (common hardware default) and resample in software.
3. **Use `plughw:` prefix instead of `hw:` in application code.** `plughw:` enables ALSA's automatic format conversion (sample rate, bit depth, channels). `hw:` provides raw access and will fail if the requested format does not match hardware capabilities.
4. **Test full-duplex operation.** Run `arecord -d 5 test.wav &` and `aplay /usr/share/sounds/alsa/Front_Center.wav` simultaneously. If both succeed, full-duplex works. If one fails with "Device or resource busy," configure dsnoop/dmix.
5. **The host daemon is the ONLY process that should open ALSA devices directly.** All other audio I/O goes through the daemon via network protocols (Socket.IO for voice data, HTTP for TTS audio).

**Detection:** If any ALSA operation returns EBUSY (-16), device sharing is broken. Log all ALSA open/close operations with timestamps.

**Which phase should address it:** Phase 1 (Audio Hardware Foundation). The asound.conf configuration must be in place before the capture daemon is developed.

**Confidence:** HIGH -- ALSA sharing limitations are fundamental to the Linux audio architecture and extensively documented in ALSA project wiki.

---

## Moderate Pitfalls

Mistakes that cause degraded functionality, excessive resource usage, or require significant debugging.

---

### Pitfall 5: Always-On Audio Processing Exhausts CPU Budget

**What goes wrong:** The Home node already uses most of its CPU capacity. llama-server uses 16 threads for LLM inference (~75-95 tok/s prompt, 27-52 tok/s generation). The Docker stack (backend, TTS, Piper, Whisper, SearXNG) has cpuset allocations that overlap. Adding continuous audio capture, VAD processing, wake word detection, and periodic Whisper transcription to this load can cause system-wide performance degradation, especially during concurrent operations (user asks a question via browser voice while the server-side listener is active).

Current CPU allocation:
- llama-server (systemd): 16 threads, no cpuset limit
- jarvis-backend: cpuset 0-19, limit 8 CPUs
- jarvis-whisper: cpuset 10-13, limit 4 CPUs
- jarvis-piper: cpuset 14-19, limit 6 CPUs
- jarvis-tts: no cpuset (GPU reservation, falls back to CPU)
- New audio daemon: needs continuous processing

**Why it happens:** Developers underestimate the CPU cost of "lightweight" always-on processing. Silero VAD uses ~0.4% CPU for VAD alone (RTF 0.004 on x86), but the audio capture thread, sample rate conversion, ring buffer management, and periodic wake word detection add up. When a wake word is detected and audio is sent to Whisper, the Whisper container spikes to 4 CPU cores for 2-5 seconds. If this coincides with an LLM inference request, both slow down dramatically.

**Prevention:**
1. **Budget CPU explicitly.** Allocate a specific cpuset for the audio daemon (e.g., cores 18-19) and enforce it. Accept that wake word detection on 2 cores will be slightly slower than unconstrained.
2. **Use Silero VAD (not openWakeWord) for initial audio filtering.** Silero VAD uses <1% CPU at 16kHz and is a binary speech/silence detector. Only pass audio to the more expensive wake word detector when VAD detects speech. This creates a two-stage pipeline: VAD (cheap, always on) -> wake word (moderate, only during speech) -> Whisper (expensive, only on confirmed trigger).
3. **Throttle Whisper submissions.** The existing jarvis-whisper container is configured with cpuset 10-13 and limit 4 CPUs. Do not increase this. If a voice session is already being processed, queue the next one rather than running concurrent Whisper jobs.
4. **Monitor system load.** Add the audio daemon's CPU usage to the existing health endpoint. Alert if the daemon consistently uses >5% of a core during idle (no speech detected).
5. **Implement a "busy" state.** When the LLM is actively generating a response (high CPU), delay non-urgent audio processing. The voice pipeline already tracks LLM activity through the abortController pattern.

**Detection:** Track `process.cpuUsage()` in the Node.js backend. Monitor `/proc/loadavg`. If 1-minute load average consistently exceeds 16 (total cores minus headroom), the system is overloaded.

**Which phase should address it:** Phase 2 (Audio Capture Daemon). CPU budgeting must be part of the daemon design, not retrofitted.

**Confidence:** HIGH -- CPU allocation from docker-compose.yml verified directly. Silero VAD RTF benchmark from official GitHub README.

---

### Pitfall 6: Wake Word Detection Produces Too Many False Positives or False Negatives

**What goes wrong:** The wake word detector (for "Jarvis" or "Hey Jarvis") either triggers on non-speech sounds (TV audio, household noise, conversations not directed at the system) or fails to trigger when the user actually says the wake word. Both are frustrating: false positives cause Jarvis to interrupt with "How can I help?" when nobody called, and false negatives require repeating the wake word multiple times.

The problem is amplified in a server closet or home office environment with ambient noise from server fans (the i5-13500HX laptop will have active cooling), HVAC, and other household sounds.

**Why it happens:** Pre-trained wake word models (openWakeWord's "hey jarvis" model) are trained on diverse audio samples but not on YOUR specific environment. The laptop's digital microphone array has specific frequency response characteristics and picks up specific room acoustics. Fan noise from the laptop itself is a constant low-frequency background that the model may not have been trained on. Additionally, wake word sensitivity tuning is a difficult balance: lower threshold catches more true positives but also more false positives.

**Prevention:**
1. **Use a two-stage detection pipeline.** Stage 1: Silero VAD filters silence and non-speech audio (eliminates fan noise, HVAC, etc.). Stage 2: only when VAD detects speech, run the wake word model. This dramatically reduces false positives from non-speech sounds.
2. **Start with openWakeWord's pre-trained "hey jarvis" model and tune threshold empirically.** Default threshold is typically 0.5. Start at 0.7 (fewer false positives) and decrease if false negatives are too frequent. Log all detections with confidence scores for the first week.
3. **Consider a custom-trained wake word model.** openWakeWord supports training custom models from just a few examples. Recording 10-20 samples of "Hey Jarvis" in the actual deployment environment significantly improves accuracy.
4. **Add a confirmation window.** After wake word detection, listen for 500ms of additional speech. If VAD shows continued speech, confirm the trigger. If silence follows immediately, it was likely a false positive. Real users say "Hey Jarvis, what's the temperature?" -- there is always speech after the wake word.
5. **Implement per-environment calibration.** On first setup, run a 5-minute calibration phase that measures ambient noise levels and adjusts VAD thresholds accordingly. Store these in a config file.

**Detection:** Log all wake word triggers with confidence score, timestamp, and whether the subsequent voice session produced a valid transcript. Calculate false positive rate (triggers that lead to empty/noise transcripts) weekly.

**Which phase should address it:** Phase 3 (Wake Word and VAD). The two-stage pipeline design affects the capture daemon architecture.

**Confidence:** MEDIUM -- openWakeWord accuracy claims are from the project README, not independently verified in this specific hardware/environment. Silero VAD's ability to filter laptop fan noise specifically is unverified.

---

### Pitfall 7: PyAudio/sounddevice Buffer Overflow in Long-Running Daemon

**What goes wrong:** The audio capture daemon runs 24/7, continuously reading from the microphone. PyAudio (PortAudio wrapper) and sounddevice both use ring buffers for audio I/O. If the processing thread falls behind the audio capture rate (e.g., because of a CPU spike from concurrent Whisper transcription), the ring buffer overflows. PyAudio raises `IOError: [Errno -9981] Input overflowed`. If not handled correctly, the audio stream becomes corrupted -- subsequent reads return stale or partial frames, and the daemon must be restarted.

Over days/weeks of continuous operation, memory can also grow if audio buffers are not properly released. Python's garbage collector does not guarantee timely cleanup of large numpy arrays from audio frames.

**Why it happens:** Audio I/O operates on a strict real-time clock. At 16kHz/16-bit, the microphone produces 32KB/sec continuously. If the processing thread blocks for more than the buffer duration (typically 100-500ms), data is lost. Common causes: GIL contention from concurrent Python threads, disk I/O stalls, system-wide CPU pressure from llama-server or Docker containers.

**Prevention:**
1. **Use callback-mode audio capture, not blocking reads.** PortAudio's callback mode runs in a separate high-priority thread managed by the OS audio subsystem. The callback should ONLY copy data to a queue -- never do processing (VAD, wake word) inside the callback.
2. **Set `exception_on_overflow=False` in PyAudio reads.** If using blocking mode, this prevents exceptions on transient overflows. Log the overflow but continue operating.
3. **Use a bounded queue between capture and processing.** `queue.Queue(maxsize=100)` with 30ms chunks gives ~3 seconds of buffer. If the queue is full, drop the oldest chunk rather than blocking the capture thread.
4. **Implement a watchdog for the audio stream.** If no audio frames are received for 5 seconds, the ALSA device may have been lost (USB disconnect, driver crash). Close and reopen the stream.
5. **Run the daemon under systemd with restart-on-failure.** Configure `Restart=on-failure`, `RestartSec=3`, `WatchdogSec=30` in the systemd unit. The daemon should send `WATCHDOG=1` heartbeats via sd_notify to prove it is still processing audio. Use the `sdnotify` Python package.
6. **Monitor memory usage over time.** If RSS grows by more than 50MB over 24 hours, there is a memory leak. Common cause: accumulating audio buffers in a list that is never cleared.

**Detection:** Log buffer overflow events. If more than 10 overflows per minute, the processing thread is consistently falling behind. Track daemon uptime and restarts.

**Which phase should address it:** Phase 2 (Audio Capture Daemon). The daemon architecture (callback vs blocking, queue strategy) is a foundational design decision.

**Confidence:** HIGH -- PyAudio buffer overflow (errno -9981) is extensively documented in GitHub issues across speech_recognition, vosk-api, and Picovoice projects.

---

### Pitfall 8: Dual Voice Pipeline Conflict (Browser + Server-Side)

**What goes wrong:** The system has two voice input paths: (1) browser-based voice via WebRTC getUserMedia -> WebSocket -> backend /chat namespace, and (2) server-side voice via physical mic -> capture daemon -> backend /voice namespace. If both are active simultaneously (user has the Jarvis UI open with mic on AND the server-side listener is running), the system receives the same speech twice and generates two responses. Worse, the browser voice pipeline and server-side pipeline may route through different LLM providers or have different context windows, producing contradictory responses.

**Why it happens:** The two pipelines were designed independently. The browser pipeline sends audio via `chat:send` with `voiceMode: true`. The server-side pipeline sends via the `/voice` namespace. The backend treats them as separate sessions with separate session IDs. There is no coordination mechanism to detect that the same user said the same thing through two different input channels.

**Consequences:**
- Duplicate responses to the same question
- Two TTS outputs playing simultaneously (browser audio + physical speaker)
- Double API cost (two LLM calls for one utterance)
- Confusing user experience

**Prevention:**
1. **Implement a priority system.** Server-side voice is the "primary" input when active. When the server-side daemon is connected to /voice namespace, browser voice input should be suppressed or the user should see a "Server mic active" indicator.
2. **Add a "voice source" mutex in the backend.** When a voice session starts from any source, lock out new voice sessions for 30 seconds (typical response duration). The second source gets a "voice session already active" rejection.
3. **Use the same session ID for related voice interactions.** If the server-side daemon detects speech and the browser UI is open, route through a single session to maintain context continuity.
4. **Mute browser mic by default when server-side listening is active.** The frontend can check a backend endpoint (`GET /api/voice/status`) and disable the mic button when server-side voice is active.
5. **Consider making server-side voice the ONLY voice input.** The browser pipeline was a stepping stone. Once server-side voice works reliably, disable browser voice capture to eliminate the dual-pipeline complexity entirely. Keep browser TTS playback as an option.

**Detection:** Log voice session starts with source identifier ("browser" or "server"). Alert if two sessions start within 2 seconds of each other.

**Which phase should address it:** Phase 4 (Backend Integration). The /voice namespace handler already exists and expects a single agent connection. The mutex/priority logic should be added when wiring the server-side daemon to the existing backend.

**Confidence:** HIGH -- The dual pipeline architecture is visible in the existing codebase (chat.ts handles browser voice, voice.ts handles agent voice). No coordination mechanism exists.

---

### Pitfall 9: ALSA Configuration Breaks on Kernel Update or SOF Firmware Update

**What goes wrong:** Proxmox kernel updates (delivered via `apt upgrade`) can change the SOF firmware version, the ALSA kernel module version, or the device topology. After an update, ALSA device numbering may change (card 0 becomes card 1), device names change, or the SOF firmware version is incompatible with the new kernel. The carefully configured `/etc/asound.conf` that references `hw:0,0` or `card sof-hda-dsp` stops working.

**Why it happens:** Proxmox pushes kernel updates aggressively (the current kernel is 6.14.11-5-pve). The SOF firmware files in `/lib/firmware/intel/sof/` are separate from the kernel and may not be updated in lockstep. A new kernel may expect a newer SOF firmware topology file that does not exist, or an updated firmware may change ALSA topology (adding/removing PCM devices, changing mixer controls).

**Prevention:**
1. **Reference ALSA devices by name, not number.** Use `sysdefault:CARD=sofhdadsp` instead of `hw:0,0`. Card names are more stable across reboots and kernel updates.
2. **Pin the Proxmox kernel version for the audio subsystem.** Use `apt-mark hold proxmox-default-kernel pve-kernel-*` to prevent automatic kernel updates. Update manually after testing audio still works.
3. **Create a post-kernel-update audio test script.** Add a script to `/etc/kernel/postinst.d/` that runs `aplay -l && arecord -l` and emails results (using the existing email agent on agent1) after any kernel install.
4. **Keep the USB audio fallback ready.** If kernel updates break SOF, a USB audio device provides immediate recovery without downgrading the kernel.
5. **Document the working kernel version and SOF firmware version.** Record which exact combination works in CLAUDE.md so future troubleshooting has a known-good baseline.

**Detection:** After any `apt upgrade`, check `dmesg | grep -i sof` and `aplay -l` before assuming audio still works.

**Which phase should address it:** Ongoing (Operations). Not a development phase pitfall but an operational resilience concern. Address during Phase 1 setup documentation.

**Confidence:** MEDIUM -- Proxmox kernel update frequency is observed. SOF firmware version sensitivity is documented in SOF project issues but the specific impact on this hardware is unverified.

---

## Minor Pitfalls

Mistakes that cause degraded quality, suboptimal performance, or require minor rework.

---

### Pitfall 10: Digital Microphone Array Picks Up Laptop Fan Noise

**What goes wrong:** The i5-13500HX is a high-performance laptop CPU. Under load (llama-server doing inference), the cooling fans spin up significantly. The laptop's built-in digital microphone array is centimeters from the fan exhaust. The constant fan noise creates a noise floor that degrades Whisper transcription accuracy and causes false VAD triggers.

**Prevention:**
1. **Apply noise suppression before VAD.** Use RNNoise (lightweight neural noise suppressor) or the noise suppression from webrtc-audio-processing library to clean the audio before passing to VAD. RNNoise runs at <1% CPU and is specifically designed for removing background noise.
2. **Record a noise profile during system idle.** Capture 10 seconds of "silence" (actually fan noise) and use spectral subtraction to remove the noise signature from captured audio.
3. **Position matters.** If possible, elevate the laptop or point the mic array away from the primary fan exhaust. Even 30cm of separation significantly reduces direct fan noise pickup.
4. **Use an external USB microphone.** A USB microphone placed even 50cm from the laptop body will have dramatically better signal-to-noise ratio. A $15 USB conference mic will outperform the built-in DMIC array for always-on use.

**Which phase should address it:** Phase 2 (Audio Capture Daemon) -- noise suppression should be part of the audio processing pipeline.

**Confidence:** MEDIUM -- Fan noise from this specific laptop is assumed but not measured. The i5-13500HX is a 55W TDP mobile chip that will have significant cooling under load.

---

### Pitfall 11: Speaker Playback Volume Control Missing on Headless ALSA

**What goes wrong:** Without PulseAudio, there is no graphical or easy command-line volume control. ALSA mixer controls depend on the codec and SOF topology. The mixer control names are not standardized -- one card might use "Master," another uses "Speaker," another uses "DAC" or "PGA." If the wrong mixer control is adjusted, or if the mixer is muted by default after driver initialization, there is no audio output even though ALSA playback "succeeds" (no errors, but silence).

**Prevention:**
1. **Enumerate all mixer controls on first setup.** Run `amixer -c 0 contents` to list all controls, their ranges, and current values. Document which control affects the actual speaker output.
2. **Set volume in the audio daemon startup.** Use `amixer set 'Speaker' 80% unmute` (or whatever the correct control name is) as part of the systemd service ExecStartPre. This ensures volume is set correctly even after reboot.
3. **Verify with a test tone.** Play `speaker-test -c 2 -t wav -l 1` and physically verify sound comes out of the speaker. No amount of software testing replaces listening.
4. **Store ALSA state for persistence.** Run `alsactl store` after configuring mixer levels. This saves to `/var/lib/alsa/asound.state` and is restored on boot by the `alsa-restore` systemd service.

**Which phase should address it:** Phase 1 (Audio Hardware Foundation), during initial hardware verification.

**Confidence:** HIGH -- ALSA mixer naming inconsistency is a well-known Linux audio issue.

---

### Pitfall 12: Socket.IO Base64 Audio Encoding Wastes Bandwidth and CPU

**What goes wrong:** The existing voice.ts handler receives audio as base64-encoded strings in Socket.IO events (`voice:audio_chunk` with `audio` field as base64). Base64 encoding inflates binary data by 33%. For 500ms audio chunks at 16kHz/16-bit (16KB raw), each chunk becomes ~21KB base64. At continuous streaming rates, this adds unnecessary CPU overhead for encoding/decoding on both sides. For server-side voice (daemon to backend on the same machine or localhost), this overhead is wasteful.

**Prevention:**
1. **For localhost communication (daemon on host to backend in Docker), use binary Socket.IO events.** Socket.IO supports Buffer/ArrayBuffer natively. Send raw PCM bytes instead of base64. The existing protocol already handles binary in `chat:audio_chunk` (which sends Buffer directly as seen in chat.ts line 372).
2. **If base64 is kept for protocol compatibility, accept the 33% overhead.** At LAN speeds (1Gbps), the extra ~5KB per chunk is negligible. Optimize only if CPU profiling shows encoding as a bottleneck.
3. **Consider using a Unix socket instead of TCP for host-to-container communication.** Mount a Unix socket file into the Docker container. This eliminates TCP overhead for localhost communication. However, Socket.IO does not natively support Unix sockets as transport.

**Which phase should address it:** Phase 4 (Backend Integration). Low priority optimization.

**Confidence:** HIGH -- Base64 overhead is well-understood. The existing voice.ts code using base64 is visible in the codebase (voice.ts line 127).

---

### Pitfall 13: systemd Service Order and Audio Device Availability

**What goes wrong:** The audio capture daemon (systemd service) starts before the ALSA devices are fully initialized. SOF firmware loading and codec initialization can take 5-15 seconds after boot. If the daemon starts in the default `multi-user.target` timeframe, it may try to open ALSA devices that do not exist yet, fail, and either crash or enter a retry loop.

**Prevention:**
1. **Add `After=sound.target` to the systemd unit.** This ensures the service starts after the ALSA subsystem is initialized. Also add `Wants=sound.target`.
2. **Implement a startup retry with backoff.** The daemon should attempt to open ALSA devices, and if they fail, wait 2 seconds and retry. Give up after 30 seconds and log an error.
3. **Add a `ConditionPathExists=/dev/snd/controlC0` to the systemd unit.** This prevents the service from even starting if no sound card is present.
4. **Start Docker containers after the audio daemon is healthy.** If any Docker container needs audio access, add a dependency: the container waits for the audio daemon systemd service to report healthy via sd_notify.

**Which phase should address it:** Phase 2 (Audio Capture Daemon), specifically the systemd unit file design.

**Confidence:** HIGH -- systemd ordering with hardware devices is a common embedded Linux challenge.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Audio Hardware Foundation (Phase 1) | SOF fails to probe; no ALSA devices appear after reboot | Have USB audio fallback ready. Check dmesg immediately after reboot. Test `aplay -l` and `arecord -l` before writing any code. |
| Audio Hardware Foundation (Phase 1) | ALSA mixer is muted by default; speaker test produces silence | Run `amixer -c 0 contents` to find correct control. Set volume in ExecStartPre of systemd service. |
| Audio Capture Daemon (Phase 2) | Buffer overflows in long-running capture | Use callback-mode PortAudio, bounded queue, `exception_on_overflow=False`, systemd watchdog. |
| Audio Capture Daemon (Phase 2) | Fan noise causes constant false VAD triggers | Apply RNNoise preprocessing. Record noise profile for spectral subtraction. Consider external USB mic. |
| Wake Word & VAD (Phase 3) | Wake word fires on TV/music audio containing "Jarvis" | Two-stage pipeline (VAD -> wake word). Add post-trigger speech confirmation window. |
| Wake Word & VAD (Phase 3) | openWakeWord uses excessive CPU on continuous audio | Use Silero VAD as first gate. Only run wake word model when VAD detects speech. |
| Backend Integration (Phase 4) | Browser voice and server voice produce duplicate responses | Add voice source mutex. Priority system: server-side voice takes precedence. |
| Backend Integration (Phase 4) | Speaking state lock not properly synchronized | Use a file-based or socket-based flag. Post-playback silence window of 500-1000ms. |
| Echo Cancellation (Phase 5) | SpeexDSP AEC takes seconds to converge; does not attenuate enough | AEC supplements but does not replace speaking state lock. Test attenuation empirically in the actual room. |
| Echo Cancellation (Phase 5) | Named pipe architecture of voice-engine/ec is fragile | Pipes can break (SIGPIPE). Implement monitoring and auto-restart of ec process. |

---

## Integration Warnings Specific to This System

### Existing Docker Stack Interaction

The docker-compose.yml defines a `jarvis-net` bridge network. The audio daemon (running on the host) needs to reach the jarvis-backend container. Options:
- Connect to `localhost:4000` (backend port is published to host)
- Connect to the container IP on the jarvis-net bridge (requires knowing the IP)

**Recommendation:** Use `localhost:4000` for simplicity. The port is already published.

### Whisper Container Resource Contention

The jarvis-whisper container (cpuset 10-13, 4 CPU limit) is shared between browser voice and server-side voice. If both submit audio simultaneously, one request will queue behind the other. The Whisper medium.en model takes 2-5 seconds per transcription on 4 cores. Two concurrent transcriptions could take 10+ seconds.

**Recommendation:** The audio daemon should check if Whisper is busy before submitting. Implement a simple semaphore or use the existing health endpoint to check Whisper load.

### TTS Container is Already Overloaded

The XTTS v2 container already struggles with CPU inference (3-10s per sentence). Adding server-side TTS playback means the TTS container must synthesize for BOTH browser playback and physical speaker playback. These may happen concurrently if a browser session and server-side session overlap.

**Recommendation:** The Piper TTS fallback (fast, <500ms per sentence) should be the default for server-side voice output. XTTS should be reserved for browser sessions where the user explicitly expects the custom Jarvis voice. This reduces TTS contention.

### llama-server Interference

The llama-server systemd service uses 16 threads with no cpuset restriction. During LLM inference, it can saturate all 20 threads. The audio capture daemon must be resilient to CPU starvation during LLM bursts.

**Recommendation:** Set the audio daemon's CPU affinity to cores 18-19 (same as Piper TTS cpuset 14-19 but higher priority via `nice -n -5`). Audio capture is real-time and more latency-sensitive than TTS synthesis.

---

## Sources

- [SOF Project: Suggestions Before Filing a Bug](https://thesofproject.github.io/latest/getting_started/intel_debug/suggestions.html) -- SOF debugging, i915 dependency, legacy HDA fallback
- [SOF Driver Architecture](https://thesofproject.github.io/latest/architectures/host/linux_driver/architecture/sof_driver_arch.html) -- How SOF manages audio on Intel platforms
- [Docker/moby Issue #36457](https://github.com/moby/moby/issues/36457) -- /dev/snd device permissions broken in Docker
- [x11docker: Container Sound ALSA or Pulseaudio](https://github.com/mviereck/x11docker/wiki/Container-sound:-ALSA-or-Pulseaudio) -- Docker ALSA device sharing guide
- [voice-engine/ec: Echo Canceller](https://github.com/voice-engine/ec) -- SpeexDSP AEC for ALSA without PulseAudio
- [Silero VAD GitHub](https://github.com/snakers4/silero-vad) -- VAD performance benchmarks (RTF 0.004, <1% CPU)
- [openWakeWord GitHub](https://github.com/dscripka/openWakeWord) -- Pre-trained wake word models including "hey jarvis"
- [Proxmox Forum: Audio on Proxmox Host](https://forum.proxmox.com/threads/audio-on-proxmox-host.135564/) -- Audio on headless Proxmox
- [Proxmox Forum: Forward ALSA to LXC](https://forum.proxmox.com/threads/forward-alsa-audio-to-lxc-container.45310/) -- ALSA device passthrough in Proxmox
- [ALSA Project: Asoundrc](https://www.alsa-project.org/wiki/Asoundrc) -- dmix/dsnoop configuration reference
- [ALSA Project: snd-aloop](https://www.alsa-project.org/wiki/Matrix:Module-aloop) -- Virtual loopback device for echo cancellation
- [Rhasspy Wake Word Documentation](https://rhasspy.readthedocs.io/en/latest/wake-word/) -- Wake word detection approaches
- [PyAudio Input Overflow Issues](https://github.com/Uberi/speech_recognition/issues/51) -- Buffer overflow in long-running audio capture
- [systemd.service Documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) -- WatchdogSec, Restart, sd_notify
- [sdnotify Python Package](https://github.com/bb4242/sdnotify) -- systemd watchdog integration for Python daemons
- [Picovoice VAD Comparison 2026](https://picovoice.ai/blog/best-voice-activity-detection-vad/) -- Silero vs Cobra vs WebRTC VAD benchmarks

# Phase 33: Audio Hardware Foundation - Research

**Researched:** 2026-02-25
**Domain:** ALSA audio hardware (Intel SOF, USB audio, ALSA sharing), Linux kernel audio subsystem
**Confidence:** HIGH (based on live system investigation + verified documentation)

## Summary

The Home node (Acer laptop with Intel i5-13500HX running Proxmox headless) has a **fundamental blocker for Intel SOF digital microphones**: the Intel iGPU (00:02.0) is claimed by `vfio-pci` for VM passthrough, which prevents the `i915` GPU driver from initializing. The SOF audio driver (`sof-audio-pci-intel-tgl`) depends on i915 to initialize the HDMI codec path, and without it, the entire Intel audio controller at `00:1f.3` fails with "deferred probe pending: init of i915 and HDMI codec failed." The firmware (`firmware-sof-signed 2025.01-1`) is installed and the SOF modules are loaded, but the driver simply cannot bind to the device.

There are two paths forward: (1) Release the iGPU from VFIO and allow i915 to claim it, then reboot to let SOF probe successfully -- this requires that no VMs need iGPU passthrough (VM 100 has been migrated to agent1, VM 101 is stopped and does not use passthrough, so the VFIO config is essentially orphaned). Or (2) Accept that built-in digital mics will not work and go directly to USB microphone as the primary audio input. For output, HDMI playback exists through the NVIDIA card but requires a connected display. A USB speakerphone combo or Bluetooth speaker are the practical output options.

**Primary recommendation:** Remove the orphaned VFIO iGPU passthrough config, install `alsa-ucm-conf`, reboot, and verify SOF digital mics appear. Simultaneously plan USB mic as fallback. For speaker output, use a USB speakerphone (provides both mic + speaker in one device) as the simplest path.

## Standard Stack

### Core

| Tool/Package | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| alsa-utils | 1.2.14-1 | ALSA CLI tools (arecord, aplay, amixer, alsactl) | Already installed; standard ALSA management tools |
| firmware-sof-signed | 2025.01-1 | Intel SOF firmware for digital microphones | Already installed; required for Raptor Lake HDA controller |
| alsa-ucm-conf | 1.2.14-1 | ALSA UCM (Use Case Manager) profiles for SOF | **NOT installed, NEEDED**; provides topology profiles SOF uses to configure audio routes |
| snd-usb-audio (kernel module) | built-in | USB Audio Class driver | Already available in kernel; handles all USB class-compliant audio devices |

### Supporting

| Tool/Package | Version | Purpose | When to Use |
|-------------|---------|---------|-------------|
| bluez | 5.82-1.1 | Bluetooth stack | Only if using Bluetooth speaker; NOT installed |
| bluez-alsa-utils | 4.3.1-3 | BlueALSA (BT audio without PulseAudio) | Only if using Bluetooth speaker; NOT installed |
| speaker-test | (part of alsa-utils) | Test speaker output with noise/sine | Verification of audio output |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure ALSA (dmix/dsnoop) | PipeWire | PipeWire (1.4.2 available) adds complexity/dependency for headless server; ALSA dmix/dsnoop is simpler and sufficient |
| USB speakerphone | Separate USB mic + BT speaker | More devices, more config, BT adds latency and complexity |
| USB speakerphone | HDMI audio output | HDMI playback requires a connected display/monitor -- impractical for headless |

**Installation (Phase 33 will need):**
```bash
apt install alsa-ucm-conf
# Optionally, if BT speaker route chosen:
apt install bluez bluez-alsa-utils
```

## Architecture Patterns

### Hardware Audio Device Hierarchy (Current State)

```
PCI Audio Devices:
  00:1f.3 Intel Raptor Lake HDA [8086:7a50]
    Driver: sof-audio-pci-intel-tgl (FAILED - deferred probe)
    Reason: i915 dependency, iGPU claimed by vfio-pci
    Potential: Digital mics (capture), HDA analog (capture+playback)

  01:00.1 NVIDIA AD107 HDA [10de:22be]
    Driver: snd_hda_intel (WORKING)
    Provides: HDMI playback only (card 0, devices 3/7/8/9)
    Limitation: Requires connected HDMI display

USB Audio (none connected yet):
  snd-usb-audio module available in kernel
  Plenty of free USB ports (14+ USB 2.0, 8+ USB 3.0)

Bluetooth:
  Intel AX201 present (btusb driver loaded)
  bluez NOT installed -- BT audio not available yet
```

### Pattern 1: VFIO Release and SOF Activation

**What:** Remove orphaned VFIO iGPU passthrough, allow i915 to initialize, enabling SOF audio
**When to use:** First attempt -- try to get built-in digital mics working
**Steps:**
```bash
# 1. Remove VFIO configuration for iGPU
# Edit /etc/modprobe.d/vfio.conf - remove "options vfio-pci ids=8086:468b"
# Edit /etc/modprobe.d/vfio.conf - remove "softdep i915 pre: vfio-pci"

# 2. Install UCM profiles
apt install alsa-ucm-conf

# 3. Rebuild initramfs (critical -- VFIO config is baked into initrd)
update-initramfs -u

# 4. Reboot
reboot

# 5. Verify after reboot
arecord -l    # Should show Intel digital mics
aplay -l      # Should show Intel HDA playback + NVIDIA HDMI
dmesg | grep sof  # Should show successful probe
```

### Pattern 2: USB Audio Fallback

**What:** Connect a USB audio device that provides mic + speaker in one unit
**When to use:** If SOF fails even after VFIO release, or as permanent solution
**Steps:**
```bash
# 1. Connect USB audio device (speakerphone, USB mic, USB sound card)
# 2. Verify detection
arecord -l    # Should show USB capture device
aplay -l      # Should show USB playback device
cat /proc/asound/cards  # Should list new card

# 3. Configure as default in /etc/asound.conf
```

### Pattern 3: ALSA dmix/dsnoop Multi-Process Sharing

**What:** Configure ALSA to allow multiple processes to share audio devices
**When to use:** After any audio hardware is working -- needed for voice agent + other processes
**Configuration (`/etc/asound.conf`):**
```
# Hardware reference (adjust card number after hardware is confirmed)
pcm.snd_card {
    type hw
    card 0          # Adjust to actual card number
    device 0        # Adjust to actual device number
}

# Software mixing for playback (multiple writers)
pcm.dmixer {
    type dmix
    ipc_key 1024
    ipc_perm 0660
    slave {
        pcm "snd_card"
        rate 48000
        channels 2
        period_size 1024
        buffer_size 4096
    }
}

# Shared capture (multiple readers)
pcm.dsnooper {
    type dsnoop
    ipc_key 1025
    ipc_perm 0660
    slave {
        pcm "snd_card"
        rate 16000       # 16kHz is standard for speech recognition
        channels 1
        period_size 1024
        buffer_size 4096
    }
}

# Full duplex: combine playback + capture
pcm.duplex {
    type asym
    playback.pcm "dmixer"
    capture.pcm "dsnooper"
}

# Automatic format conversion wrapper
pcm.!default {
    type plug
    slave.pcm "duplex"
}

ctl.!default {
    type hw
    card 0          # Adjust to actual card number
}
```

### Anti-Patterns to Avoid

- **Installing PulseAudio on a headless Proxmox server:** Adds unnecessary complexity, session management issues, and daemon overhead. Use pure ALSA with dmix/dsnoop instead.
- **Forcing dsp_driver=1 (legacy HDA) to bypass SOF:** This disables digital microphone support entirely. The digital mics ONLY work with the SOF driver (dsp_driver=3).
- **Trying to reload SOF modules without fixing the i915 dependency:** The modules load fine; the problem is that i915 never bound to the iGPU because vfio-pci holds it. No amount of `modprobe -r / modprobe` will fix this without releasing VFIO.
- **Using PipeWire just for BT audio:** If the only reason for PipeWire is BT speaker support, use bluez-alsa instead -- it provides BT audio through the ALSA API without a full audio server.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-process audio sharing | Custom locking/IPC around `/dev/snd/*` | ALSA dmix/dsnoop plugins | Kernel-level IPC with proper buffer management, years of edge-case fixes |
| Audio device detection | Polling `/dev/snd` or udev scripts | `arecord -l` / `aplay -l` / `cat /proc/asound/cards` | Standard tools, portable, handle all card types |
| Bluetooth audio bridge | Custom `hcitool`/`bluetoothctl` scripting | `bluez-alsa-utils` (bluealsa + bluealsa-aplay) | Handles A2DP/HFP profiles, codec negotiation, automatic reconnection |
| Audio format conversion | Manual resampling code | ALSA `plug` plugin (wraps around dmix/dsnoop) | Handles sample rate, format, and channel conversion transparently |

**Key insight:** ALSA's plugin system (dmix, dsnoop, plug, asym) handles device sharing and format conversion at the library level without any daemon. This is the right approach for a headless server where no desktop audio session exists.

## Common Pitfalls

### Pitfall 1: SOF Deferred Probe Due to i915/VFIO Conflict
**What goes wrong:** SOF audio driver fails to initialize because it needs i915 to set up the HDMI codec, but i915 cannot claim the iGPU because vfio-pci holds it.
**Why it happens:** The VFIO configuration in `/etc/modprobe.d/vfio.conf` was set up for VM 100 iGPU passthrough. VM 100 has since been migrated to agent1, but the VFIO config remains, blocking audio.
**How to avoid:** Remove the VFIO iGPU config and rebuild initramfs before rebooting. Verify with `lspci -v -s 00:02.0` that i915 (not vfio-pci) claims the device after reboot.
**Warning signs:** `dmesg | grep "deferred probe"` shows "init of i915 and HDMI codec failed"; `arecord -l` shows no capture devices.

### Pitfall 2: Missing alsa-ucm-conf Package
**What goes wrong:** SOF firmware loads but no audio devices appear, or devices appear but routing is wrong.
**Why it happens:** SOF uses UCM (Use Case Manager) profiles to configure audio topology. Without `alsa-ucm-conf`, the profiles are missing and the driver doesn't know how to route the digital mics.
**How to avoid:** Install `alsa-ucm-conf` before rebooting for SOF activation.
**Warning signs:** SOF probes successfully in dmesg but `arecord -l` shows no capture devices, or `alsaucm` commands fail.

### Pitfall 3: initramfs Not Rebuilt After modprobe.d Changes
**What goes wrong:** VFIO changes to `/etc/modprobe.d/vfio.conf` have no effect after reboot.
**Why it happens:** The modprobe configuration is baked into the initramfs at boot. Changes to the files on disk only take effect after `update-initramfs -u` is run.
**How to avoid:** Always run `update-initramfs -u` after editing any file in `/etc/modprobe.d/`.
**Warning signs:** After reboot, `lspci -v -s 00:02.0` still shows vfio-pci as the driver despite config changes.

### Pitfall 4: ALSA Card Numbering Changes Between Reboots
**What goes wrong:** Card number in `/etc/asound.conf` becomes wrong after a reboot or USB device reconnection.
**Why it happens:** ALSA assigns card numbers dynamically based on detection order. USB devices may get different numbers.
**How to avoid:** Use card ID strings (`card "NVidia"` or `card "USB"`) instead of card numbers (`card 0`). Or pin card indices via `/etc/modprobe.d/alsa-base.conf` with `options snd_usb_audio index=1`.
**Warning signs:** Audio worked before reboot but fails after, with "No such device" errors.

### Pitfall 5: dsnoop Sample Rate Mismatch
**What goes wrong:** Voice recognition gets garbage audio or fails to capture.
**Why it happens:** dsnoop slave rate is set to 48000 Hz but the voice engine expects 16000 Hz, or vice versa. The `plug` wrapper can convert, but adds latency. If the hardware doesn't support the requested rate natively, dsnoop fails.
**How to avoid:** Check hardware-supported rates with `arecord --dump-hw-params -D hw:X,Y` before configuring dsnoop. Set dsnoop rate to a rate the hardware supports, and let the `plug` wrapper handle conversion for the application.
**Warning signs:** "Sample rate not available" errors; captures that sound sped-up or slowed-down.

### Pitfall 6: HDMI Audio Output Requires Connected Display
**What goes wrong:** `aplay -l` shows NVIDIA HDMI devices but playing audio produces silence.
**Why it happens:** HDMI audio requires an active HDMI connection with a display or HDMI dummy plug for the audio stream to be transmitted.
**How to avoid:** Don't rely on HDMI for audio output on a headless server. Use USB audio or Bluetooth instead.
**Warning signs:** HDMI devices appear in device list but `speaker-test` produces no sound.

## Code Examples

### Verify Audio Hardware After Reboot
```bash
# Source: standard ALSA tools documentation
# Check all sound cards
cat /proc/asound/cards

# List capture devices (microphones)
arecord -l

# List playback devices (speakers)
aplay -l

# Check SOF driver status
dmesg | grep -i sof

# Check i915 status (should show device bound)
lspci -v -s 00:02.0 | grep "Kernel driver"

# Check IOMMU group (should NOT show vfio-pci)
ls /sys/bus/pci/drivers/vfio-pci/
```

### Test Microphone Capture
```bash
# Source: ALSA documentation / arecord man page
# Record 5 seconds of audio from default capture device
arecord -d 5 -f S16_LE -r 16000 -c 1 /tmp/test.wav

# Record from specific device (adjust hw:X,Y)
arecord -D hw:1,0 -d 5 -f S16_LE -r 16000 -c 1 /tmp/test.wav

# Play back recording
aplay /tmp/test.wav

# Monitor mic level in real-time (text-based VU meter)
arecord -f S16_LE -r 16000 -c 1 -V mono /dev/null
```

### Configure Default Audio Device by Card ID
```bash
# Source: ArchWiki ALSA configuration
# /etc/asound.conf - use card ID instead of number
pcm.!default {
    type plug
    slave.pcm {
        type hw
        card "Audio"   # Use ID from /proc/asound/cards
        device 0
    }
}

ctl.!default {
    type hw
    card "Audio"
}
```

### Pin USB Audio Card Index
```bash
# Source: ArchWiki ALSA configuration
# /etc/modprobe.d/alsa-base.conf
# Force USB audio to always be card 1
options snd_usb_audio index=1
# Force Intel HDA to always be card 0
options snd_hda_intel index=0
```

### Remove VFIO iGPU Passthrough
```bash
# /etc/modprobe.d/vfio.conf - BEFORE (current state)
# Intel iGPU passthrough to VM 100
options vfio-pci ids=8086:468b
softdep i915 pre: vfio-pci

# /etc/modprobe.d/vfio.conf - AFTER (remove iGPU lines)
# (file can be empty or removed if no other VFIO devices)

# Then rebuild initramfs
update-initramfs -u
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| snd_hda_intel (legacy HDA) | snd_sof_pci_intel_tgl (SOF) | Kernel 5.2+ (2019) | Digital mics ONLY work with SOF; legacy HDA provides analog/HDMI but no DMIC |
| PulseAudio for audio sharing | ALSA dmix/dsnoop (headless) or PipeWire (desktop) | PipeWire 0.3+ (2021) | For headless servers, pure ALSA is simpler; PipeWire for desktop use |
| Manual BT audio scripts | bluez-alsa (BlueALSA) | bluez-alsa 4.x (2023) | Provides ALSA PCM interface for BT audio without PulseAudio/PipeWire |
| dsp_driver module param values | snd-intel-dspcfg dsp_driver=0/1/2/3/4 | Kernel 5.9+ | 0=auto, 1=legacy HDA, 2=SST, 3=SOF, 4=AVS |

**Deprecated/outdated:**
- **OSS (Open Sound System):** Replaced by ALSA decades ago. Do not use `/dev/dsp`.
- **PulseAudio on headless servers:** Unnecessary overhead; ALSA dmix/dsnoop handles multi-process sharing.
- **snd_hda_intel for digital mics on Skylake+:** The kernel intentionally redirects to SOF for platforms with digital mics. Forcing legacy HDA loses DMIC support.

## Live System Investigation Results

### Current Hardware State (verified 2026-02-25)

| Component | State | Detail |
|-----------|-------|--------|
| Intel HDA Controller (00:1f.3) | **FAILED** | `sof-audio-pci-intel-tgl` deferred probe due to i915 |
| Intel iGPU (00:02.0) | Claimed by vfio-pci | IOMMU group 0 (separate from audio in group 25) |
| i915 kernel module | Loaded, 0 devices | Cannot claim iGPU because vfio-pci holds it |
| NVIDIA HDA (01:00.1) | **WORKING** | HDMI playback only (card 0, devices 3/7/8/9) |
| SOF firmware | Installed | `/lib/firmware/intel/sof/sof-tgl.ri` and topology files present |
| alsa-ucm-conf | **NOT installed** | Required for SOF UCM profiles |
| Bluetooth (AX201) | Hardware present | `btusb` driver loaded, but `bluez` package NOT installed |
| USB audio | No device connected | `snd-usb-audio` module available in kernel |
| Capture devices | **NONE** | `arecord -l` returns empty |
| Playback devices | NVIDIA HDMI only | Requires connected display (headless = unusable) |
| VFIO config | Orphaned | VM 100 migrated to agent1; iGPU passthrough config remains on Home |

### VFIO Configuration (Root Cause)

File: `/etc/modprobe.d/vfio.conf`
```
# Intel iGPU passthrough to VM 100
options vfio-pci ids=8086:468b
softdep i915 pre: vfio-pci
```

This configuration:
1. Forces `vfio-pci` to load before `i915` (softdep)
2. Tells `vfio-pci` to claim device `8086:468b` (Intel iGPU)
3. Prevents `i915` from ever getting the device
4. SOF driver needs i915 to init HDMI codec path -> fails with deferred probe

VM 100 (which used this passthrough) is now on agent1. No VM on Home node uses the iGPU. **This config is safe to remove.**

### Kernel Boot Parameters

```
BOOT_IMAGE=/boot/vmlinuz-6.14.11-5-pve root=/dev/mapper/pve-root ro quiet intel_iommu=on iommu=pt
```

Note: `intel_iommu=on iommu=pt` should remain even after removing VFIO config (needed for Proxmox general operation). They do not cause the audio issue -- only the vfio.conf config does.

### IOMMU Group Separation (Good News)

- iGPU (00:02.0): IOMMU group 0 (alone)
- Intel Audio (00:1f.3): IOMMU group 25 (alone)

These are in **separate IOMMU groups**, meaning releasing the iGPU from VFIO will NOT affect any other device. Clean operation.

## Open Questions

1. **Will SOF digital mics actually work after removing VFIO and rebooting?**
   - What we know: Firmware is installed, modules are loaded, the only blocker is i915 not having the iGPU. The laptop BIOS reports digital mics present ("Digital mics found on Skylake+ platform").
   - What's unclear: Whether the laptop model (Acer with i5-13500HX) has working digital mics in headless mode even with i915 initialized. Some laptop DMICs require the lid to be open or specific ACPI conditions.
   - Recommendation: Try the VFIO removal + reboot first. If no capture device appears even with SOF probing successfully, fall back to USB mic.

2. **What specific USB microphone/speakerphone to use?**
   - What we know: Any USB Audio Class compliant device will work with `snd-usb-audio`. Common choices include Jabra Speak 410/510 (USB speakerphone with both mic + speaker), generic USB condenser mics, or simple USB sound card + analog mic.
   - What's unclear: User's preference for audio quality, form factor, and budget.
   - Recommendation: A USB speakerphone (Jabra Speak 410 or similar) is the simplest single-device solution providing both capture and playback. Alternatively, any cheap USB microphone ($10-20) plus a small USB speaker works.

3. **Is Bluetooth speaker viable for output?**
   - What we know: Intel AX201 Bluetooth is present and `btusb` driver loaded. `bluez` 5.82 and `bluez-alsa-utils` 4.3.1 are available in Debian repos.
   - What's unclear: Bluetooth audio latency (typically 100-300ms) may be noticeable. Pairing must be done programmatically on headless system.
   - Recommendation: USB audio is simpler and more reliable. Use BT only if a BT speaker is already owned and USB options aren't available.

4. **Will the reboot affect cluster quorum?**
   - What we know: HomeCluster has 4 nodes with quorum of 3. Temporarily losing the Home node during reboot won't break quorum as long as the other 3 (pve, agent1, agent) are up.
   - What's unclear: Whether other services on Home (Docker stack, llama-server, Samba shares) will be impacted.
   - Recommendation: Schedule the reboot during low-usage window. Verify all 3 other nodes are up before rebooting.

## Sources

### Primary (HIGH confidence)
- **Live system investigation** -- `dmesg`, `lspci`, `lsmod`, `arecord -l`, `aplay -l`, `/proc/asound/*`, `/sys/bus/pci/devices/*` on Home node (192.168.1.50) -- direct observation of current hardware state
- **SOF Project documentation** -- https://thesofproject.github.io/latest/getting_started/intel_debug/introduction.html -- platform support, dsp_driver parameter values
- **ArchWiki ALSA** -- https://wiki.archlinux.org/title/Advanced_Linux_Sound_Architecture -- dmix/dsnoop/asym configuration, USB audio setup
- **ArchWiki ALSA Configuration Examples** -- https://wiki.archlinux.org/title/Advanced_Linux_Sound_Architecture/Configuration_examples -- verified asound.conf patterns
- **Kernel module parameters** -- `modinfo snd_intel_dspcfg`, `modinfo snd_sof`, `modinfo snd_sof_pci` -- confirmed dsp_driver values and SOF parameters

### Secondary (MEDIUM confidence)
- **ALSA OpenSrc wiki** -- https://alsa.opensrc.org/Asym, https://alsa.opensrc.org/Dmix, https://alsa.opensrc.org/Dsnoop -- dmix/dsnoop/asym plugin documentation
- **Proxmox forum** -- https://forum.proxmox.com/threads/stop-intel-igpu-from-using-vfio-and-make-it-use-original-host-i915-driver-i-e-revert-passthrough.126692/ -- reverting VFIO passthrough procedure
- **Debian Bluetooth/ALSA wiki** -- https://wiki.debian.org/Bluetooth/Alsa -- bluez-alsa setup on Debian
- **Jabra Linux compatibility** -- https://www.jabra.com/supportpages/jabra-speak-510/7510-209/faq -- confirmed snd-usb-audio compatibility

### Tertiary (LOW confidence)
- **USB speakerphone specific Linux test results** -- limited to community forum posts; specific model compatibility should be validated after purchase
- **SOF digital mic behavior in headless mode after VFIO removal** -- no exact precedent found for this specific hardware config; needs empirical verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- ALSA tools are well-established, packages verified in Debian repos, kernel modules confirmed present
- Architecture (VFIO root cause): HIGH -- directly verified via live system investigation, IOMMU groups confirmed separate, VFIO config read and understood
- Architecture (SOF fix after VFIO removal): MEDIUM -- the theory is sound (remove VFIO -> i915 claims iGPU -> SOF probes successfully) but has not been empirically tested on this specific hardware
- Pitfalls: HIGH -- each pitfall identified from direct system observation or verified documentation
- USB audio fallback: HIGH -- kernel module present, USB ports available, well-documented path
- Bluetooth audio: MEDIUM -- hardware present, packages available, but not tested; added complexity for headless setup

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (hardware investigation is stable; package versions may update)

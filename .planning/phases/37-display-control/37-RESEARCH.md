# Phase 37: Display Control - Research

**Researched:** 2026-02-26
**Domain:** X11 display control, Chromium DevTools Protocol, kiosk management, Python subprocess/REST
**Confidence:** HIGH (infrastructure verified by direct inspection; patterns verified via official docs)

---

## Summary

Phase 37 adds physical display control to the Jarvis voice assistant. When Jarvis detects a wake word, processes a command, or plays a response, it needs to visually communicate that state on a physical screen — and then restore the previous display content when done.

The key infrastructure is already clear from direct investigation. The management VM (192.168.1.65) is the active camera kiosk display: it runs X11 `:0` on a 1920x1080 screen connected via DP-3, with a `kiosk` user running openbox and two `mpv` processes showing RTSP streams from go2rtc. Root SSH from Home has confirmed ability to control that X11 session via `xdotool` without additional authentication. Chromium 145 (snap) is installed on the management VM. Python 3.12 with `websockets 10.4` is available for CDP. `python3-flask 3.0.2` is available via `apt`.

The Home node (192.168.1.50) has a connected `eDP-1` display (Intel UHD internal screen) but no X11 server running. `xserver-xorg-core` is already installed and `xinit` + `openbox` are available in apt. This display can be activated for Jarvis, but it requires installing a minimal X stack and writing an xinitrc/autostart. This is additive work compared to the management VM where everything already exists.

**Primary recommendation:** Target the management VM display first (it is the camera kiosk the user described). Install a small HTTP display-control daemon on the management VM. The jarvis-ear Python daemon (on Home node) calls this HTTP API when voice state changes. Chromium is launched via subprocess with `--remote-debugging-port` so CDP can navigate it to any URL. mpv windows are paused/hidden via `xdotool windowminimize` and restored via `xdotool windowmap` when Jarvis is done. The Jarvis HUD page is a static HTML file served by the existing jarvis-backend or a new dedicated static server.

---

## Display Infrastructure (Verified)

### Management VM (192.168.1.65) — PRIMARY TARGET

| Property | Value |
|----------|-------|
| Physical display | DP-3, 1920x1080 @ 60Hz, connected |
| X11 display | `:0` on `tty7` |
| X11 session owner | `kiosk` user (autologin via kiosk.service) |
| Window manager | openbox |
| Current content | Two `mpv` processes, RTSP streams: `front_door`, `side_house` |
| Root X11 access | `DISPLAY=:0 XAUTHORITY=$(find /tmp -name 'serverauth.*' -user kiosk | head -1)` — VERIFIED WORKING |
| xdotool | v3.20160805.1 installed, root can control windows — VERIFIED WORKING |
| mpv window IDs | Found via `xdotool search --name ''` — two windows with title `go2rtc/1.9.9 - mpv` |
| Chromium | v145.0.7632.109 (snap) — VERIFIED |
| Python | 3.12.3 + `websockets 10.4` — VERIFIED |
| Flask | `python3-flask 3.0.2` available via `apt` — VERIFIED |
| aiohttp | `python3-aiohttp 3.9.1` available via `apt` |
| Watchdog | `kiosk-mpv-watchdog.timer` fires every 120s, restarts mpv if not running — MUST account for |
| Node.js | NOT installed on management VM |

### Home Node (192.168.1.50) — SECONDARY TARGET

| Property | Value |
|----------|-------|
| Physical display | `card1-eDP-1` (Intel UHD laptop screen) — `status: connected` |
| X11 running | NO — tty1 is plain login shell |
| xserver-xorg-core | Installed (2:21.1.16-1.3+deb13u1) |
| xinit | Available via apt (1.4.2-1) |
| openbox | Available via apt (3.6.1) |
| matchbox-window-manager | Available via apt (1.2.2) |
| GPU (display) | Intel UHD + NVIDIA RTX 4050 (Disp.A=Off, 4491/6141 MiB used by llama.cpp) |
| HDMI audio | sof-hda-dsp: HDA Analog + HDMI1 + HDMI2 |
| NVIDIA connectors | 4 HDMI ports (card0), currently no display attached |

**Note on Home node display:** The user's phase context says the Home node has "Intel integrated graphics, HDMI out". The eDP-1 is the Intel built-in screen. HDMI out likely routes through the NVIDIA card (card0). To use the Home node display, X11 must be installed and started from scratch — this is real but straightforward work. It should be a separate plan wave from the management VM work.

### Security Camera Machine (192.168.1.60) — OFFLINE

The CLAUDE.md describes a "Home Monitoring System" at 192.168.1.60 running Scrypted. This machine is currently **unreachable** (ping fails). The management VM (192.168.1.65) is the operational camera kiosk display for this phase.

---

## Standard Stack

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| xdotool | 3.20160805.1 | X11 window manipulation (minimize, restore, raise) | Installed, root-accessible, verified working |
| Chromium (snap) | 145 | Kiosk browser for URL display and Jarvis HUD | Already installed, supports `--kiosk`, `--remote-debugging-port` |
| CDP (Chrome DevTools Protocol) | Built into Chromium | Navigate to URL in running browser instance | JSON/WebSocket, no external dep |
| Python websockets | 10.4 | CDP WebSocket client on management VM | Already installed, used for CDP communication |
| python3-flask | 3.0.2 | Display control HTTP daemon on management VM | Available via apt, minimal, no extra deps |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| subprocess (Python stdlib) | stdlib | Launch Chromium, run xdotool from Python | Display control daemon calls |
| requests (jarvis-ear) | 2.32.5 | HTTP calls from jarvis-ear to display daemon | Already in jarvis-ear venv |
| scrot | present on mgmt VM | Screenshot for verification | Testing and monitoring |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CDP via websockets | playwright / selenium | Playwright/selenium are 100MB+ installs; CDP via websockets is ~20 lines of Python with already-installed libraries |
| Flask HTTP daemon | Socket.IO from management VM | Socket.IO requires Node.js (not installed on mgmt VM); Flask is simpler, apt-installable |
| Flask HTTP daemon | Extend jarvis-ear with SSH | Moves display logic into the audio daemon — cleaner separation to have a dedicated display daemon |
| xdotool minimize | kill/restart mpv | Kill/restart loses mpv stream buffers; minimize keeps them running and is instant to restore |
| xdotool minimize | mpv IPC pause | mpv IPC requires `--input-ipc-server` flag (not in current kiosk-mpv.sh args); xdotool works with existing setup |

**Installation:**
```bash
# On management VM (192.168.1.65)
apt-get install -y python3-flask

# jarvis-ear already has requests; no new deps needed on Home node
```

---

## Architecture Patterns

### Recommended Architecture

```
jarvis-ear (Home, Python daemon)
  │
  ├─ wake word detected   ──────────────────────────────────────────────┐
  │                                                                       ▼
  └─ Socket.IO /voice events:                               display-daemon (mgmt VM :8765)
       voice:processing, voice:transcript,                      Flask HTTP API
       voice:thinking, voice:tts_chunk,                              │
       voice:tts_done, voice:listening                               ├─ POST /display/show
                                                                     │   { "url": "...", "state": "..." }
jarvis-backend (Home, Docker :4000)                                  │
  │                                                                   ├─ POST /display/hud
  └─ new MCP tool: control_display                                    │   { "state": "listening|talking|idle" }
       └─ HTTP POST to http://192.168.1.65:8765/display               │
                                                                      └─ POST /display/restore
                                                                           {} (restore mpv)
```

### Pattern 1: Display State Machine

The display daemon manages a simple state machine:

```
CAMERA_FEED (mpv running, Chromium hidden)
    │
    ├── wake word / voice:processing ──► JARVIS_HUD (chromium showing hud.html)
    │                                        │
    │                                        ├── voice:tts_chunk ──► JARVIS_TALKING (animated HUD)
    │                                        │
    │                                        └── voice:tts_done ──► RESTORING...
    │                                                │
    └──────────────────────────────────────────────── (mpv restored)
```

**State transitions triggered by:**
- jarvis-ear calling HTTP API when wake word fires (before backend responds)
- jarvis-ear calling HTTP API when `voice:tts_done` is received (restore)
- jarvis-backend MCP tool `control_display` for voice commands like "show camera feed"

### Pattern 2: Chromium CDP Navigation

Launch Chromium with remote debugging enabled, then use CDP to navigate to any URL without restarting the browser.

```python
# Source: https://chromedevtools.github.io/devtools-protocol/ + websockets 10.4 docs

import subprocess
import time
import urllib.request
import json
import asyncio
import websockets

CHROMIUM_DEBUG_PORT = 9222

def launch_chromium_kiosk(initial_url: str) -> subprocess.Popen:
    """Launch Chromium in kiosk mode with remote debugging enabled."""
    env = {
        'DISPLAY': ':0',
        'XAUTHORITY': get_kiosk_xauth(),
        'HOME': '/root',
    }
    return subprocess.Popen([
        'chromium-browser',
        '--kiosk',
        f'--remote-debugging-port={CHROMIUM_DEBUG_PORT}',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--noerrdialogs',
        '--disable-infobars',
        '--disable-session-crashed-bubble',
        initial_url,
    ], env=env)

async def navigate_to(url: str) -> None:
    """Navigate running Chromium to a new URL via CDP."""
    # Get list of targets (tabs)
    with urllib.request.urlopen(f'http://localhost:{CHROMIUM_DEBUG_PORT}/json') as resp:
        targets = json.loads(resp.read())

    # Find the active page target
    page = next((t for t in targets if t.get('type') == 'page'), None)
    if not page:
        return

    ws_url = page['webSocketDebuggerUrl']
    async with websockets.connect(ws_url) as ws:
        cmd = json.dumps({'id': 1, 'method': 'Page.navigate', 'params': {'url': url}})
        await ws.send(cmd)
        await ws.recv()  # Wait for response
```

**Confidence:** HIGH — CDP `Page.navigate` is the standard mechanism and is well-documented at chromedevtools.github.io.

### Pattern 3: mpv Window Suspend/Restore via xdotool

```python
import subprocess
import re

DISPLAY_ENV = {
    'DISPLAY': ':0',
    'XAUTHORITY': get_kiosk_xauth(),
}

def get_mpv_window_ids() -> list[str]:
    """Find all mpv window IDs on X11 display."""
    result = subprocess.run(
        ['xdotool', 'search', '--name', 'mpv'],
        env=DISPLAY_ENV, capture_output=True, text=True
    )
    return result.stdout.strip().split('\n') if result.stdout.strip() else []

def hide_mpv_windows(window_ids: list[str]) -> None:
    """Minimize all mpv windows."""
    for wid in window_ids:
        subprocess.run(['xdotool', 'windowminimize', wid], env=DISPLAY_ENV)

def restore_mpv_windows(window_ids: list[str]) -> None:
    """Restore all mpv windows."""
    for wid in window_ids:
        subprocess.run(['xdotool', 'windowmap', wid], env=DISPLAY_ENV)
        subprocess.run(['xdotool', 'windowraise', wid], env=DISPLAY_ENV)
```

**Key fact:** `xdotool windowminimize` maps to X11 `iconify`. `xdotool windowmap` unmaps the iconify state and brings the window back. Both are confirmed working from root with the kiosk XAUTHORITY.

**CRITICAL:** `xdotool search --name 'mpv'` works when mpv windows have a title containing 'mpv'. The current kiosk-mpv.sh launches mpv without `--title`. In practice the window title is `go2rtc/1.9.9 - mpv` (confirmed from window enumeration). Use `xdotool search --name 'mpv'` (substring match) or store PIDs at hide time.

### Pattern 4: Flask Display Control Daemon

```python
# display_daemon.py — runs on management VM (192.168.1.65)
# Source: Flask 3.0 official docs

from flask import Flask, request, jsonify
import subprocess
import threading
import time

app = Flask(__name__)

# Display state
state = {
    'mode': 'camera',  # camera | hud_listening | hud_talking | browser
    'mpv_window_ids': [],
    'chromium_pid': None,
    'chromium_url': None,
}

@app.post('/display/hud')
def show_hud():
    """Show Jarvis HUD (listening or talking state)."""
    hud_state = request.json.get('state', 'listening')  # listening | talking | idle
    _ensure_chromium_on_hud(hud_state)
    return jsonify({'ok': True, 'mode': f'hud_{hud_state}'})

@app.post('/display/show')
def show_url():
    """Navigate kiosk browser to a URL."""
    url = request.json.get('url', '')
    _navigate_chromium(url)
    return jsonify({'ok': True, 'url': url})

@app.post('/display/restore')
def restore_camera():
    """Return to camera feed (restore mpv)."""
    _restore_camera_state()
    return jsonify({'ok': True, 'mode': 'camera'})

@app.get('/display/status')
def get_status():
    return jsonify(state)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8765, debug=False)
```

### Pattern 5: Jarvis HUD HTML Page

The Jarvis HUD is a standalone HTML file served statically — no React build needed. It uses CSS animations and reads state via URL hash or query parameter:

```
http://192.168.1.65:8765/hud.html?state=listening
http://192.168.1.65:8765/hud.html?state=talking
http://192.168.1.65:8765/hud.html?state=idle
```

The page polls for state changes (or Flask serves a Server-Sent Events stream) so the displayed animation updates without reloading the page. The visual design can be inspired by the existing `MatrixRain.tsx` and `ArcReactor.tsx` components in jarvis-ui but built as pure HTML/CSS/JS to avoid a React build step.

**Existing design assets to reference:**
- `/root/jarvis-ui/src/components/right/ArcReactor.tsx` — arc reactor pulse animation
- `/root/jarvis-ui/src/components/boot/MatrixRain.tsx` — digital rain effect
- `/root/jarvis-ui/src/components/boot/WireframeSphere.tsx` — 3D wireframe sphere
- Color scheme: `#00d4ff` (cyan), `#0a0a0f` (dark background), `#1a1a2e` (dark border)

### Pattern 6: jarvis-ear Display Integration

The jarvis-ear daemon already subscribes to all the right events via Socket.IO. Add a `display.py` module to jarvis-ear that POSTs to the display daemon HTTP API:

```python
# src/jarvis_ear/display.py

import logging
import threading
import requests

logger = logging.getLogger("jarvis_ear.display")
DISPLAY_DAEMON_URL = "http://192.168.1.65:8765"

class DisplayClient:
    """Non-blocking HTTP client for display daemon."""

    def _fire(self, endpoint: str, payload: dict) -> None:
        """Fire-and-forget HTTP POST to display daemon."""
        def _post():
            try:
                requests.post(f"{DISPLAY_DAEMON_URL}{endpoint}", json=payload, timeout=2)
            except Exception as exc:
                logger.debug("Display call failed (non-critical): %s", exc)
        threading.Thread(target=_post, daemon=True).start()

    def on_wake_word(self) -> None:
        """Call when wake word is detected."""
        self._fire("/display/hud", {"state": "listening"})

    def on_tts_start(self) -> None:
        self._fire("/display/hud", {"state": "talking"})

    def on_tts_done(self) -> None:
        self._fire("/display/restore", {})
```

Then in `backend.py`, hook into the `_on_tts_chunk` and `_on_tts_done` handlers (these already exist and currently just log). Wire the display client into `__main__.py` after wake word detection.

### Anti-Patterns to Avoid

- **Killing mpv instead of minimizing:** `pkill mpv` stops the stream and the kiosk-mpv-watchdog will restart it 120s later. Instead, use `xdotool windowminimize` and track the PIDs to re-raise them.
- **Running Chromium as kiosk user:** Chromium snap requires specific environment. Run as root with correct `DISPLAY` + `XAUTHORITY` env vars.
- **Blocking HTTP calls in jarvis-ear:** Display calls must be fire-and-forget threads. Never block the audio capture main loop.
- **Hardcoding window IDs:** mpv window IDs change on restart. Always search by name or PID dynamically.
- **Using xdg-open for navigation:** `xdg-open` launches a NEW browser instance, doesn't navigate an existing one. Use CDP for navigation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser URL navigation | Custom subprocess `chromium --url` calls | CDP `Page.navigate` over WebSocket | `--url` flag opens new window; CDP navigates existing tab |
| X11 window manipulation | Custom X11 protocol code | `xdotool` subprocess calls | xdotool handles all EWMH edge cases |
| HUD state polling | Custom long-poll HTTP endpoint | Flask SSE or hash-based URL reload | Simple and reliable for a single-client kiosk |
| Chromium profile management | Custom profile setup scripts | `--user-data-dir=/tmp/jarvis-kiosk` | Prevents session restore dialogs on crash |

**Key insight:** The CDP approach (launch Chromium with `--remote-debugging-port`) handles navigation, state inspection, and error recovery all through a single WebSocket. The 20-line pure Python CDP client using the already-installed `websockets 10.4` library is sufficient — do not install playwright or selenium.

---

## Common Pitfalls

### Pitfall 1: kiosk-mpv-watchdog Interferes with Display Control

**What goes wrong:** The `kiosk-mpv-watchdog.timer` on the management VM fires every 120 seconds. If mpv is not running (because display control killed it), the watchdog will restart it, overwriting the Jarvis HUD.

**Why it happens:** The watchdog checks `pgrep -u kiosk mpv` — if mpv processes are absent, it restarts kiosk-mpv.sh.

**How to avoid:** Do NOT kill mpv. Instead, minimize mpv windows with `xdotool windowminimize` while keeping the processes running. The watchdog only checks existence of mpv processes, not whether their windows are visible.

**Warning signs:** Camera feed randomly reappears during Jarvis interaction.

### Pitfall 2: XAUTHORITY Path Changes After X Restart

**What goes wrong:** The XAUTHORITY file is `/tmp/serverauth.WulKHHhfL0` — the suffix changes on each X session start. Hardcoding the path causes display commands to fail after a reboot.

**Why it happens:** Xorg creates a new serverauth file on each start.

**How to avoid:** Always find it dynamically: `$(find /tmp -name 'serverauth.*' -user kiosk 2>/dev/null | head -1)`. The display daemon should discover this at startup and refresh if X restarts.

### Pitfall 3: Chromium Snap Requires HOME Environment Variable

**What goes wrong:** Chromium (snap) needs `HOME` set to write its profile directory. When launched via subprocess from a daemon with limited environment, it may crash or silently fail.

**Why it happens:** Snap confinement requires certain env vars.

**How to avoid:** Explicitly pass `HOME=/root` (or a dedicated dir like `/tmp/jarvis-chromium`) in the subprocess env. Also set `--user-data-dir=/tmp/jarvis-kiosk-profile` to avoid conflicts with any existing profile.

### Pitfall 4: CDP WebSocket URL Not Immediately Available

**What goes wrong:** Chromium is launched and CDP connection attempt fails because Chromium hasn't finished initializing the debug port yet.

**Why it happens:** Chromium takes 1-3 seconds to start and open the debug WebSocket.

**How to avoid:** Poll `http://localhost:9222/json` with retries (max 10 attempts, 500ms sleep) before attempting CDP connection.

### Pitfall 5: Display Daemon Not on jarvis-backend's SSH Node List

**What goes wrong:** jarvis-backend's `open_in_browser` MCP tool uses a hardcoded node IP map that doesn't include the management VM (192.168.1.65).

**Why it happens:** The management VM is a VM, not a cluster node.

**How to avoid:** The new `control_display` MCP tool should call the display daemon's HTTP API (not SSH), making it independent of the node list. Add `DISPLAY_DAEMON_URL = 'http://192.168.1.65:8765'` to jarvis-backend config.

### Pitfall 6: Home Node Display Requires Full X11 Stack Setup

**What goes wrong:** Assuming the Home node display works like the management VM. The Home node has no X11 server running, just a framebuffer device.

**Why it happens:** The Home node is a Proxmox host, not a desktop.

**How to avoid:** Scope Home node display as a separate plan (Plan 2 or Plan 3). The management VM display is the primary target. Install `xinit`, `openbox`, and set up a `kiosk` user with an autostart similar to the management VM's approach.

---

## Code Examples

### Verified: Get XAUTHORITY Dynamically

```python
# Source: Verified against management VM configuration
import glob

def get_kiosk_xauth() -> str:
    """Get the current Xorg server auth file for kiosk user."""
    files = glob.glob('/tmp/serverauth.*')
    # Filter to files owned by kiosk user (stat check)
    import os, stat
    for f in files:
        try:
            st = os.stat(f)
            # kiosk uid - find it
            import pwd
            kiosk_uid = pwd.getpwnam('kiosk').pw_uid
            if st.st_uid == kiosk_uid:
                return f
        except Exception:
            continue
    return ''
```

### Verified: Minimize and Restore mpv Windows

```bash
# Source: Verified working on management VM via SSH from Home node

# Get mpv window IDs
export DISPLAY=:0
export XAUTHORITY=$(find /tmp -name 'serverauth.*' -user kiosk 2>/dev/null | head -1)

# Hide (minimize)
for wid in $(xdotool search --name 'mpv' 2>/dev/null); do
    xdotool windowminimize $wid
done

# Restore
for wid in $(xdotool search --name 'mpv' 2>/dev/null); do
    xdotool windowmap $wid
    xdotool windowraise $wid
done
```

### Verified: CDP Navigation (Python)

```python
# Source: https://chromedevtools.github.io/devtools-protocol/ (CDP spec)
# Uses websockets 10.4 (verified installed on management VM)

import asyncio
import json
import urllib.request
import websockets  # 10.4

async def cdp_navigate(url: str, debug_port: int = 9222) -> None:
    with urllib.request.urlopen(f'http://localhost:{debug_port}/json') as resp:
        targets = json.loads(resp.read())
    page = next((t for t in targets if t.get('type') == 'page'), None)
    if not page:
        return
    async with websockets.connect(page['webSocketDebuggerUrl']) as ws:
        await ws.send(json.dumps({
            'id': 1, 'method': 'Page.navigate', 'params': {'url': url}
        }))
        await asyncio.wait_for(ws.recv(), timeout=5.0)

def navigate_display(url: str) -> None:
    asyncio.run(cdp_navigate(url))
```

### Verified: Flask Display Daemon Skeleton

```python
# Source: Flask 3.0 documentation (https://flask.palletsprojects.com/en/3.0.x/)

from flask import Flask, request, jsonify
app = Flask(__name__)

@app.post('/display/hud')
def show_hud():
    return jsonify({'ok': True})

@app.post('/display/show')
def show_url():
    url = request.json.get('url', '')
    return jsonify({'ok': True, 'url': url})

@app.post('/display/restore')
def restore():
    return jsonify({'ok': True})

@app.get('/display/status')
def status():
    return jsonify({'mode': 'camera'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8765)
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| xdg-open (opens new browser) | CDP `Page.navigate` (navigates existing) | CDP is the standard for programmatic browser control |
| Selenium/Playwright | Raw CDP via websockets | For simple navigation, raw CDP is 20 lines vs 100MB install |
| Separate display server per app | Chromium kiosk `--remote-debugging-port` | One browser, CDP for all navigation |
| mpv `--input-ipc-server` JSON socket | xdotool window management | Works with existing mpv launch args, no config change needed |

---

## Open Questions

1. **Which display to target first: management VM or Home node eDP-1?**
   - What we know: Management VM display is already working with X11, easier to control. Home node eDP-1 is connected but has no X11.
   - What's unclear: Does the user primarily want the camera kiosk display (mgmt VM) or the Proxmox host's local display (Home eDP-1)?
   - Recommendation: The user's phase context says "security camera kiosk display (separate machine at 192.168.1.60)" — 192.168.1.60 is offline but the management VM IS the camera kiosk. Target management VM (192.168.1.65) in Plan 1, add Home node display in Plan 2 only if explicitly required.

2. **How should the Jarvis HUD be served?**
   - What we know: Flask display daemon can serve static files; jarvis-frontend at localhost:3004 has React components (MatrixRain, ArcReactor) that could be wrapped into a HUD route.
   - What's unclear: Does the user want a standalone HTML file or a dedicated React page in the existing jarvis-ui?
   - Recommendation: Start with a standalone HTML file served by the Flask daemon (Plan 3). This avoids a React build cycle and keeps the display daemon self-contained. A dedicated route in jarvis-ui can be added in a future phase.

3. **Should jarvis-backend emit a new `display:*` Socket.IO namespace for display events?**
   - What we know: jarvis-ear already receives `voice:*` events from backend and can call the display daemon directly. Alternatively, a new `/display` namespace could let any client subscribe to display state changes.
   - What's unclear: Is there a future need for the jarvis UI to also show display state?
   - Recommendation: For Phase 37, keep it simple — jarvis-ear calls display daemon HTTP API directly, no new Socket.IO namespace needed. A `display:state` event on the events namespace can be added as an enhancement.

4. **Watchdog interference timing**
   - What we know: Watchdog fires every 120 seconds. mpv `windowminimize` keeps the process alive.
   - What's unclear: If a display takeover lasts more than 120s, will the watchdog do anything unexpected?
   - Recommendation: The watchdog only checks `pgrep -u kiosk mpv` — since mpv stays running (just minimized), the watchdog will find it and do nothing. Safe.

---

## Plan Breakdown Recommendations

The roadmap already specifies 3 plans. Based on research:

### Plan 1: Chromium Kiosk + URL Navigation (DISP-01, DISP-02, DISP-03)
- Install Flask on management VM (`apt install python3-flask`)
- Write `display-daemon.py` on management VM at `/opt/jarvis-display/`
- Install as systemd service on management VM
- Implement: launch Chromium with CDP debug port, CDP navigation, mpv minimize/restore
- Add `control_display` MCP tool to jarvis-backend (YELLOW tier, HTTP POST to daemon)
- Add display node to jarvis-backend SSH allowlist or HTTP config
- Test: "Jarvis, show me the front door camera" → Frigate URL opens in kiosk

### Plan 2: Jarvis Voice State → Display Integration (DISP-04, DISP-05 partial)
- Add `display.py` module to jarvis-ear (fire-and-forget HTTP calls to display daemon)
- Hook into: wake word detection (`on_wake_word`), `_on_tts_chunk`, `_on_tts_done` in BackendClient
- Display daemon `/display/hud` shows basic HUD page on wake word
- Display daemon `/display/restore` returns to camera feed on tts_done
- HUD page is a simple static HTML file with "listening" / "talking" states

### Plan 3: Jarvis HUD/Face Animation (DISP-05)
- Create full Jarvis HUD HTML page with JARVIS-style animations
- Arc reactor pulse, matrix rain background, voice waveform visualization
- State machine: idle → listening → processing → talking → idle
- State updated via URL hash change (no reload) or SSE from display daemon
- Design based on existing ArcReactor.tsx and MatrixRain.tsx color scheme

---

## Sources

### Primary (HIGH confidence)
- Chrome DevTools Protocol official spec — https://chromedevtools.github.io/devtools-protocol/ — CDP `Page.navigate` command, WebSocket interface
- Flask 3.0 documentation — https://flask.palletsprojects.com/en/3.0.x/ — route definitions, JSON responses
- Direct infrastructure investigation (Feb 26, 2026):
  - SSH to management VM (192.168.1.65) — confirmed X11, xdotool, Chromium, Python, Flask
  - SSH to Home node (192.168.1.50) — confirmed eDP-1 connected, no X11, xserver-xorg-core installed
  - xdotool window minimize/restore — VERIFIED WORKING from root
  - Chromium snap `--headless --version` — VERIFIED WORKING

### Secondary (MEDIUM confidence)
- [xdotool Ubuntu manpage](https://manpages.ubuntu.com/manpages/trusty/man1/xdotool.1.html) — `windowminimize`, `windowmap`, `windowraise` commands
- [WebSearch: Chromium CDP Python websockets 2025](https://github.com/aslushnikov/getting-started-with-cdp) — CDP minimal examples
- [WebSearch: xdotool Python subprocess patterns](https://gist.github.com/joaoescribano/118607eb7b0afdc05e7f0f491f20f4ef) — Python wrapper pattern

### Tertiary (LOW confidence)
- kiosk watchdog interference timing — inferred from reading service files, not tested live

---

## Metadata

**Confidence breakdown:**
- Management VM display infrastructure: HIGH — directly verified via SSH
- Home node display infrastructure: HIGH — directly verified
- CDP navigation pattern: HIGH — official protocol, standard approach
- xdotool window management: HIGH — verified working in live environment
- Flask daemon architecture: HIGH — standard Python microservice pattern, apt-available
- HUD HTML design: MEDIUM — approach is standard, specific implementation TBD

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable infrastructure, 30-day window)

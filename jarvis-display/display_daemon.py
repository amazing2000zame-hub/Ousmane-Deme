#!/usr/bin/env python3
"""Jarvis Display Control Daemon.

Manages the physical DP-3 display on the management VM (192.168.1.65).
Controls mpv camera feed windows and Chromium kiosk browser via:
  - xdotool for X11 window manipulation (minimize/restore mpv)
  - Chrome DevTools Protocol (CDP) via websockets for Chromium navigation
  - Flask HTTP API for external control

State machine: camera <-> hud/browser
  camera: mpv windows visible, Chromium hidden/closed
  hud:    mpv minimized, Chromium showing HUD page
  browser: mpv minimized, Chromium showing arbitrary URL
"""

import asyncio
import glob
import json
import logging
import os
import pwd
import subprocess
import time
from datetime import datetime, timezone

from flask import Flask, request, jsonify

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("jarvis-display")

app = Flask(__name__, static_folder="/opt/jarvis-display/static", static_url_path="/static")

CHROMIUM_DEBUG_PORT = 9222
HUD_URL_TEMPLATE = "http://localhost:8765/static/hud.html?state={state}"

state = {
    "mode": "camera",
    "hud_state": None,
    "mpv_window_ids": [],
    "chromium_url": None,
    "last_changed": datetime.now(timezone.utc).isoformat(),
}

_chromium_proc = None
_cached_xauth = None


def get_kiosk_xauth():
    global _cached_xauth
    if _cached_xauth and os.path.exists(_cached_xauth):
        return _cached_xauth
    try:
        kiosk_uid = pwd.getpwnam("kiosk").pw_uid
    except KeyError:
        logger.error("kiosk user not found in passwd")
        return ""
    for f in glob.glob("/tmp/serverauth.*"):
        try:
            st = os.stat(f)
            if st.st_uid == kiosk_uid:
                _cached_xauth = f
                logger.info("Discovered XAUTHORITY: %s", f)
                return f
        except OSError:
            continue
    logger.warning("No XAUTHORITY file found for kiosk user")
    return ""


def get_display_env():
    xauth = get_kiosk_xauth()
    return {
        "DISPLAY": ":0",
        "XAUTHORITY": xauth,
        "PATH": os.environ.get("PATH", "/usr/bin:/usr/local/bin:/snap/bin"),
    }



def enable_xhost_local():
    """Run xhost +local: to allow any local user to connect to X11.
    Required because Chromium snap refuses Xauthority files not owned by current user.
    """
    env = get_display_env()
    try:
        result = subprocess.run(
            ["xhost", "+local:"],
            env=env, capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            logger.info("xhost +local: enabled for X11 access")
        else:
            logger.warning("xhost +local: failed: %s", result.stderr)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        logger.error("Failed to run xhost: %s", exc)


def get_mpv_window_ids():
    env = get_display_env()
    try:
        result = subprocess.run(
            ["xdotool", "search", "--name", "mpv"],
            env=env, capture_output=True, text=True, timeout=5,
        )
        if result.stdout.strip():
            return result.stdout.strip().split("\n")
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        logger.error("Failed to get mpv window IDs: %s", exc)
    return []


def hide_mpv_windows():
    env = get_display_env()
    wids = get_mpv_window_ids()
    for wid in wids:
        try:
            subprocess.run(
                ["xdotool", "windowminimize", wid],
                env=env, capture_output=True, timeout=5,
            )
            logger.info("Minimized mpv window %s", wid)
        except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
            logger.error("Failed to minimize window %s: %s", wid, exc)
    return wids


def restore_mpv_windows(window_ids):
    env = get_display_env()
    for wid in window_ids:
        try:
            subprocess.run(
                ["xdotool", "windowmap", wid],
                env=env, capture_output=True, timeout=5,
            )
            subprocess.run(
                ["xdotool", "windowraise", wid],
                env=env, capture_output=True, timeout=5,
            )
            logger.info("Restored mpv window %s", wid)
        except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
            logger.error("Failed to restore window %s: %s", wid, exc)


def launch_chromium(url):
    global _chromium_proc
    if is_chromium_running():
        logger.info("Chromium already running, navigating instead")
        navigate_sync(url)
        return
    env = {
        "DISPLAY": ":0",
        "HOME": "/root",
        "PATH": os.environ.get("PATH", "/usr/bin:/usr/local/bin:/snap/bin"),
    }
    cmd = [
        "/snap/bin/chromium", "--kiosk",
        "--remote-debugging-port=%d" % CHROMIUM_DEBUG_PORT,
        "--no-sandbox", "--disable-dev-shm-usage",
        "--noerrdialogs", "--disable-infobars",
        "--disable-session-crashed-bubble",
        "--user-data-dir=/tmp/jarvis-kiosk-profile", url,
    ]
    logger.info("Launching Chromium: %s", " ".join(cmd))
    _chromium_proc = subprocess.Popen(
        cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    logger.info("Chromium launched with PID %d", _chromium_proc.pid)


def close_chromium():
    global _chromium_proc
    if _chromium_proc is None:
        return
    try:
        _chromium_proc.terminate()
        try:
            _chromium_proc.wait(timeout=5)
            logger.info("Chromium terminated gracefully")
        except subprocess.TimeoutExpired:
            _chromium_proc.kill()
            _chromium_proc.wait(timeout=3)
            logger.warning("Chromium killed forcefully")
    except OSError as exc:
        logger.error("Error closing Chromium: %s", exc)
    finally:
        _chromium_proc = None


def is_chromium_running():
    if _chromium_proc is None:
        return False
    return _chromium_proc.poll() is None


async def navigate_to(url):
    import urllib.request
    import websockets as ws
    targets = None
    for attempt in range(10):
        try:
            with urllib.request.urlopen(
                "http://localhost:%d/json" % CHROMIUM_DEBUG_PORT, timeout=2
            ) as resp:
                targets = json.loads(resp.read())
            break
        except Exception:
            if attempt < 9:
                await asyncio.sleep(0.5)
            else:
                logger.error("CDP not available after 10 attempts")
                return False
    if targets is None:
        return False
    page = next((t for t in targets if t.get("type") == "page"), None)
    if not page:
        logger.error("No page target found in CDP")
        return False
    ws_url = page["webSocketDebuggerUrl"]
    try:
        async with ws.connect(ws_url) as conn:
            cmd = json.dumps({
                "id": 1, "method": "Page.navigate",
                "params": {"url": url},
            })
            await conn.send(cmd)
            response = await asyncio.wait_for(conn.recv(), timeout=5.0)
            logger.info("CDP navigate response: %s", response)
            return True
    except Exception as exc:
        logger.error("CDP navigation failed: %s", exc)
        return False


def navigate_sync(url):
    try:
        return asyncio.run(navigate_to(url))
    except Exception as exc:
        logger.error("navigate_sync error: %s", exc)
        return False


def _update_state(mode, hud_state=None, chromium_url=None):
    state["mode"] = mode
    state["hud_state"] = hud_state
    state["chromium_url"] = chromium_url
    state["last_changed"] = datetime.now(timezone.utc).isoformat()


def transition_to_hud(hud_state="listening"):
    hud_url = HUD_URL_TEMPLATE.format(state=hud_state)
    if state["mode"] == "camera":
        wids = hide_mpv_windows()
        state["mpv_window_ids"] = wids
        launch_chromium(hud_url)
        time.sleep(1.5)
        if is_chromium_running():
            navigate_sync(hud_url)
    elif state["mode"] == "hud":
        navigate_sync(hud_url)
    elif state["mode"] == "browser":
        navigate_sync(hud_url)
    _update_state("hud", hud_state=hud_state, chromium_url=hud_url)
    return {"ok": True, "mode": "hud_%s" % hud_state}


def transition_to_browser(url):
    if state["mode"] == "camera":
        wids = hide_mpv_windows()
        state["mpv_window_ids"] = wids
        launch_chromium(url)
        time.sleep(1.5)
        if is_chromium_running():
            navigate_sync(url)
    elif state["mode"] in ("hud", "browser"):
        navigate_sync(url)
    _update_state("browser", chromium_url=url)
    return {"ok": True, "url": url}


def transition_to_camera():
    if state["mode"] == "camera":
        return {"ok": True, "mode": "camera", "note": "already in camera mode"}
    close_chromium()
    wids = state.get("mpv_window_ids", [])
    if not wids:
        wids = get_mpv_window_ids()
    restore_mpv_windows(wids)
    _update_state("camera")
    state["mpv_window_ids"] = []
    return {"ok": True, "mode": "camera"}


@app.post("/display/hud")
def route_hud():
    data = request.get_json(silent=True) or {}
    hud_state = data.get("state", "listening")
    if hud_state not in ("listening", "talking", "idle"):
        hud_state = "listening"
    result = transition_to_hud(hud_state)
    logger.info("POST /display/hud state=%s -> %s", hud_state, result)
    return jsonify(result)


@app.post("/display/show")
def route_show():
    data = request.get_json(silent=True) or {}
    url = data.get("url", "")
    if not url:
        return jsonify({"ok": False, "error": "url required"}), 400
    result = transition_to_browser(url)
    logger.info("POST /display/show url=%s -> %s", url, result)
    return jsonify(result)


@app.post("/display/restore")
def route_restore():
    result = transition_to_camera()
    logger.info("POST /display/restore -> %s", result)
    return jsonify(result)


@app.get("/display/status")
def route_status():
    return jsonify(state)


def startup_checks():
    xauth = get_kiosk_xauth()
    if xauth:
        logger.info("Startup: XAUTHORITY discovered at %s", xauth)
    else:
        logger.warning("Startup: No XAUTHORITY found - X11 commands will fail")
    enable_xhost_local()
    wids = get_mpv_window_ids()
    logger.info("Startup: Found %d mpv window(s): %s", len(wids), wids)


if __name__ == "__main__":
    startup_checks()
    logger.info("Starting Jarvis Display Daemon on 0.0.0.0:8765")
    app.run(host="0.0.0.0", port=8765, debug=False)

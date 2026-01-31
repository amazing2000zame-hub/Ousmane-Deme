---
status: partial
phase: adhoc-camera-streaming
source: Ad-hoc camera feature implementation
started: 2026-01-29T11:15:00Z
updated: 2026-01-29T12:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cam Tab Shows Live Video
expected: Open the Cam tab - you should see live video streams from cameras with "LIVE" badges, not static snapshots refreshing every 10 seconds
result: issue
reported: "still showing connecting"
severity: major

### 2. Cam Tab Full-Screen Modal
expected: Click on any camera in the grid - a full-screen modal should open showing the live stream with camera name and close button
result: issue
reported: "same issue - still showing connecting"
severity: major

### 3. Inline Camera in Chat
expected: In chat, ask "show me the front door camera" - JARVIS should respond AND display a live video feed inline in the chat message (not just opening a modal)
result: issue
reported: "same issue - still showing connecting"
severity: major

### 4. Chat Camera Shows Live Video
expected: The inline camera in chat should show actual live video with "LIVE" badge and "CONNECTING" indicator while loading
result: issue
reported: "the cameras arent loading at all any more"
severity: blocker

## Summary

total: 4
passed: 0
issues: 4
pending: 0
skipped: 0

## Gaps

- truth: "Cam tab shows live video streams with LIVE badges"
  status: fixed
  reason: "User reported: still showing connecting"
  severity: major
  test: 1
  root_cause: "video-rtc.js requires property assignment (el.src = url) not setAttribute() to trigger WebSocket connection"
  artifacts:
    - path: "/root/jarvis-ui/src/components/camera/LiveCameraCard.tsx"
      issue: "Used setAttribute instead of property assignment"
  missing:
    - "Changed to el.src = url property assignment"
  debug_session: "/root/.planning/debug/video-rtc-websocket-not-connecting.md"

- truth: "Full-screen modal shows live video stream"
  status: fixed
  reason: "User reported: same issue - still showing connecting"
  severity: major
  test: 2
  root_cause: "Same root cause - setAttribute vs property assignment"
  artifacts:
    - path: "/root/jarvis-ui/src/components/camera/LiveStreamModal.tsx"
      issue: "Used setAttribute instead of property assignment"
  missing:
    - "Changed to el.src = url property assignment"
  debug_session: "/root/.planning/debug/video-rtc-websocket-not-connecting.md"

- truth: "Inline camera appears in chat when asking to show camera"
  status: fixed
  reason: "User reported: same issue - still showing connecting"
  severity: major
  test: 3
  root_cause: "Same root cause - setAttribute vs property assignment"
  artifacts:
    - path: "/root/jarvis-ui/src/components/center/InlineCameraCard.tsx"
      issue: "Used setAttribute instead of property assignment"
  missing:
    - "Changed to el.src = url property assignment"
  debug_session: "/root/.planning/debug/video-rtc-websocket-not-connecting.md"

- truth: "Chat camera shows actual live video"
  status: fixed
  reason: "User reported: the cameras arent loading at all any more"
  severity: blocker
  test: 4
  root_cause: "Same root cause - setAttribute vs property assignment"
  artifacts: []
  missing: []
  debug_session: "/root/.planning/debug/video-rtc-websocket-not-connecting.md"

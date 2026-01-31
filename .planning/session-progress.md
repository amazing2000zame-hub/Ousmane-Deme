# Session Progress - Alpha

**Keyword:** `alpha`
**Date:** 2026-01-29
**Status:** Voice-controlled live feed feature implemented, pending browser cache clear for testing

---

## What Was Built

### Feature: Voice-Controlled Live Camera Feed

User can now say "Show me the front door camera" and JARVIS will automatically open the live stream modal.

**Flow:**
```
User: "Show me the front door camera"
  → Router routes to Claude (camera keywords)
  → Claude calls show_live_feed tool
  → Backend validates camera, emits socket event
  → Frontend receives event, opens LiveStreamModal
```

---

## Files Changed

### Backend (jarvis-backend)
| File | Change |
|------|--------|
| `src/mcp/tools/smarthome.ts` | Added `show_live_feed` tool (#13) |
| `src/safety/tiers.ts` | Registered tool in GREEN tier |
| `src/ai/tools.ts` | Added Claude tool definition |

### Frontend (jarvis-ui)
| File | Change |
|------|--------|
| `src/hooks/useEventsSocket.ts` | Added `show_live_feed` socket event handler |
| `src/components/camera/EventList.tsx` | Fixed 401 error - added auth token to fetch |
| `index.html` | Fixed video-rtc.js to load as ES module |

---

## Commits Made

```
c49bdce feat(28): add show_live_feed tool for voice-controlled camera streams
03c344d fix(28): load video-rtc.js as ES module
8a7c641 fix(28): add auth token to EventList fetch requests
```

---

## Current Status

1. **Backend:** Deployed and working - tool registered, socket events emitting
2. **Frontend:** Deployed with fixes - new JS bundle hash `index-DWXtxEfq.js`
3. **Browser:** May still have old cached JS (`index-fABnfsVd.js`)

---

## To Resume (Keyword: alpha)

### Step 1: Test the Feature
1. Hard refresh browser: **Ctrl+Shift+R** (or Cmd+Shift+R on Mac)
2. Or: DevTools (F12) → Right-click refresh → "Empty Cache and Hard Reload"
3. Say: **"Show me the front door camera"**
4. Expected: Live stream modal opens automatically

### Step 2: If 401 Errors Persist
The `/api/events` 401 errors should be fixed. If they persist after hard refresh:
- Check browser network tab for which JS file is loaded
- Should be `index-DWXtxEfq.js` (not `fABnfsVd`)

### Step 3: Next Steps After Verification
- Phase 29: Proactive Intelligence is next (unknown person alerts, TTS announcements)
- Run `/gsd:plan-phase 29` when ready

---

## Quick Commands

```bash
# Check backend logs
docker logs jarvis-backend 2>&1 | tail -20

# Rebuild and deploy
cd /root && docker compose up -d --build jarvis-backend jarvis-frontend

# Force rebuild without cache
docker compose build --no-cache jarvis-frontend && docker compose up -d jarvis-frontend

# Check what's in container
docker exec jarvis-frontend ls -la /usr/share/nginx/html/assets/
```

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                         JARVIS UI                           │
│  ┌─────────────┐    ┌──────────────────┐                   │
│  │ Chat Input  │───>│ useChatSocket    │                   │
│  └─────────────┘    └──────────────────┘                   │
│                              │                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ useEventsSocket                                      │   │
│  │   socket.on('show_live_feed') → openLiveModal()     │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ LiveStreamModal (video-rtc.js → Frigate go2rtc)     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
                    Socket.IO /events
                               │
┌─────────────────────────────────────────────────────────────┐
│                      JARVIS Backend                         │
│  ┌─────────────┐    ┌──────────────────┐                   │
│  │ Claude API  │───>│ show_live_feed   │                   │
│  │ Tool Call   │    │ MCP Tool         │                   │
│  └─────────────┘    └──────────────────┘                   │
│                              │                              │
│                     eventsNs.emit('show_live_feed')        │
└─────────────────────────────────────────────────────────────┘
```

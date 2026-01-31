# Phase 32: Web Browsing & Video Playback - Summary

**Status:** Complete
**Date:** 2026-01-30

## Overview

Added comprehensive web browsing and video playback capabilities to JARVIS with 7 new MCP tools, 3 frontend components, and SearXNG for privacy-focused search.

## Deliverables

### Backend (7 New MCP Tools)

| Tool | Tier | Description |
|------|------|-------------|
| `web_search` | GREEN | Search the web via SearXNG |
| `fetch_webpage` | GREEN | Fetch and summarize webpage content |
| `open_url` | GREEN | Display webpage in sandboxed iframe |
| `search_youtube` | GREEN | Search for YouTube videos |
| `play_youtube` | GREEN | Embed YouTube player |
| `play_video` | GREEN | Play direct video URLs (mp4/webm) |
| `open_in_browser` | YELLOW | Launch URL in system browser on cluster node |

### Frontend (3 New Components)

| Component | Purpose |
|-----------|---------|
| `SearchResultsCard` | Display clickable search results inline |
| `InlineWebCard` | Sandboxed iframe for webpage display |
| `InlineVideoCard` | YouTube embed and HTML5 video player |

### Docker

- Added `jarvis-searxng` service (SearXNG for privacy-focused web search)
- Memory limit: 512MB
- Volume: `searxng-data` for persistent configuration

## Files Modified

### Backend
- `docker-compose.yml` - Added SearXNG service
- `jarvis-backend/src/config.ts` - Added `searxngUrl` config
- `jarvis-backend/src/mcp/tools/web.ts` - **NEW** - All 7 web tools
- `jarvis-backend/src/mcp/server.ts` - Registered web tools
- `jarvis-backend/src/safety/tiers.ts` - Added tool tiers
- `jarvis-backend/src/ai/tools.ts` - Added Claude tool definitions
- `jarvis-backend/src/ai/router.ts` - Added web/video keywords
- `jarvis-backend/src/ai/system-prompt.ts` - Added web capabilities section

### Frontend
- `jarvis-ui/src/stores/chat.ts` - Added SearchResults, InlineWebpage, InlineVideo states
- `jarvis-ui/src/hooks/useChatSocket.ts` - Added socket handlers for new events
- `jarvis-ui/src/components/center/ChatMessage.tsx` - Render new cards
- `jarvis-ui/src/components/center/ChatPanel.tsx` - Escape key to close inline content
- `jarvis-ui/src/components/center/SearchResultsCard.tsx` - **NEW**
- `jarvis-ui/src/components/center/InlineWebCard.tsx` - **NEW**
- `jarvis-ui/src/components/center/InlineVideoCard.tsx` - **NEW**

## Socket.IO Events Added

| Event | Direction | Purpose |
|-------|-----------|---------|
| `chat:show_search_results` | Server → Client | Display search results |
| `chat:show_webpage` | Server → Client | Display iframe |
| `chat:close_webpage` | Server → Client | Close iframe |
| `chat:show_video` | Server → Client | Display video player |
| `chat:close_video` | Server → Client | Close video player |

## Security Measures

1. **SSRF Protection**: Private IPs blocked (10.x, 192.168.x, 172.16-31.x, localhost)
2. **Iframe Sandboxing**: `sandbox="allow-scripts allow-same-origin"`
3. **HTTPS Required**: For iframe embeds
4. **YouTube Safety**: Uses `youtube-nocookie.com` domain
5. **Video ID Validation**: Regex validation for 11-char YouTube video IDs

## Router Keywords Added

Action keywords: `search`, `google`, `look up`, `browse`, `youtube`, `play`, `watch`, `video`

Entity patterns:
- `/\b(website|webpage|url|https?:\/\/|\.com|\.org|\.net)\b/i`
- `/\b(youtube|video|videos|mp4|webm)\b/i`
- `/\b(search|google|bing|duckduckgo|look\s*up)\b/i`

## User Experience

1. **Web Search**: "search for weather in NYC" → Results appear inline with clickable links
2. **Webpage Display**: "show me reddit.com" → Iframe with website, close button, open external
3. **YouTube Search**: "search for cat videos on YouTube" → Video results with thumbnails
4. **YouTube Playback**: "play dQw4w9WgXcQ" → Embedded YouTube player with autoplay
5. **Direct Video**: "play https://example.com/video.mp4" → HTML5 video player
6. **Escape Key**: Press Escape to close any open inline content

## Verification

```bash
# Deploy
cd /root && docker compose up -d --build

# Wait for containers
sleep 45 && docker compose ps

# Test SearXNG
docker compose exec jarvis-backend curl -s "http://jarvis-searxng:8080/search?q=test&format=json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Results: {len(d.get(\"results\", []))}')"

# Test via UI
# Open http://192.168.1.50:3004
# Try: "search for weather in New York"
# Try: "play dQw4w9WgXcQ on YouTube"
```

## Known Limitations

1. Some websites block iframe embedding (X-Frame-Options)
2. open_in_browser requires a display on the target node
3. SearXNG needs time to start up on first deployment

## Statistics

- 7 new MCP tools
- 3 new UI components
- ~800 lines of new TypeScript
- 1 new Docker service
- 5 new Socket.IO events

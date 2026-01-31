# Phase 32: Web Browsing & Video Playback - Research

## Overview

Add comprehensive web browsing and video playback capabilities to Jarvis with 7 new MCP tools, 3 frontend components, and SearXNG for privacy-focused search.

## Architecture

```
User: "search for X" / "play YouTube Y" / "show me this website"
       ↓
   Router (add web/video keywords)
       ↓
   Claude (tool selection)
       ↓
   MCP Tools (new: web.ts)
       ├── web_search (SearXNG)
       ├── fetch_webpage (GET + summarize)
       ├── open_url (iframe in UI)
       ├── search_youtube (SearXNG/API)
       ├── play_youtube (embed player)
       ├── play_video (mp4/webm/local)
       └── open_in_browser (system browser)
       ↓
   Socket.IO Events
       ├── chat:show_webpage
       ├── chat:show_video
       └── chat:show_search_results
       ↓
   Frontend Components
       ├── InlineWebCard (sandboxed iframe)
       ├── InlineVideoCard (YouTube/HTML5)
       └── SearchResultsCard (clickable list)
```

## Technical Decisions

### SearXNG vs Alternatives

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| SearXNG | Privacy-focused, self-hosted, no API key needed, aggregates multiple engines | Requires Docker container | **SELECTED** |
| Google Custom Search API | Official, reliable | Requires API key, limited free tier (100/day) | Rejected |
| DuckDuckGo Instant API | No API key | Limited results, no deep search | Rejected |
| Brave Search API | Good privacy, fast | Requires API key | Rejected |

### YouTube Integration

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| SearXNG YouTube engine | Single search backend, no extra API | Less metadata | **SELECTED** for search |
| YouTube Data API v3 | Full metadata, official | Requires API key, quota limits | Fallback if needed |
| youtube-nocookie.com embed | Privacy-enhanced, no cookies | Slightly slower | **SELECTED** for playback |

### Iframe Security

| Feature | Implementation |
|---------|---------------|
| Sandbox | `sandbox="allow-scripts allow-same-origin"` - no forms, popups, top navigation |
| URL Validation | HTTPS required for embeds, SSRF protection |
| CSP | Add `frame-src` directive for allowed domains |
| Private IPs | Block 10.x, 192.168.x, 172.16-31.x, localhost |

### Video Player

| Feature | Implementation |
|---------|---------------|
| YouTube | youtube-nocookie.com iframe embed with postMessage API |
| Direct URLs | HTML5 `<video>` element with controls |
| Local files | Stream through backend with range request support |
| Formats | mp4, webm (browser-native) |

## New Files

| File | Purpose | Lines (est) |
|------|---------|-------------|
| `jarvis-backend/src/mcp/tools/web.ts` | 7 MCP tools | ~400 |
| `jarvis-ui/src/components/center/InlineWebCard.tsx` | Iframe webpage embed | ~80 |
| `jarvis-ui/src/components/center/InlineVideoCard.tsx` | Video player | ~150 |
| `jarvis-ui/src/components/center/SearchResultsCard.tsx` | Search results | ~100 |

## Modified Files

| File | Changes |
|------|---------|
| `docker-compose.yml` | Add jarvis-searxng service |
| `jarvis-backend/src/mcp/server.ts` | Register web tools |
| `jarvis-backend/src/safety/tiers.ts` | Add tool tiers |
| `jarvis-backend/src/ai/tools.ts` | Add Claude tool definitions |
| `jarvis-backend/src/ai/router.ts` | Add web/video keywords |
| `jarvis-backend/src/safety/urls.ts` | Add validateUrlForEmbed() |
| `jarvis-backend/src/config.ts` | Add SEARXNG_URL config |
| `jarvis-ui/src/stores/chat.ts` | Add inlineWebpage, inlineVideo, searchResults |
| `jarvis-ui/src/hooks/useChatSocket.ts` | Add socket event handlers |
| `jarvis-ui/src/components/center/ChatMessage.tsx` | Render new content types |

## MCP Tools Specification

### 1. web_search (GREEN)
Search the web via SearXNG. Returns titles, URLs, snippets.
```typescript
{ query: string, limit?: number, engines?: string }
```

### 2. fetch_webpage (GREEN)
Fetch webpage content, optionally summarize with Claude.
```typescript
{ url: string, summarize?: boolean }
```

### 3. open_url (GREEN)
Display webpage in sandboxed iframe in UI.
```typescript
{ url: string, title?: string }
```

### 4. search_youtube (GREEN)
Search YouTube for videos.
```typescript
{ query: string, limit?: number }
```

### 5. play_youtube (GREEN)
Embed YouTube player in UI.
```typescript
{ videoId: string } | { url: string }
```

### 6. play_video (GREEN)
Play direct video URL or local file.
```typescript
{ url?: string, path?: string, node?: string }
```

### 7. open_in_browser (YELLOW)
Launch URL in system browser on cluster node.
```typescript
{ url: string, node?: string }
```

## Socket.IO Events

| Event | Payload | Purpose |
|-------|---------|---------|
| `chat:show_webpage` | `{ url, title, timestamp }` | Display iframe |
| `chat:close_webpage` | `{}` | Close iframe |
| `chat:show_video` | `{ type, url?, videoId?, timestamp }` | Show video player |
| `chat:close_video` | `{}` | Close video |
| `chat:show_search_results` | `{ query, results[], timestamp }` | Show search results |

## Docker: SearXNG Service

```yaml
jarvis-searxng:
  image: searxng/searxng:latest
  container_name: jarvis-searxng
  restart: unless-stopped
  volumes:
    - searxng-data:/etc/searxng
  networks:
    - jarvis-net
  deploy:
    resources:
      limits:
        memory: 512M
```

## Router Keywords to Add

```typescript
// ACTION_KEYWORDS
'search', 'browse', 'look up', 'google', 'youtube', 'play video', 'watch'

// ENTITY_PATTERNS
/\b(website|webpage|url|link|http|https)\b/i
/\b(youtube|video|videos|mp4|webm)\b/i
/\b(search|google|bing|duckduckgo)\b/i
```

## Implementation Waves

### Wave 1: SearXNG + web_search tool (32-01)
- Add SearXNG to docker-compose
- Create web.ts with web_search only
- Update tiers, tools, router
- Test end-to-end

### Wave 2: Search Results UI (32-02)
- Add searchResults to chat store
- Create SearchResultsCard.tsx
- Add socket handler
- Update ChatMessage

### Wave 3: Webpage Display (32-03)
- Add fetch_webpage, open_url tools
- Add validateUrlForEmbed()
- Create InlineWebCard.tsx
- Add socket handlers

### Wave 4: YouTube Integration (32-04)
- Add search_youtube, play_youtube tools
- Create InlineVideoCard.tsx with YouTube embed
- Test search and playback

### Wave 5: Direct Video + Browser (32-05)
- Add play_video for direct URLs/local files
- Add open_in_browser (YELLOW tier)
- Add fullscreen modal variants

### Wave 6: Polish (32-06)
- Loading states, error handling
- Keyboard shortcuts (Escape to close)
- Update system prompt with new capabilities

## Verification Commands

```bash
# Test web search
curl -s "http://localhost:8888/search?q=test&format=json" | jq '.results[:3]'

# Test YouTube search
curl -s "http://localhost:8888/search?q=rick+astley&categories=videos&format=json" | jq '.results[:3]'

# Test health
curl -s http://localhost:4000/api/health | jq '.components'
```

## Dependencies

- No new npm packages (use fetch, html parsing via regex/string manipulation)
- SearXNG Docker image: searxng/searxng:latest (~150MB)
- YouTube embed: youtube-nocookie.com (no API key needed)

## Security Considerations

1. **SSRF Protection**: Extend existing validateUrl() for all fetch operations
2. **Iframe Sandboxing**: Strict sandbox attribute, no top navigation
3. **YouTube Safety**: Use nocookie domain, validate videoId format (11 chars, alphanumeric+dash+underscore)
4. **URL Validation**: HTTPS required for embeds, block private IPs
5. **Content Sanitization**: Strip scripts from fetched HTML before display

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SearXNG rate limiting | Built-in rate limiting in SearXNG config |
| YouTube videoId injection | Regex validation: `/^[a-zA-Z0-9_-]{11}$/` |
| Large page fetch | Limit response size to 1MB, timeout 10s |
| Iframe escape | Strict CSP, sandbox, X-Frame-Options respected |

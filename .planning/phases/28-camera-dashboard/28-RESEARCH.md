# Phase 28: Camera Dashboard - Research

**Researched:** 2026-01-29
**Domain:** Frigate NVR integration, camera streaming, React dashboard components
**Confidence:** HIGH

## Summary

This research covers the integration of Frigate NVR camera feeds, snapshots, and event history into the Jarvis dashboard. The existing codebase has a well-established frigate.ts client with comprehensive API coverage for events, snapshots, thumbnails, and face recognition. Frigate 0.16.4 is running on agent1:5000 with two cameras (front_door, side_house).

For live streaming, Frigate uses go2rtc (v1.9.9) built-in, accessed via MSE (Media Source Extensions) WebSocket at `/live/mse/api/ws?src=<camera_name>`. The video-rtc.js library from go2rtc provides a custom web element `<video-rtc>` that handles all streaming complexity including WebRTC, MSE, HLS, and MJPEG fallbacks.

The jarvis-ui codebase follows consistent patterns: PanelFrame for panel containers, Zustand stores for state, TailwindCSS v4 with CSS custom properties for theming, and memo/useCallback for performance optimization.

**Primary recommendation:** Use the existing frigate.ts client for snapshots/events, video-rtc.js web component for live MSE streaming, and create CameraPanel/EventList components following existing UI patterns.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| frigate.ts | custom | Frigate REST API client | Already in codebase, covers all needed endpoints |
| video-rtc.js | 1.6.0 | go2rtc streaming web component | Official go2rtc player, handles MSE/WebRTC/HLS |
| react | 18.x | UI framework | Existing codebase standard |
| zustand | 4.x | State management | Existing codebase standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TailwindCSS | 4.1.18 | Styling | All component styling |
| react-window | existing | Virtual scrolling | If event list grows large |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| video-rtc.js | hls.js | HLS has higher latency, MSE via video-rtc.js is lower latency |
| Custom modal | yet-another-react-lightbox | Existing ConfirmDialog pattern works, keep consistent |
| MQTT events | HTTP polling | MQTT is more real-time but adds complexity; HTTP polling deferred |

**Installation:**
```bash
# video-rtc.js is a single file, can be vendored or loaded from CDN
# No npm package needed - fetch from go2rtc repo or Frigate's built-in /assets/
```

## Architecture Patterns

### Recommended Project Structure
```
jarvis-ui/src/
├── components/
│   └── camera/
│       ├── CameraPanel.tsx          # Main camera grid component
│       ├── CameraCard.tsx           # Single camera snapshot card
│       ├── CameraModal.tsx          # Full-size snapshot modal
│       ├── EventList.tsx            # Recent events with filtering
│       ├── EventRow.tsx             # Single event row (memoized)
│       └── LiveStreamModal.tsx      # MSE live stream viewer
├── stores/
│   └── camera.ts                    # Zustand store for camera state
├── hooks/
│   └── useCameraPolling.ts          # Snapshot/event refresh hook
└── types/
    └── camera.ts                    # FrigateEvent, CameraState types
```

### Pattern 1: Backend API Proxy for Images
**What:** Proxy Frigate snapshot/thumbnail requests through jarvis-backend
**When to use:** Always - avoids CORS issues, centralizes auth
**Example:**
```typescript
// jarvis-backend/src/api/camera.ts
router.get('/api/cameras/:camera/snapshot', async (req, res) => {
  const buffer = await getLatestSnapshot(req.params.camera);
  res.set('Content-Type', 'image/jpeg');
  res.send(buffer);
});

router.get('/api/events/:eventId/thumbnail', async (req, res) => {
  const buffer = await getEventThumbnail(req.params.eventId);
  res.set('Content-Type', 'image/jpeg');
  res.send(buffer);
});
```

### Pattern 2: Video-rtc.js Web Component Integration
**What:** Use video-rtc.js as a custom HTML element for MSE streaming
**When to use:** Live camera view
**Example:**
```typescript
// Register the custom element (do once at app init)
import VideoRTC from './vendor/video-rtc.js';
if (!customElements.get('video-rtc')) {
  customElements.define('video-rtc', VideoRTC);
}

// Use in React component
function LiveStreamModal({ camera, onClose }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      // video-rtc.js auto-converts http:// to ws://
      ref.current.setAttribute('src', `http://192.168.1.61:5000/live/mse/api/ws?src=${camera}`);
    }
    return () => {
      if (ref.current) ref.current.removeAttribute('src');
    };
  }, [camera]);

  return (
    <div className="fixed inset-0 bg-black/80 z-50">
      <video-rtc ref={ref} mode="mse,webrtc,hls" />
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

### Pattern 3: Zustand Store with Polling
**What:** Camera store with periodic snapshot/event refresh
**When to use:** Dashboard state management
**Example:**
```typescript
// stores/camera.ts
interface CameraState {
  cameras: string[];
  snapshots: Record<string, string>; // base64 or blob URLs
  events: FrigateEvent[];
  lastRefresh: number;
  setSnapshots: (snapshots: Record<string, string>) => void;
  setEvents: (events: FrigateEvent[]) => void;
}

export const useCameraStore = create<CameraState>()(
  devtools((set) => ({
    cameras: ['front_door', 'side_house'],
    snapshots: {},
    events: [],
    lastRefresh: 0,
    setSnapshots: (snapshots) => set({ snapshots, lastRefresh: Date.now() }),
    setEvents: (events) => set({ events }),
  }))
);
```

### Pattern 4: Image Loading with Blob URLs
**What:** Fetch images as blobs, create object URLs for display
**When to use:** Camera snapshots, event thumbnails
**Example:**
```typescript
async function fetchSnapshot(camera: string): Promise<string> {
  const res = await fetch(`/api/cameras/${camera}/snapshot`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Cleanup blob URLs when component unmounts
useEffect(() => {
  return () => {
    Object.values(snapshots).forEach(url => URL.revokeObjectURL(url));
  };
}, [snapshots]);
```

### Anti-Patterns to Avoid
- **Direct Frigate API calls from frontend:** CORS issues, exposes Frigate URL
- **Inline base64 in src:** Large images cause DOM bloat
- **Polling too fast:** 5s interval is reasonable, faster wastes bandwidth
- **Not cleaning up blob URLs:** Memory leaks on component remount

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MSE streaming | Raw MediaSource API | video-rtc.js | Handles codec negotiation, reconnection, buffer management |
| Camera snapshot proxy | Direct fetch from frontend | Backend API route | CORS, auth centralization |
| Event time formatting | Manual date math | Existing formatTime pattern | Already used in ActivityFeed |
| Modal dialogs | Custom portal logic | Existing ConfirmDialog pattern | Consistent styling, keyboard handling |
| Image lazy loading | Intersection Observer | Native loading="lazy" | Browser handles it efficiently |

**Key insight:** The frigate.ts client already handles all Frigate API calls including error handling and timeouts. Don't duplicate this logic in the frontend.

## Common Pitfalls

### Pitfall 1: MSE Not Working on Safari iOS
**What goes wrong:** Safari iOS doesn't support MediaSource API
**Why it happens:** Apple restricts MSE to favor HLS
**How to avoid:** video-rtc.js handles this by falling back to MP4 over WebSocket or HLS
**Warning signs:** Black video on iOS devices

### Pitfall 2: Snapshot Cache Busting
**What goes wrong:** Browser caches old snapshots, shows stale images
**Why it happens:** Same URL returns different content over time
**How to avoid:** Add timestamp query param: `?t=${Date.now()}`
**Warning signs:** Snapshots don't update after refresh button click

### Pitfall 3: WebSocket Connection Limits
**What goes wrong:** Browser limits concurrent WebSocket connections (varies by browser, typically 6-256 per host)
**Why it happens:** Each live stream is a WebSocket connection
**How to avoid:** Only open live stream when modal is visible, close on modal dismiss
**Warning signs:** Live streams stop loading after opening several

### Pitfall 4: Memory Leaks from Blob URLs
**What goes wrong:** Blob URLs not revoked accumulate in memory
**Why it happens:** URL.createObjectURL() allocates memory until URL.revokeObjectURL()
**How to avoid:** Revoke old URLs when updating snapshots or unmounting
**Warning signs:** Memory usage grows over time, browser tab slows down

### Pitfall 5: Face Label Array Format
**What goes wrong:** Assuming sub_label is always a string
**Why it happens:** Frigate 0.16+ returns `[name, confidence]` array for face recognition
**How to avoid:** Use parseFaceSubLabel() from frigate.ts client
**Warning signs:** TypeError when accessing face name

## Code Examples

### Frigate API Endpoints (Verified)
```typescript
// Source: Tested against Frigate 0.16.4 at 192.168.1.61:5000

// Get latest snapshot (returns JPEG)
GET /api/{camera}/latest.jpg
// Example: /api/front_door/latest.jpg

// Get event thumbnail (smaller, optimized for lists)
GET /api/events/{eventId}/thumbnail.jpg
// Query params: ?format=android (2:1 aspect ratio)

// Get event snapshot (full size)
GET /api/events/{eventId}/snapshot.jpg
// Query params: ?crop=1&quality=70 (only during in-progress events)

// List events with filters
GET /api/events
// Query params:
//   ?camera=front_door
//   ?label=person
//   ?limit=20
//   ?has_snapshot=1
//   ?after={unix_timestamp}
//   ?before={unix_timestamp}

// Get event summary (counts by camera/label)
GET /api/events/summary

// Get camera config
GET /api/config
// Response: { cameras: { front_door: {...}, side_house: {...} } }
```

### MSE Live Stream URLs
```typescript
// Source: go2rtc documentation and Frigate frontend

// MSE WebSocket stream (preferred for low latency)
ws://192.168.1.61:5000/live/mse/api/ws?src={camera_name}
// Example: ws://192.168.1.61:5000/live/mse/api/ws?src=front_door

// RTSP restream (for other consumers)
rtsp://192.168.1.61:8554/{camera_name}

// go2rtc API (stream info)
GET /api/go2rtc/api
// Returns: { version: "1.9.9", host: "192.168.1.61", ... }

// go2rtc web interface
http://192.168.1.61:5000/live/webrtc/
```

### Video-rtc.js Usage
```typescript
// Source: https://github.com/AlexxIT/go2rtc/blob/master/www/video-rtc.js

// video-rtc.js class API
class VideoRTC extends HTMLElement {
  // Config properties (set as attributes or properties)
  mode: string = 'webrtc,mse,hls,mjpeg';  // Protocol preference order
  media: string = 'video,audio';           // Requested streams
  background: boolean = false;             // Keep stream when tab hidden
  visibilityCheck: boolean = true;         // Pause when tab loses focus

  // State properties (read-only)
  wsState: number;  // WebSocket.CONNECTING | OPEN | CLOSED
  pcState: number;  // WebRTC state

  // Set stream URL (auto-converts http:// to ws://)
  set src(url: string);

  // Methods
  play(): void;  // Start playback with automute fallback
  send(msg: object): void;  // Send message over WebSocket
}

// React integration
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'video-rtc': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          mode?: string;
          media?: string;
        },
        HTMLElement
      >;
    }
  }
}
```

### Event Type Structure
```typescript
// Source: Frigate API response, verified against 0.16.4

interface FrigateEvent {
  id: string;                               // e.g. "1769696529.086688-w4efom"
  camera: string;                           // e.g. "front_door"
  label: string;                            // e.g. "person", "car"
  sub_label: string | [string, number] | null; // Face recognition data
  zones: string[];                          // Triggered zones
  start_time: number;                       // Unix timestamp
  end_time: number | null;                  // null if in-progress
  has_clip: boolean;
  has_snapshot: boolean;
  top_score: number | null;                 // Highest confidence score
  data: {
    box: [number, number, number, number];  // Bounding box [x, y, w, h] normalized
    score: number;                          // Current confidence
    top_score: number;
    attributes: string[];
    type: string;                           // "object"
    max_severity: string;                   // "alert"
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HLS streaming | MSE via go2rtc | Frigate 0.12+ | Lower latency, better browser support |
| sub_label as string | sub_label as [name, confidence] | Frigate 0.14+ | Richer face recognition data |
| Separate go2rtc config | Built-in go2rtc | Frigate 0.12+ | Simplified setup |
| MQTT only for events | HTTP API + MQTT | Always | HTTP API sufficient for dashboard |

**Deprecated/outdated:**
- Frigate < 0.12 did not have built-in go2rtc
- Old sub_label format (string only) still supported but array format is current

## Open Questions

Things that couldn't be fully resolved:

1. **go2rtc streams empty**
   - What we know: `/api/go2rtc/api/streams` returns `{}`, but cameras work in Frigate UI
   - What's unclear: Whether streams need explicit configuration or are created on-demand
   - Recommendation: Use `/live/mse/api/ws?src=camera_name` directly, which works

2. **Event thumbnail vs snapshot sizing**
   - What we know: thumbnail.jpg is smaller, snapshot.jpg is full size
   - What's unclear: Exact dimensions of each
   - Recommendation: Use thumbnail for lists, snapshot for modal; let CSS handle sizing

## Sources

### Primary (HIGH confidence)
- Frigate 0.16.4 API (tested directly at 192.168.1.61:5000)
- frigate.ts client in codebase (reviewed source)
- go2rtc video-rtc.js v1.6.0 (fetched and analyzed)

### Secondary (MEDIUM confidence)
- [Frigate Live View Documentation](https://docs.frigate.video/configuration/live/)
- [go2rtc GitHub Repository](https://github.com/AlexxIT/go2rtc)
- [Frigate API Documentation](https://docs.frigate.video/integrations/api/)

### Tertiary (LOW confidence)
- GitHub discussions about Frigate frontend source paths (not directly verified)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Existing frigate.ts client verified, video-rtc.js documented
- Architecture: HIGH - Follows existing jarvis-ui patterns exactly
- Pitfalls: HIGH - Based on direct testing and official documentation
- MSE streaming URLs: HIGH - Verified via web search and Frigate community

**Research date:** 2026-01-29
**Valid until:** 60 days (Frigate API stable, go2rtc actively maintained)

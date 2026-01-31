# Phase 29: Proactive Alerts - Research

**Researched:** 2026-01-30
**Domain:** Real-time event monitoring and notification delivery
**Confidence:** HIGH

## Summary

This phase implements proactive alerting for unknown person detections at entry cameras by polling Frigate's event API and delivering real-time notifications via Socket.IO with TTS announcements. The standard approach combines periodic polling (5s interval) with event deduplication using cooldown tracking, emitting structured notifications to the existing Socket.IO `/chat` namespace.

The research reveals that **MQTT subscription is the industry-standard approach** for real-time Frigate event monitoring, providing <100ms latency versus polling's 5s delay. However, polling is simpler to implement and meets the 10s latency requirement (ALERT-02). MQTT integration is explicitly marked as a v2 enhancement (ALERT-v2-01).

**Primary recommendation:** Implement HTTP polling pattern with in-memory cooldown tracking and Socket.IO notification delivery. Use existing TTS pipeline for optional voice announcements. Consider MQTT migration in Phase 29-v2 for sub-second latency.

## Standard Stack

The established libraries/tools for real-time notifications and event polling:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Socket.IO | 4.x | Real-time bidirectional events | Already in use for `/cluster`, `/chat`, `/terminal`, `/events` namespaces |
| Node.js setInterval | native | Periodic polling | Simple, reliable, zero dependencies for 5s intervals |
| Map<string, number> | native | In-memory cooldown tracking | O(1) lookups, automatic GC, sufficient for single-instance deployment |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sqlite3 + drizzle-orm | current | Optional persistent cooldown state | Only if cooldowns must survive restarts (not required) |
| mqtt.js | 5.x | MQTT client for real-time events | Future v2 enhancement (ALERT-v2-01) for <100ms latency |
| react-toastify | 10.x | React notification toasts | Industry standard with 2M weekly downloads, TypeScript support |
| sonner | 1.x | Modern React toast library | Emerging preferred choice for React 18+, better accessibility |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HTTP polling | MQTT subscription | MQTT requires broker setup, adds complexity; polling meets 10s requirement |
| In-memory cooldown | SQLite persistence | DB adds latency, unnecessary for ephemeral cooldowns |
| Socket.IO emit | Server-Sent Events (SSE) | SSE is unidirectional, Socket.IO already in stack |
| Custom toast | shadcn/ui + sonner | Shadcn requires full design system, overkill for single component |

**Installation:**
```bash
# Frontend (if adding dedicated toast library)
cd jarvis-ui
npm install react-toastify
# OR
npm install sonner

# Backend (future MQTT enhancement)
cd jarvis-backend
npm install mqtt  # NOT needed for Phase 29
```

## Architecture Patterns

### Recommended Project Structure
```
jarvis-backend/src/
├── services/
│   └── alert-monitor.ts      # Event polling service (new)
├── realtime/
│   └── chat.ts               # Extend with alert:notification event (modify)
├── clients/
│   └── frigate.ts            # Already has getEvents() with after param
└── db/
    └── schema.ts             # Optional: cooldown persistence table

jarvis-ui/src/
├── components/
│   └── alerts/
│       └── AlertNotification.tsx  # Notification card component (new)
├── stores/
│   └── alerts.ts             # Alert state management (new)
└── hooks/
    └── useAlertSocket.ts     # Socket.IO alert listener (new)
```

### Pattern 1: Polling Service with Deduplication
**What:** Background interval polling Frigate events API with timestamp tracking and cooldown deduplication
**When to use:** When MQTT broker is not available or polling latency (<10s) is acceptable

**Example:**
```typescript
// Source: Pattern adapted from jarvis-backend/src/realtime/emitter.ts (polling pattern)
// and https://medium.com/@xaviergeerinck/creating-a-non-blocking-polling-system-in-node-js-with-settimeout-and-eventemitter-4aaa098d25fb

interface CooldownEntry {
  camera: string;
  label: string;
  lastAlertTime: number;
}

class AlertMonitor {
  private lastPollTimestamp: number = Math.floor(Date.now() / 1000);
  private cooldowns = new Map<string, number>(); // key: `${camera}:${label}`, value: timestamp
  private interval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds (ALERT-01)
  private readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes (ALERT-04)
  private readonly ENTRY_CAMERAS = ['front_door', 'back_door', 'garage'];

  start(eventsNs: Namespace): void {
    // Immediate first poll
    this.pollEvents(eventsNs).catch(console.error);

    // Schedule periodic polling
    this.interval = setInterval(() => {
      this.pollEvents(eventsNs).catch(console.error);
    }, this.POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async pollEvents(eventsNs: Namespace): Promise<void> {
    try {
      // Query Frigate for person events since last poll
      const events = await getEvents({
        label: 'person',
        after: this.lastPollTimestamp,
        has_snapshot: true,
      });

      const now = Math.floor(Date.now() / 1000);
      this.lastPollTimestamp = now;

      for (const event of events) {
        // Filter: only entry cameras (ALERT-02)
        if (!this.ENTRY_CAMERAS.includes(event.camera)) continue;

        // Detect unknown person: sub_label is null (ALERT-02)
        if (event.sub_label !== null) continue;

        // Check cooldown
        const cooldownKey = `${event.camera}:person`;
        const lastAlert = this.cooldowns.get(cooldownKey);
        if (lastAlert && (Date.now() - lastAlert) < this.COOLDOWN_MS) {
          continue; // Still in cooldown period
        }

        // Emit proactive alert
        this.cooldowns.set(cooldownKey, Date.now());
        eventsNs.emit('alert:notification', {
          id: event.id,
          type: 'unknown_person',
          camera: event.camera,
          timestamp: event.start_time,
          thumbnailUrl: `/api/events/${event.id}/thumbnail`,
          message: `Unknown person detected at ${event.camera.replace('_', ' ')}`,
        });

        console.log(`[Alert] Unknown person at ${event.camera} (event ${event.id})`);
      }

      // Cleanup expired cooldowns (prevent memory leak)
      const expiryThreshold = Date.now() - this.COOLDOWN_MS;
      for (const [key, timestamp] of this.cooldowns.entries()) {
        if (timestamp < expiryThreshold) {
          this.cooldowns.delete(key);
        }
      }
    } catch (err) {
      console.warn('[Alert Monitor] Poll failed:', err instanceof Error ? err.message : err);
    }
  }
}
```

**Key principles:**
- Use `after` timestamp parameter to fetch only new events since last poll
- Track last poll time to avoid re-processing events
- Use Map for O(1) cooldown lookups
- Clean up expired cooldowns to prevent memory growth
- Non-blocking: errors logged but don't crash the service

### Pattern 2: Socket.IO Notification Delivery
**What:** Emit structured alert events to Socket.IO namespace for real-time dashboard updates
**When to use:** Existing Socket.IO infrastructure for bidirectional communication

**Example:**
```typescript
// Source: Pattern from jarvis-backend/src/realtime/chat.ts (Socket.IO emitter)
// Extended for proactive alerts

// Backend: Emit alert notification
eventsNs.emit('alert:notification', {
  id: event.id,
  type: 'unknown_person',
  camera: event.camera,
  timestamp: event.start_time,
  thumbnailUrl: `/api/events/${event.id}/thumbnail`,
  message: `Unknown person detected at ${event.camera.replace('_', ' ')}`,
  ttsEnabled: config.alertTtsEnabled ?? true, // ALERT-05
});

// Frontend: Listen for alerts
useEffect(() => {
  if (!socket) return;

  const handleAlert = (alert: AlertNotification) => {
    // Add to alert store
    alertStore.addAlert(alert);

    // Show toast notification
    toast.info(alert.message, {
      icon: '🚨',
      autoClose: 10000,
    });
  };

  socket.on('alert:notification', handleAlert);
  return () => { socket.off('alert:notification', handleAlert); };
}, [socket]);
```

### Pattern 3: TTS Announcement Integration
**What:** Trigger optional voice announcement when proactive alert is emitted
**When to use:** User preference for audio feedback on security events

**Example:**
```typescript
// Source: Adapted from jarvis-backend/src/ai/tts.ts (synthesis pipeline)

private async emitAlert(event: FrigateEvent, eventsNs: Namespace): Promise<void> {
  const alert = {
    id: event.id,
    type: 'unknown_person',
    camera: event.camera,
    timestamp: event.start_time,
    thumbnailUrl: `/api/events/${event.id}/thumbnail`,
    message: `Unknown person detected at ${event.camera.replace('_', ' ')}`,
  };

  eventsNs.emit('alert:notification', alert);

  // Optional TTS announcement (ALERT-05)
  if (config.alertTtsEnabled) {
    const ttsText = `Alert: Unknown person detected at ${event.camera.replace('_', ' ')}.`;
    try {
      // Use fast Piper TTS for alerts (<200ms synthesis)
      const audio = await synthesizeViaPiper(ttsText);
      if (audio) {
        eventsNs.emit('alert:audio', {
          id: event.id,
          audio: audio.buffer.toString('base64'),
          contentType: audio.contentType,
        });
      }
    } catch (err) {
      console.warn('[Alert] TTS synthesis failed:', err);
      // Non-critical: alert still delivered via text notification
    }
  }
}
```

### Anti-Patterns to Avoid

- **Polling individual event IDs:** Don't query `/events/{id}` in a loop; use bulk `/events?after=timestamp`
- **Synchronous polling without error handling:** Uncaught promise rejections crash Node.js; always `.catch()`
- **Growing unbounded cooldown Map:** Clean up expired entries periodically
- **Blocking TTS synthesis:** Use fire-and-forget pattern; don't await TTS before emitting text alert
- **Client-side polling:** Event polling should be server-side only; clients receive via Socket.IO

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom CSS overlay system | react-toastify or sonner | Auto-stacking, animations, accessibility (ARIA), mobile support, 10K+ edge cases |
| Event deduplication | Array.filter() on every poll | Map-based cooldown tracking | O(1) lookups vs O(n), automatic GC, production-proven pattern |
| Time-based throttling | Custom setTimeout tracking | Map + timestamp comparison | Race conditions, memory leaks, timezone edge cases already solved |
| MQTT reconnection logic | Manual WebSocket retry | mqtt.js library | Auto-reconnect, QoS levels, session persistence, battle-tested |
| Timestamp formatting | String manipulation | Date.toLocaleString() or date-fns | i18n, timezones, edge cases (leap seconds, DST) |

**Key insight:** Notification UX has accessibility requirements (screen readers, keyboard nav) and performance edge cases (simultaneous alerts, rapid dismiss, z-index stacking) that take months to solve. Libraries like react-toastify handle these transparently.

## Common Pitfalls

### Pitfall 1: Polling Overload Without Debouncing
**What goes wrong:** Multiple event polls fire simultaneously if previous poll hasn't completed, causing API rate limiting and duplicate alerts
**Why it happens:** setInterval continues firing even if callback is still running (network latency > poll interval)
**How to avoid:**
- Use "lock" flag to skip poll if previous is in-flight
- Alternative: Use setTimeout recursively instead of setInterval
**Warning signs:** Frigate API 429 errors, duplicate alert notifications, CPU spike every 5 seconds

**Example:**
```typescript
// BAD: Can stack polls if Frigate is slow
setInterval(() => pollEvents(), 5000);

// GOOD: Skip if already polling
let isPolling = false;
setInterval(() => {
  if (isPolling) return;
  isPolling = true;
  pollEvents().finally(() => { isPolling = false; });
}, 5000);
```

### Pitfall 2: Cooldown Key Collision
**What goes wrong:** Using event ID as cooldown key causes new detection to trigger alert even during cooldown (each event has unique ID)
**Why it happens:** Confusion between event identity and detection identity
**How to avoid:** Use `${camera}:${label}` as cooldown key, not event.id
**Warning signs:** Alerts firing every 5 seconds despite cooldown, users reporting "spam"

**Example:**
```typescript
// BAD: New event = new ID = bypasses cooldown
cooldowns.set(event.id, Date.now());

// GOOD: Track by camera + object type
const key = `${event.camera}:${event.label}`;
cooldowns.set(key, Date.now());
```

### Pitfall 3: Missing Snapshot Pre-check
**What goes wrong:** Alert notifications display broken image icons when event has no snapshot
**Why it happens:** Not all Frigate events have snapshots (depends on config and detection quality)
**How to avoid:** Filter for `has_snapshot: true` in getEvents() query
**Warning signs:** Broken thumbnail images in notifications, 404 errors in network tab

### Pitfall 4: Timestamp Precision Mismatch
**What goes wrong:** Events re-processed on every poll, causing duplicate alerts
**Why it happens:** Frigate uses Unix timestamp in seconds, JavaScript uses milliseconds
**How to avoid:** Always use `Math.floor(Date.now() / 1000)` when comparing to Frigate timestamps
**Warning signs:** Every event triggers alert on every poll, cooldown never activates

**Example:**
```typescript
// BAD: Milliseconds vs seconds mismatch
const after = Date.now(); // 1738276376123 (ms)
// Frigate compares: 1738276376123 > 1738276376 (true always)

// GOOD: Convert to seconds
const after = Math.floor(Date.now() / 1000); // 1738276376 (s)
```

### Pitfall 5: Memory Leak from Toast Accumulation
**What goes wrong:** Notifications stack up in DOM, slowing down UI after hours of runtime
**Why it happens:** Toast libraries don't auto-dismiss if `autoClose: false` is set
**How to avoid:** Always set `autoClose` duration (recommended: 10s for alerts)
**Warning signs:** Laggy UI after 24h runtime, hundreds of toast elements in React DevTools

## Code Examples

Verified patterns from existing codebase:

### Polling with Timestamp Tracking
```typescript
// Source: /root/jarvis-backend/src/realtime/emitter.ts (lines 85-100, 205-213)
// Pattern: Periodic polling with error isolation

let lastEventTimestamp = Math.floor(Date.now() / 1000);

async function pollFrigateEvents(): Promise<void> {
  try {
    const events = await getEvents({
      label: 'person',
      after: lastEventTimestamp,
      has_snapshot: true,
    });

    const now = Math.floor(Date.now() / 1000);
    lastEventTimestamp = now; // Update AFTER successful fetch

    for (const event of events) {
      // Process event...
    }
  } catch (err) {
    console.warn('[Alert] Poll failed:', err instanceof Error ? err.message : err);
    // DON'T update lastEventTimestamp on error - retry from same point
  }
}

// Start polling
setInterval(() => { pollFrigateEvents().catch(() => {}); }, 5000);
```

### Socket.IO Namespace Emission
```typescript
// Source: /root/jarvis-backend/src/index.ts (lines 88-98)
// Pattern: Emit to namespace for broadcast to all connected clients

eventsNs.emit('alert:notification', {
  id: event.id,
  type: 'unknown_person',
  camera: event.camera,
  timestamp: event.start_time,
  thumbnailUrl: `/api/events/${event.id}/thumbnail`,
  message: `Unknown person detected at ${event.camera.replace('_', ' ')}`,
});
```

### React Hook for Socket.IO Listener
```typescript
// Source: Pattern from jarvis-ui/src/hooks/useVoice.ts (Socket.IO hook pattern)
// Adapted for alert notifications

interface AlertNotification {
  id: string;
  type: 'unknown_person';
  camera: string;
  timestamp: number;
  thumbnailUrl: string;
  message: string;
}

function useAlertSocket(socket: Socket | null) {
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);

  useEffect(() => {
    if (!socket) return;

    const handleAlert = (alert: AlertNotification) => {
      setAlerts(prev => [alert, ...prev].slice(0, 10)); // Keep last 10

      // Optional: Show toast notification
      toast.info(alert.message, {
        icon: '🚨',
        autoClose: 10000,
      });
    };

    socket.on('alert:notification', handleAlert);

    return () => {
      socket.off('alert:notification', handleAlert);
    };
  }, [socket]);

  return { alerts };
}
```

### Cooldown Cleanup Pattern
```typescript
// Source: Adapted from Map usage patterns in jarvis-backend/src/realtime/chat.ts
// Pattern: Periodic cleanup to prevent memory growth

class AlertMonitor {
  private cooldowns = new Map<string, number>();
  private readonly COOLDOWN_MS = 5 * 60 * 1000;

  private cleanupExpiredCooldowns(): void {
    const now = Date.now();
    const threshold = now - this.COOLDOWN_MS;

    for (const [key, timestamp] of this.cooldowns.entries()) {
      if (timestamp < threshold) {
        this.cooldowns.delete(key);
      }
    }
  }

  private async pollEvents(eventsNs: Namespace): Promise<void> {
    // ... event processing ...

    // Cleanup at end of each poll
    this.cleanupExpiredCooldowns();
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Long polling (30s-60s) | Short polling (5s) or MQTT | 2020-2023 | Modern APIs support sub-second latency; long polling feels laggy |
| Custom notification divs | react-toastify / sonner | 2022-2026 | Accessibility, mobile support, auto-stacking solved by libraries |
| setInterval without guard | Lock flag or recursive setTimeout | 2019-2024 | Prevents poll stacking and API overload |
| Global cooldown (all cameras) | Per-camera cooldown tracking | 2021+ | User doesn't want front door alerts suppressing back door alerts |
| SQLite for ephemeral state | In-memory Map with cleanup | 2020+ | Faster, simpler, no disk I/O for transient data |

**Deprecated/outdated:**
- **WebSocket polling:** Replaced by Server-Sent Events (SSE) or Socket.IO; raw WebSocket requires manual reconnection logic
- **localStorage for cooldown:** Doesn't sync across tabs, pollutes user storage, unreliable (can be cleared)
- **Inline audio base64 in JSON:** Use binary events or separate audio stream; base64 inflates payload by 33%

## Open Questions

Things that couldn't be fully resolved:

1. **Should cooldown survive server restart?**
   - What we know: In-memory Map is simpler, faster (no DB I/O)
   - What's unclear: If server restarts during cooldown, user gets duplicate alert
   - Recommendation: Start with in-memory; persist to SQLite if users complain about restart duplicates

2. **Which Socket.IO namespace for alerts?**
   - What we know: `/events` namespace exists for system events, `/chat` for AI interactions
   - What's unclear: Alerts are security events (conceptually `/events`) but may need chat integration ("What happened while I was away?")
   - Recommendation: Emit on `/events` namespace with `type: 'alert'`, allow `/chat` to query from events table

3. **TTS voice for alerts (Jarvis vs Piper)?**
   - What we know: Jarvis XTTS is high-quality but slow (7-10s), Piper is fast (<200ms) but robotic
   - What's unclear: Does alert urgency override voice quality preference?
   - Recommendation: Use Piper for alerts (speed critical), Jarvis for chat responses (quality critical)

4. **Should alerts auto-dismiss or persist?**
   - What we know: Toast libraries default to auto-dismiss after 5s
   - What's unclear: User may miss alert if away from screen; persistent alerts clutter UI
   - Recommendation: Auto-dismiss toast (10s), persist to `/events` namespace state for "missed alerts" query

## Sources

### Primary (HIGH confidence)
- Frigate NVR API documentation: https://docs.frigate.video/integrations/api/
- Frigate MQTT integration: https://docs.frigate.video/integrations/mqtt/
- Node.js Event Loop timers: https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick
- Existing codebase: `/root/jarvis-backend/src/clients/frigate.ts` (getEvents API)
- Existing codebase: `/root/jarvis-backend/src/realtime/emitter.ts` (polling pattern)
- Existing codebase: `/root/jarvis-backend/src/ai/tts.ts` (Piper TTS synthesis)

### Secondary (MEDIUM confidence)
- Socket.IO notification patterns: https://novu.co/blog/build-a-real-time-notification-system-with-socket-io-and-reactjsbuild-a-real-time-notification-system-with-socket-io-and-reactjs/
- React notification libraries 2026: https://knock.app/blog/the-top-notification-libraries-for-react
- Rate limiting and throttling patterns: https://www.inngest.com/blog/rate-limit-debouncing-throttling-explained
- Non-blocking polling in Node.js: https://medium.com/@xaviergeerinck/creating-a-non-blocking-polling-system-in-node-js-with-settimeout-and-eventemitter-4aaa098d25fb

### Tertiary (LOW confidence)
- Event deduplication (Mixpanel context, not Frigate-specific): https://developer.mixpanel.com/reference/event-deduplication
- Frigate GitHub discussions (community recommendations, not official): https://github.com/blakeblackshear/frigate/discussions/12760

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Socket.IO, setInterval, Map are existing patterns in codebase
- Architecture: HIGH - Polling pattern verified in `/realtime/emitter.ts`, TTS integration in `/ai/tts.ts`
- Pitfalls: MEDIUM - Based on web search and general Node.js patterns, not Frigate-specific docs

**Research date:** 2026-01-30
**Valid until:** 2026-02-28 (30 days - stable domain, unlikely to change)

**Notes:**
- MQTT is recommended by Frigate community but marked as v2 enhancement (out of scope)
- Polling meets latency requirement (<10s from ALERT-02 acceptance criteria)
- Existing Socket.IO infrastructure minimizes new dependencies
- TTS integration already proven in `/chat` namespace, reusable pattern

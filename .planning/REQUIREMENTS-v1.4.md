# Requirements: Jarvis 3.1 -- v1.4 Performance & Reliability

**Defined:** 2026-01-27
**Core Value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.

## v1.4 Requirements

Requirements for the Performance & Reliability milestone. Each maps to roadmap phases 16-20.

### Streaming Voice Pipeline (Phase 16)

- [x] **PERF-001**: Sentence boundaries detected during LLM streaming (emit `chat:sentence` within 50ms of boundary token)
- [x] **PERF-002**: TTS synthesizes individual sentences (<3s per sentence on local XTTS)
- [x] **PERF-003**: Audio chunks delivered via Socket.IO binary events during streaming
- [x] **PERF-004**: Frontend plays audio chunks progressively (playback starts while LLM still generating)
- [x] **PERF-005**: Common JARVIS phrases cached (LRU, 50 entries) for instant replay
- [x] **PERF-006**: Per-sentence TTS timeout (8s) with browser SpeechSynthesis fallback

### Chat Rendering Performance (Phase 17)

- [x] **PERF-007**: Token appending is O(1) -- no array traversal during streaming
- [x] **PERF-008**: State updates batched to ~2/sec via requestAnimationFrame
- [x] **PERF-009**: Non-streaming messages skip re-render via React.memo
- [x] **PERF-010**: Auto-scroll throttled to 1/sec, respects manual scroll-up

### Backend Data Caching & API Efficiency (Phase 18)

- [x] **PERF-011**: Proxmox API responses cached with 5s TTL (nodes/VMs) and 15s TTL (storage)
- [x] **PERF-012**: Temperature polling runs all 4 nodes concurrently (max 10s vs sum 40s)
- [x] **PERF-013**: System prompt cluster summary cached for 30s between messages
- [x] **PERF-014**: Session history cached in-memory per socket (DB read once per session)
- [x] **PERF-015**: Memory access tracking batched into single SQLite transaction
- [x] **PERF-016**: VM and container queries run in parallel during system prompt build

### Dashboard Rendering Performance (Phase 19)

- [x] **PERF-017**: Store setters only create new references for items whose data actually changed
- [x] **PERF-018**: NodeCard/VMCard wrapped in React.memo (re-render only on own data change)
- [x] **PERF-019**: SVG filter definitions hoisted outside render (static, created once)
- [x] **PERF-020**: AudioVisualizer throttled to 30fps during playback, 0fps when idle
- [x] **PERF-021**: Motion library lazy-loaded (saves ~40KB gzipped from initial bundle)
- [x] **PERF-022**: prefers-reduced-motion disables scan lines, glows, orbital animations
- [x] **PERF-023**: ResizeObserver disconnected when terminal is collapsed

### Theme Consistency & Visual Polish (Phase 20)

- [x] **PERF-024**: Zero hardcoded color values outside theme definition -- all components use tokens
- [x] **PERF-025**: No visual overflow or clipping in center display at any viewport size
- [x] **PERF-026**: Glow effects use standardized intensity levels (sm/md/lg tokens)
- [x] **PERF-027**: EventRow memoized -- new events render only new rows

## Future Requirements

Deferred to v1.5+ milestones.

### Performance (v2)

- **PERF-028**: GPU-accelerated TTS -- move XTTS to GPU for <1s synthesis (needs hardware changes)
- **PERF-029**: WebSocket per-message deflate compression (unnecessary at LAN speeds currently)
- **PERF-030**: Virtual scrolling for conversations exceeding 50+ messages

### Infrastructure (v2)

- **INFRA-01**: Runbook concurrency limiter (low priority for 4-node cluster)
- **INFRA-02**: Worker thread TTS (streaming approach handles this for now)

## Out of Scope

| Feature | Reason |
|---------|--------|
| GPU hardware upgrades | Infrastructure change, not software optimization |
| WebRTC for audio delivery | Socket.IO binary events sufficient for LAN |
| Service worker for offline | Jarvis requires live cluster connection |
| CDN/edge caching | LAN-only deployment, no CDN needed |
| Database query optimization | SQLite is fast enough for single-user homelab |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PERF-001 | Phase 16 | Done |
| PERF-002 | Phase 16 | Done |
| PERF-003 | Phase 16 | Done |
| PERF-004 | Phase 16 | Done |
| PERF-005 | Phase 16 | Done |
| PERF-006 | Phase 16 | Done |
| PERF-007 | Phase 17 | Done |
| PERF-008 | Phase 17 | Done |
| PERF-009 | Phase 17 | Done |
| PERF-010 | Phase 17 | Done |
| PERF-011 | Phase 18 | Done |
| PERF-012 | Phase 18 | Done |
| PERF-013 | Phase 18 | Done |
| PERF-014 | Phase 18 | Done |
| PERF-015 | Phase 18 | Done |
| PERF-016 | Phase 18 | Done |
| PERF-017 | Phase 19 | Done |
| PERF-018 | Phase 19 | Done |
| PERF-019 | Phase 19 | Done |
| PERF-020 | Phase 19 | Done |
| PERF-021 | Phase 19 | Done |
| PERF-022 | Phase 19 | Done |
| PERF-023 | Phase 19 | Done |
| PERF-024 | Phase 20 | Done |
| PERF-025 | Phase 20 | Done |
| PERF-026 | Phase 20 | Done |
| PERF-027 | Phase 20 | Done |

**Coverage:**
- v1.4 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-01-27*

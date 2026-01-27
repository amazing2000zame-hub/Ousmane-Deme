# Requirements: Jarvis 3.1 -- v1.4 Performance & Reliability

**Defined:** 2026-01-27
**Core Value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.

## v1.4 Requirements

Requirements for the Performance & Reliability milestone. Each maps to roadmap phases 16-20.

### Streaming Voice Pipeline (Phase 16)

- [ ] **PERF-001**: Sentence boundaries detected during LLM streaming (emit `chat:sentence` within 50ms of boundary token)
- [ ] **PERF-002**: TTS synthesizes individual sentences (<3s per sentence on local XTTS)
- [ ] **PERF-003**: Audio chunks delivered via Socket.IO binary events during streaming
- [ ] **PERF-004**: Frontend plays audio chunks progressively (playback starts while LLM still generating)
- [ ] **PERF-005**: Common JARVIS phrases cached (LRU, 50 entries) for instant replay
- [ ] **PERF-006**: Per-sentence TTS timeout (8s) with browser SpeechSynthesis fallback

### Chat Rendering Performance (Phase 17)

- [ ] **PERF-007**: Token appending is O(1) -- no array traversal during streaming
- [ ] **PERF-008**: State updates batched to ~2/sec via requestAnimationFrame
- [ ] **PERF-009**: Non-streaming messages skip re-render via React.memo
- [ ] **PERF-010**: Auto-scroll throttled to 1/sec, respects manual scroll-up

### Backend Data Caching & API Efficiency (Phase 18)

- [ ] **PERF-011**: Proxmox API responses cached with 5s TTL (nodes/VMs) and 15s TTL (storage)
- [ ] **PERF-012**: Temperature polling runs all 4 nodes concurrently (max 10s vs sum 40s)
- [ ] **PERF-013**: System prompt cluster summary cached for 30s between messages
- [ ] **PERF-014**: Session history cached in-memory per socket (DB read once per session)
- [ ] **PERF-015**: Memory access tracking batched into single SQLite transaction
- [ ] **PERF-016**: VM and container queries run in parallel during system prompt build

### Dashboard Rendering Performance (Phase 19)

- [ ] **PERF-017**: Store setters only create new references for items whose data actually changed
- [ ] **PERF-018**: NodeCard/VMCard wrapped in React.memo (re-render only on own data change)
- [ ] **PERF-019**: SVG filter definitions hoisted outside render (static, created once)
- [ ] **PERF-020**: AudioVisualizer throttled to 30fps during playback, 0fps when idle
- [ ] **PERF-021**: Motion library lazy-loaded (saves ~40KB gzipped from initial bundle)
- [ ] **PERF-022**: prefers-reduced-motion disables scan lines, glows, orbital animations
- [ ] **PERF-023**: ResizeObserver disconnected when terminal is collapsed

### Theme Consistency & Visual Polish (Phase 20)

- [ ] **PERF-024**: Zero hardcoded color values outside theme definition -- all components use tokens
- [ ] **PERF-025**: No visual overflow or clipping in center display at any viewport size
- [ ] **PERF-026**: Glow effects use standardized intensity levels (sm/md/lg tokens)
- [ ] **PERF-027**: EventRow memoized -- new events render only new rows

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
| PERF-001 | Phase 16 | Pending |
| PERF-002 | Phase 16 | Pending |
| PERF-003 | Phase 16 | Pending |
| PERF-004 | Phase 16 | Pending |
| PERF-005 | Phase 16 | Pending |
| PERF-006 | Phase 16 | Pending |
| PERF-007 | Phase 17 | Pending |
| PERF-008 | Phase 17 | Pending |
| PERF-009 | Phase 17 | Pending |
| PERF-010 | Phase 17 | Pending |
| PERF-011 | Phase 18 | Pending |
| PERF-012 | Phase 18 | Pending |
| PERF-013 | Phase 18 | Pending |
| PERF-014 | Phase 18 | Pending |
| PERF-015 | Phase 18 | Pending |
| PERF-016 | Phase 18 | Pending |
| PERF-017 | Phase 19 | Pending |
| PERF-018 | Phase 19 | Pending |
| PERF-019 | Phase 19 | Pending |
| PERF-020 | Phase 19 | Pending |
| PERF-021 | Phase 19 | Pending |
| PERF-022 | Phase 19 | Pending |
| PERF-023 | Phase 19 | Pending |
| PERF-024 | Phase 20 | Pending |
| PERF-025 | Phase 20 | Pending |
| PERF-026 | Phase 20 | Pending |
| PERF-027 | Phase 20 | Pending |

**Coverage:**
- v1.4 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-01-27*

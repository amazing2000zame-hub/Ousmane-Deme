# Requirements: Jarvis 3.1 -- v1.5 Optimization & Latency Reduction

**Defined:** 2026-01-27
**Core Value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.

## v1.5 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### TTS Reliability & Fallback

- [ ] **TTS-01**: Piper TTS deployed as Docker container providing <200ms CPU-based speech synthesis as fallback engine
- [ ] **TTS-02**: Per-sentence 3-second timeout triggers automatic Piper fallback instead of skipping audio
- [ ] **TTS-03**: Health-aware TTS routing skips XTTS when recent health check indicates failure
- [ ] **TTS-04**: TTS engine consistency enforced -- if XTTS fails on any sentence, Piper used for all remaining sentences in that response

### TTS Performance

- [x] **PERF-01**: TTS LRU cache expanded to 200+ entries with engine-specific cache keys
- [ ] **PERF-02**: Bounded parallel TTS synthesis with max 2 concurrent workers and CPU affinity separation
- [ ] **PERF-03**: Disk-persistent TTS cache that survives container restarts with startup pre-warming of common JARVIS phrases
- [x] **PERF-04**: Sentence detection minimum length reduced and TTS health check with automatic container restart on failure

### Audio Encoding

- [ ] **AUDIO-01**: Optional Opus audio codec via FFmpeg encoding (8-10x smaller payloads, configurable flag for LAN vs remote access)

### Backend Optimization

- [x] **BACK-01**: SQLite performance PRAGMAs applied (synchronous=NORMAL, cache_size=-64000, temp_store=MEMORY, mmap_size=268435456)
- [ ] **BACK-02**: Conversation sliding window keeping last 20-30 messages in full with token-aware truncation and background Qwen summarization of older context

### Observability

- [ ] **OBS-01**: Latency tracing pipeline with per-request timing breakdown (t0 message received through t5 audio plays) using performance.now() timestamps
- [x] **OBS-02**: Expanded /api/health endpoint returning component-level status for TTS engines, LLM, Proxmox API connectivity, and database

### Frontend

- [ ] **UI-01**: Chat history virtualization using @tanstack/react-virtual for smooth scrolling at 100+ messages

## Future Requirements

Deferred to later milestones.

### Advanced Optimization (v1.6+)

- **ADV-01**: GPU TTS acceleration (if hardware available)
- **ADV-02**: Distributed component architecture across cluster nodes
- **ADV-03**: VLAN segmentation for service isolation
- **ADV-04**: ML-based intent router for LLM request classification
- **ADV-05**: ElevenLabs cloud TTS fallback (requires API key)
- **ADV-06**: Summary persistence across sessions for session resume

### Voice Retraining (carried from v1.3)

- **VOICE-13**: Extract clean audio segments from user-provided JARVIS video files using ffmpeg
- **VOICE-14**: Build training dataset from extracted audio (LJSpeech format)
- **VOICE-15**: Retrain XTTS v2 GPT decoder with new dataset
- **VOICE-16**: Update TTS server to use new fine-tuned model weights

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multiple XTTS worker instances | XTTS v2 batch_size=1 constraint; concurrent requests cause CUDA errors |
| Voice cloning on Piper fallback | Accept voice change on fallback; complexity not worth it for edge case |
| RAG-based context retrieval | Overkill for single-user homelab |
| Always-on Opus encoding | Adds 10-50ms latency with zero benefit on gigabit LAN |
| Web Worker audio decoding | AudioContext unavailable in Workers (W3C spec issue since 2013) |
| react-window | Inferior dynamic height support vs @tanstack/react-virtual |
| OpenTelemetry distributed tracing | performance.now() sufficient for homelab scale |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BACK-01 | Phase 21 | Done |
| PERF-01 | Phase 21 | Done |
| PERF-04 | Phase 21 | Done |
| OBS-02 | Phase 21 | Done |
| TTS-01 | Phase 22 | Pending |
| TTS-02 | Phase 22 | Pending |
| TTS-03 | Phase 22 | Pending |
| TTS-04 | Phase 22 | Pending |
| PERF-02 | Phase 23 | Pending |
| PERF-03 | Phase 23 | Pending |
| AUDIO-01 | Phase 23 | Pending |
| OBS-01 | Phase 24 | Pending |
| BACK-02 | Phase 24 | Pending |
| UI-01 | Phase 25 | Pending |

**Coverage:**
- v1.5 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements defined: 2026-01-27*
*Traceability updated: 2026-01-27*

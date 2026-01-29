# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-29)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Milestone v1.6 -- Smart Home Intelligence

## Current Position

Milestone: v1.6 Smart Home Intelligence
Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-01-29 — Milestone v1.6 started

Progress: [░░░░░░░░░░░░░░░░░░░░] 0% v1.6 (0/? phases)

## Performance Metrics

**Velocity (from v1.0-v1.5):**
- Total plans completed: 52
- Average duration: ~5 min
- Phases shipped: 25
- Milestones shipped: 6 (v1.0, v1.1, v1.2, v1.3, v1.4, v1.5)

## Accumulated Context

### Key Decisions (v1.6)

- Frigate NVR already deployed on agent1 (192.168.1.61:5000) with 2 cameras
- Camera recordings on NAS at //192.168.1.50/ExternalHDD/frigate/ (4.5TB, 30-day retention)
- Face recognition will use dual input: uploaded photos + camera-learned faces
- Unknown faces logged for later review (no immediate notifications)
- Presence timeline is full searchable history ("When did John leave yesterday?")
- Dashboard panel for faces + activity timeline (not just chat queries)
- No Home Assistant integration -- Frigate only
- Face database scoped for 5-10 household members
- CPU-based face recognition (no GPU available)

### Key Decisions (v1.5 - carried forward)

- Piper TTS deployed as fast fallback alongside XTTS (3-second timeout triggers Piper)
- XTTS v2 cannot parallelize (batch_size=1 "wontfix") -- CPU affinity is highest-impact optimization
- Bounded to max 2 concurrent TTS workers to avoid CPU starvation of LLM
- Conversation summarization must preserve structured context (VMIDs, IPs, paths)
- 3-second XTTS timeout balances quality vs latency; 30s recovery interval prevents hammering
- Gapless playback uses source.start(startAt) clock scheduling, not onended chaining
- @tanstack/react-virtual chosen over react-window for chat virtualization

### Key Decisions (v1.4 - carried forward)

- Streaming voice pipeline targets <4s first-audio
- Sentence boundaries detected during LLM streaming, TTS per-sentence
- Audio delivered as Socket.IO binary events (not WebRTC)
- Shared Proxmox API cache with TTL (5s nodes, 15s storage)
- React.memo for NodeCard, VMCard, ChatMessage, EventRow
- All hardcoded colors replaced with theme tokens

Previous milestones:
- v1.0 MVP (Phases 1-6): Full dashboard + AI + monitoring + safety
- v1.1 Hybrid Intelligence (Phases 7-10): Hybrid LLM, memory, Docker, testing
- v1.2 JARVIS Voice (Phase 11): TTS/STT with XTTS v2, ElevenLabs, OpenAI
- v1.3 File Ops & Intelligence (Phases 12-15): File ops, project tools, code analysis, voice retraining
- v1.4 Performance & Reliability (Phases 16-20): Streaming voice, chat rendering, backend caching, dashboard perf, theme polish
- v1.5 Optimization & Latency Reduction (Phases 21-25): TTS fallback, parallel synthesis, Opus codec, context management, chat virtualization

### Pending Todos

- None for v1.6 yet

### Blockers/Concerns

- CPU contention risk: Home node (20 threads) shared between llama-server, XTTS, Piper, and potentially face recognition
- Face recognition library selection -- need CPU-efficient option (face-api.js, deepface, or insightface)
- Frigate API authentication -- need to verify if Frigate requires auth or is open on LAN
- Camera credential security -- RTSP credentials in config need protection

## Session Continuity

Last session: 2026-01-29
Stopped at: Milestone v1.6 started, ready for research
Resume file: None

**Next steps:**
1. Research domain ecosystem for face recognition, camera integration, presence tracking
2. Define requirements
3. Create roadmap with phases

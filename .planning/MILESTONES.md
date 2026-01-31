# Project Milestones: Jarvis 3.1

## v1.0 MVP (Shipped: 2026-01-26)

**Delivered:** AI-operated Proxmox cluster command center with eDEX-UI dashboard, Claude-powered tool execution, autonomous monitoring and remediation, and live HUD data pipeline.

**Phases completed:** 1-4, 6 (18 plans total)

**Key accomplishments:**
- Express 5 backend with 18 MCP tools, 4-tier safety framework (GREEN/YELLOW/RED/BLACK), and SQLite persistence via Drizzle ORM
- eDEX-UI / Iron Man JARVIS dashboard with wireframe globe HUD, RadialDataRing, 5 colorway themes, 3-column layout with live cluster monitoring
- Claude API integration with agentic tool-calling loop, streaming responses, JARVIS personality, and interactive AUTHORIZE/DENY confirmation UX
- Autonomous monitoring with threshold-based alerts, runbook-driven remediation, kill switch with blast radius control, and email escalation
- Full HUD & Feed data pipeline -- temperature flows to NodeCards, ActivityFeed seeded with event history, chat tool events in feed, health heartbeat and storage capacity alerts

**Stats:**
- 93 source files created
- 10,798 lines of TypeScript/TSX/CSS
- 5 phases, 18 plans
- 75 commits in 1 day
- Git range: `feat(01-01)` → `docs(06-02)`

**What's next:** v1.1 Hybrid Intelligence & Deployment

---

## v1.1 Hybrid Intelligence & Deployment (Shipped: 2026-01-26)

**Delivered:** Hybrid LLM routing (Claude + Qwen), persistent memory with tiered TTLs, Docker deployment, and E2E testing infrastructure.

**Phases completed:** 7-10 (10 plans total)

**Key accomplishments:**
- Intent-based LLM routing engine with Claude for complex reasoning, local Qwen for routine ops (60-85% cost savings)
- Cost tracking with token persistence, daily budget enforcement ($10/day default), and provider badges in UI
- 3-tier persistent memory (conversation 7d, episodic 30d, semantic permanent) with context injection and recall
- Full-stack Docker Compose deployment with Nginx reverse proxy and WebSocket support
- 64 unit tests across 5 test files (router, safety, cost, memory extraction, memory recall)

**Stats:**
- Phases 7-10 (10 plans)
- 55 requirements mapped
- Git commits: 464b01c → affbaeb

---

## v1.2 JARVIS Voice & Personality (Shipped: 2026-01-26)

**Delivered:** Text-to-speech with custom JARVIS voice (XTTS v2 local + ElevenLabs + OpenAI TTS), speech-to-text with wake word, audio visualization, and voice-aware personality tuning.

**Phases completed:** 11 (4 plans)

**Key accomplishments:**
- Local XTTS v2 voice cloning with 10 reference audio clips from Iron Man movies
- GPT decoder fine-tuning (6 epochs, 441M trainable params, loss 6.62→5.90)
- Pre-computed speaker embeddings for faster inference
- ElevenLabs "Daniel" voice as cloud fallback
- Speech-to-text with microphone input and wake word detection
- Audio visualizer (waveform bars) in HUD during playback
- Voice settings panel with speed/voice selection
- Voice-aware personality (responses <100 words when spoken)

**Stats:**
- Phase 11 (4 plans)
- 12 requirements (VOICE-01 through VOICE-12)
- Git commits: 0271364 → 9ac79b2
- TTS service: Docker container at /opt/jarvis-tts (port 5050)

**What's next:** v1.3 File Operations & Project Intelligence

---

## v1.3 File Operations & Project Intelligence (Shipped)

**Delivered:** File download/transfer/listing tools across cluster nodes, project browsing/reading/searching/analysis from 24-project registry, code analysis with multi-turn discussion.

**Phases completed:** 12-14 (8 plans total)

**Key accomplishments:**
- File operations: download from URL with SSRF protection, copy between directories, SSH transfer between nodes
- Path sanitization infrastructure: traversal prevention, symlink resolution, disk space checks
- Project intelligence: browse, read, search across 24 indexed projects via registry on agent1
- Secret blocking: 28 filenames + 13 patterns + 8 path segments blocked from reads
- Code analysis: 6-section context gathering with prompt injection defense
- Multi-turn project discussion via system prompt guidance
- Total MCP tools: 28 (23 existing + 4 project + 1 analysis)
- Zero new npm dependencies -- Node.js 22 built-ins only

**Stats:**
- Phases 12-14 (8 plans)
- 18 requirements (FILE-01 to FILE-07, PROJ-01 to PROJ-07, VOICE-13 to VOICE-16)
- Git commits: 07139ca → 4a24f95

---

## v1.4 Performance & Reliability (Shipped)

**Delivered:** TTS reliability with Piper fallback, quick wins baseline improvements.

**Phases completed:** 21-22

**Key accomplishments:**
- Piper TTS fallback for faster local synthesis
- Quick wins baseline improvements

---

## v1.5 Observability & Context (Shipped)

**Delivered:** Chat virtualization, pipeline timing, context management.

**Phases completed:** 23-25

**Key accomplishments:**
- Chat virtualization with react-window for performance
- Pipeline timing and context integration
- ContextManager replacing slice-based history

---

## v1.6 Smart Home Intelligence (In Progress)

**Target:** Give JARVIS eyes -- camera face recognition, presence tracking, and proactive alerts.

**Phases:** 26-29 (8 plans total)

**Planned capabilities:**
- Frigate face recognition integration (`model_size: small` for CPU)
- "Who's at the door?" MCP tool with face-identified responses
- Enhanced presence detection combining network + camera + face signals
- Presence history tracking with arrival/departure logs
- Camera dashboard with snapshot grid and event list
- Live camera view via MSE/go2rtc streaming
- Proactive alerts for unknown persons at entry cameras
- Optional TTS announcements for security events

**Requirements:** 20 (FACE-01 to FACE-05, PRES-01 to PRES-05, CAM-01 to CAM-05, ALERT-01 to ALERT-05)

**Key decisions:**
- Use Frigate native face recognition (not custom ML)
- HTTP polling for events (5s interval), MQTT deferred to v1.7
- SQLite for presence logs (extends existing schema)
- MSE streaming via go2rtc for live view

**What's next:** Phase 26 - Face Recognition Foundation

---

## v1.7 Web Browsing & Video Playback (Shipped: 2026-01-30)

**Delivered:** Web search via SearXNG, inline webpage display, YouTube search and playback, direct video support.

**Phase completed:** 32 (6 plans consolidated into single execution)

**Key accomplishments:**
- SearXNG Docker container for privacy-focused web search (aggregates multiple engines)
- 7 new MCP tools: web_search, fetch_webpage, open_url, search_youtube, play_youtube, play_video, open_in_browser
- 3 new UI components: SearchResultsCard, InlineWebCard, InlineVideoCard
- YouTube privacy mode (youtube-nocookie.com embed)
- SSRF protection blocking private IPs
- Escape key to close inline content
- Updated system prompt with web capabilities

**Stats:**
- Phase 32 (6 plans executed in single session)
- 7 new MCP tools
- 3 new UI components
- 1 new Docker service
- ~800 lines of TypeScript

**What's next:** TBD

---

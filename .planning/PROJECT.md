# Jarvis 3.1 -- Proxmox Cluster AI Control & Dashboard

## What This Is

A self-hosted AI command center for a 4-node Proxmox VE homelab cluster. Jarvis 3.1 combines a futuristic eDEX-UI / Iron Man JARVIS-inspired dashboard with a tool-enabled LLM that can monitor, diagnose, and autonomously fix infrastructure problems. It replaces scattered management tools with a single visual control plane where the AI has its own screen presence and personality.

## Core Value

The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.

## Requirements

### Validated

- Proxmox cluster operational (4 nodes, quorum 3)
- Local LLM inference working (Qwen 2.5 7B via llama-server + RPC)
- Shell execution capability (existing Jarvis shell agent)
- Management VM running (192.168.1.65 with Docker, 16 containers)
- Email notification system (agent1, Gmail integration)
- Cluster monitoring agents (advisor, file-organizer)
- SSH key-based access to all nodes
- PVE firewall enabled cluster-wide
- Samba/NFS storage shares operational
- Wake-on-LAN for all nodes
- eDEX-UI / Iron Man style dashboard with 3-column layout -- v1.0
- Live Proxmox cluster status (nodes, VMs, containers, resources) -- v1.0
- Jarvis activity panel (status, feed, chat interface) -- v1.0
- System terminal panel (eDEX-style command input) -- v1.0
- MCP tool server exposing Proxmox API, system commands, Docker management -- v1.0 (18 tools, 4-tier safety)
- JARVIS personality (Iron Man -- witty, formal, British butler humor) -- v1.0
- Autonomous monitoring and remediation (act + report) -- v1.0 (runbooks, kill switch, email escalation)
- Real-time data updates via WebSocket -- v1.0 (Socket.IO 4 namespaces)
- Multi-device responsive (dedicated display, desktop, mobile) -- v1.0
- HUD temperature data pipeline -- v1.0 (backend emitter to NodeCard display)
- ActivityFeed event history seeding -- v1.0 (DB events fetched on page load)
- Health heartbeat and storage alerts -- v1.0 (5-min heartbeat, 30-min storage check)
- Hybrid LLM backend (Claude + Qwen routing with cost tracking) -- v1.1
- Persistent memory system with tiered TTLs -- v1.1
- Docker deployment to management VM -- v1.1
- E2E testing infrastructure (64 unit tests) -- v1.1
- JARVIS voice engine (XTTS v2 + ElevenLabs + OpenAI TTS, STT, audio visualizer) -- v1.2
- Voice-aware personality tuning -- v1.2
- File operations (download, copy, transfer) with SSRF protection -- v1.3
- Project intelligence (browse, read, search, analyze 24 indexed projects) -- v1.3
- Code analysis with multi-turn discussion -- v1.3
- Streaming voice pipeline (<4s first audio) -- v1.4
- Chat rendering performance (RAF batching, memoization) -- v1.4
- Backend data caching (Proxmox API, system prompt, session history) -- v1.4
- Dashboard rendering performance (granular stores, idle optimization) -- v1.4
- Theme consistency (unified color tokens, glow standardization) -- v1.4
- TTS reliability 99%+ via Piper fallback -- v1.5
- Parallel TTS synthesis with disk-persistent cache -- v1.5
- Opus audio codec for smaller payloads -- v1.5
- Conversation sliding window with context summarization -- v1.5
- Latency tracing pipeline -- v1.5
- Chat virtualization for 100+ messages -- v1.5

### Active

- [ ] Server-side microphone capture with always-on listening -- v1.8
- [ ] Voice Activity Detection (VAD) filtering background noise -- v1.8
- [ ] "Jarvis" soft name-trigger for intent detection -- v1.8
- [ ] Server-side STT via Whisper (not browser Web Speech API) -- v1.8
- [ ] Physical audio output through speakers (USB/HDMI/BT) -- v1.8
- [ ] Full voice command pipeline: listen → transcribe → LLM → TTS → speak -- v1.8
- [ ] Cluster commands, general questions, smart home control via voice -- v1.8

### Out of Scope

- Predictive maintenance / anomaly detection -- future, needs data collection first
- Multi-user permissions -- single operator for now
- Mobile native app -- responsive web handles mobile
- Home Assistant integration -- not deployed yet, Frigate-only for now
- Multi-room mic deployment -- get single room working first, expand later
- Mobile voice interaction -- browser voice already works for this
- Custom wake word model training -- "Jarvis" name detection via STT is sufficient

## Current Milestone: v1.8 Always-On Voice Assistant

**Goal:** Transform Jarvis from a browser-only assistant into a physical, always-listening voice assistant. Server microphones capture speech, "Jarvis" name-trigger identifies intent, Whisper transcribes, LLM processes, and TTS responds through physical speakers. Full assistant for cluster ops, general knowledge, and smart home control.

**Target features:**
- Enable built-in laptop digital mics (Intel SOF firmware installed, needs reboot)
- Continuous audio capture service with Voice Activity Detection
- "Jarvis" soft name-trigger -- speech containing the name gets processed, background chatter ignored
- Server-side Whisper STT (existing Docker container on port 5051)
- Route transcribed text through existing hybrid LLM pipeline (Claude/Qwen)
- Physical audio output through speakers (research determines USB vs HDMI vs Bluetooth)
- Single room deployment first, architecture supports multi-room expansion

**Previous milestone (v1.7):** UI Polish & Camera Integration -- Phases 31-32 (Web UI redesign, web browsing, video playback)

## Current State (v1.7 shipped 2026-01-30)

- **Backend**: ~9,000+ LOC TypeScript -- Express 5, Socket.IO, MCP SDK, better-sqlite3, Drizzle ORM
- **Frontend**: ~7,000+ LOC TypeScript/TSX + CSS -- React 19, Vite 6, Tailwind v4, Zustand, xterm.js
- **Source files**: ~130+ across backend and frontend
- **Git commits**: 120+
- **Tech stack**: Node.js 22, React 19, Socket.IO 4, Claude API, Qwen 2.5 7B, SQLite, Docker
- **Deployment**: Home node (/root/jarvis-backend, /root/jarvis-ui)
- **Voice stack**: XTTS v2 (port 5050) + Piper fallback (port 5000) + Whisper STT (port 5051)
- **Smart home**: Frigate NVR on agent1, face recognition, presence tracking, camera dashboard, proactive alerts
- **Web**: SearXNG search, web browsing, YouTube playback

## Context

### Existing Infrastructure

| Node | IP | Role | CPUs | RAM |
|------|-----|------|------|-----|
| Home | 192.168.1.50 | Cluster master, llama-server, NFS/Samba, Jarvis backend | 20 | 24 GB |
| pve | 192.168.1.74 | Compute + NAS, Samba, FileBrowser | 6 | 31 GB |
| agent1 | 192.168.1.61 | Compute, Frigate NVR, email agent, cluster agents | 14 | 31 GB |
| agent | 192.168.1.62 | Lightweight utility | 2 | 4 GB |

### Camera Infrastructure (NEW for v1.6)

| Camera | Node | IP | Credentials |
|--------|------|-----|-------------|
| front_door | agent1 (Frigate) | 192.168.1.204:8554/ch1 | 223:602 |
| side_house | agent1 (Frigate) | 192.168.1.27:8554/ch1 | 619:681 |

**Frigate NVR:**
- Running on agent1 (192.168.1.61:5000)
- 8 CPU threads for detection
- Recording 24/7 to NAS (4.5TB at //192.168.1.50/ExternalHDD/frigate/)
- 30-day retention, 60-day for alerts/detections
- Objects tracked: person, car, dog, cat

### Existing Jarvis Components

- llama-server on Home (port 8080) -- OpenAI-compatible API
- Jarvis backend on Home (port 4000) -- Express + Socket.IO
- Jarvis frontend on Home (port 3004) -- React dashboard
- jarvis-tts on Home -- XTTS v2 + Piper fallback
- Open WebUI on management VM (port 3003) -- alternate chat interface
- Model: Qwen 2.5 7B Instruct Q4_K_M (4.4GB)

### Existing Monitoring

- Advisor agent: daily cluster health analysis, email reports
- File organizer agent: project registry across all nodes
- Uptime Kuma: service availability monitoring
- Prometheus + Grafana: metrics collection

## Constraints

- **Deployment**: Home node (192.168.1.50) -- Docker containers
- **LLM Local**: Qwen 2.5 7B on Home node -- ~27-52 tokens/sec generation
- **LLM Cloud**: Claude API -- requires internet, usage-based cost
- **Network**: Flat 192.168.1.0/24 LAN, no VLANs, all inter-node via SSH
- **Storage**: 4.5TB NAS for camera recordings, SQLite for face data
- **Security**: PVE firewall enabled, key-only SSH, all traffic LAN-only
- **Face Recognition**: CPU-based (no GPU), must handle 5-10 faces efficiently
- **Audio Hardware**: Intel Raptor Lake HDA with SOF firmware (digital mics), NVidia HDMI (output only)
- **Voice Processing**: All CPU-based, Whisper medium.en model, XTTS v2 on GPU (RTX 4050)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid LLM (Claude + Qwen) | Claude for complex reasoning, Qwen for fast routine ops | ✓ Good |
| MCP protocol for tool layer | Standard protocol, works with Claude natively, extensible | ✓ Good |
| Iron Man JARVIS personality | User's core vision -- not just functional, experiential | ✓ Good |
| React + TypeScript frontend | Existing scaffold, rich ecosystem for complex UI | ✓ Good |
| SQLite + markdown for memory | SQLite for structured events, markdown for LLM context injection | ✓ Good |
| Modular monolith architecture | Single Node.js process, clean modules, no microservices | ✓ Good |
| Piper TTS fallback | 99%+ reliability, <500ms synthesis when XTTS slow | ✓ Good |
| Frigate for NVR | Already deployed, HTTP API, object detection built-in | ✓ Good |
| Face embeddings in SQLite | Simple, no new database, vector similarity via cosine | ✓ Good |
| SOF firmware for built-in mics | Intel Raptor Lake laptop has digital mic array | — Pending |
| "Jarvis" soft name-trigger | STT + name detection vs dedicated wake word engine | — Pending |
| Physical speaker output | USB vs HDMI vs Bluetooth -- research will decide | — Pending |

---
*Last updated: 2026-02-25 after v1.8 milestone started*

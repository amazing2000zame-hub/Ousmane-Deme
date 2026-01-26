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

### Active

- [ ] Hybrid LLM backend (Claude API for complex tasks, local Qwen for routine ops) -- Phase 5: Qwen routing, unified abstraction, cost tracking
- [ ] Persistent memory system with tiered TTLs (cluster state, actions, preferences, history) -- Phase 5: TTLs, consolidation, context management
- [ ] Docker deployment to management VM (192.168.1.65) -- code complete, needs containerization and deployment
- [ ] End-to-end testing against live cluster -- validate all features work with real Proxmox API

### Validated

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

### Out of Scope

- Voice / text-to-speech -- deferred to future version
- Face / user recognition -- future feature
- Predictive maintenance / anomaly detection -- future, needs data collection first
- Multi-user permissions -- single operator for now
- Smart home integration -- Proxmox cluster focus only for v1
- Mobile native app -- responsive web handles mobile

## Current Milestone: v1.1 Hybrid Intelligence & Deployment

**Goal:** Add hybrid LLM intelligence (Claude + Qwen routing), persistent memory with tiered TTLs, Docker deployment to management VM, and end-to-end testing against live cluster.

**Target features:**
- Hybrid LLM backend -- unified abstraction routing complex tasks to Claude API, routine ops to local Qwen, with cost tracking and fallback
- Persistent memory system -- tiered TTLs for cluster state, actions, preferences, and conversation history with context consolidation
- Docker deployment -- containerize backend and frontend, deploy to management VM (192.168.1.65) with Docker Compose
- End-to-end testing -- validate all features against live Proxmox cluster API, including safety tiers and tool execution

## Current State (v1.0 shipped 2026-01-26)

- **Backend**: 6,196 LOC TypeScript -- Express 5, Socket.IO, MCP SDK, better-sqlite3, Drizzle ORM
- **Frontend**: 4,393 LOC TypeScript/TSX + 209 LOC CSS -- React 19, Vite 6, Tailwind v4, Zustand, xterm.js
- **Source files**: 93 across backend and frontend
- **Git commits**: 75
- **Tech stack**: Node.js 22, React 19, Socket.IO 4, Claude API, Qwen 2.5 7B, SQLite, Docker
- **Deployment**: Not yet deployed to management VM (code on Home node at /root/jarvis-backend and /root/jarvis-ui)

## Context

### Existing Infrastructure

| Node | IP | Role | CPUs | RAM |
|------|-----|------|------|-----|
| Home | 192.168.1.50 | Cluster master, llama-server, NFS/Samba | 20 | 24 GB |
| pve | 192.168.1.74 | Compute + NAS, Samba, FileBrowser | 6 | 31 GB |
| agent1 | 192.168.1.61 | Compute, Jarvis RPC, email agent, cluster agents | 14 | 31 GB |
| agent | 192.168.1.62 | Lightweight utility | 2 | 4 GB |

**Management VM (192.168.1.65)** on agent1: Docker host running Homepage, Guacamole, Portainer, Uptime Kuma, Grafana, Prometheus, Nginx Proxy Manager, code-server, and more. This is where Jarvis 3.1 will be deployed.

### Existing Jarvis v3.0

- llama-server on Home (port 8080) -- OpenAI-compatible API
- rpc-server on agent1 (port 50052) -- distributed compute backend
- Open WebUI on management VM (port 3003) -- current chat interface
- Shell agent (CLI + Open WebUI function) -- executes commands on cluster nodes
- Model: Qwen 2.5 7B Instruct Q4_K_M (4.4GB)

### Existing UI Scaffold

- `jarvis-ui/` directory on Home node with React + Vite + TypeScript setup
- Has `useJarvisChat.ts` hook and `jarvisApi.ts` service stub

### Existing Monitoring

- Advisor agent: daily cluster health analysis, email reports
- File organizer agent: project registry across all nodes
- Uptime Kuma: service availability monitoring
- Prometheus + Grafana: metrics collection

## Constraints

- **Deployment**: Management VM (192.168.1.65) -- Docker containers, 8GB RAM allocated
- **LLM Local**: Qwen 2.5 7B on Home node -- ~6.5 tokens/sec generation, 4096 context
- **LLM Cloud**: Claude API -- requires internet, usage-based cost
- **Network**: Flat 192.168.1.0/24 LAN, no VLANs, all inter-node via SSH
- **Storage**: Proxmox API for cluster data, SSH for node-level commands
- **Security**: PVE firewall enabled, key-only SSH, all traffic LAN-only
- **Frontend**: React + TypeScript (existing scaffold in jarvis-ui/)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid LLM (Claude + Qwen) | Claude for complex reasoning, Qwen for fast routine ops | Confirmed -- Claude-only in Phase 3, hybrid in Phase 5 |
| MCP protocol for tool layer | Standard protocol, works with Claude natively, extensible | Confirmed -- MCP SDK v1.25+ with Express middleware |
| Management VM deployment | Already the management hub, Docker ready, good resource balance | Confirmed -- 2 containers (frontend Nginx + backend Node.js) |
| Iron Man JARVIS personality | User's core vision -- not just functional, experiential | Confirmed -- eDEX-UI aesthetic, 3 visual modes |
| React + TypeScript frontend | Existing scaffold, rich ecosystem for complex UI | Confirmed -- React 19 + Vite 6 + Tailwind v4 |
| SQLite + markdown for memory | SQLite for structured events, markdown for LLM context injection | Confirmed -- better-sqlite3 + Drizzle ORM |
| Act + report autonomy model | Fix problems automatically, report after -- availability first | Confirmed -- 5-level autonomy model with runbooks |
| Text-only for v1 | TTS deferred, focus on core dashboard + AI actions | Confirmed |
| Express 5 backend | MCP SDK has official Express middleware adapter | Confirmed -- Phase 1 |
| Modular monolith architecture | Single Node.js process, 6 clean modules, no microservices | Confirmed -- research HIGH confidence |
| Safety-first Phase 1 | CRITICAL pitfalls must be architectural, not retrofitted | Confirmed -- dependency DAG + command allowlist |

---
*Last updated: 2026-01-26 after v1.1 milestone started*

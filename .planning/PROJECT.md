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

- [ ] eDEX-UI / Iron Man style dashboard with 3-column layout
- [ ] Live Proxmox cluster status (nodes, VMs, containers, resources)
- [ ] Jarvis activity panel (status, feed, chat interface)
- [ ] System terminal panel (eDEX-style command input)
- [ ] MCP tool server exposing Proxmox API, system commands, Docker management
- [ ] Hybrid LLM backend (Claude API for complex tasks, local Qwen for routine ops)
- [ ] JARVIS personality (Iron Man -- witty, formal, British butler humor)
- [ ] Autonomous monitoring and remediation (act + report)
- [ ] Persistent memory system (cluster state, actions, preferences, history)
- [ ] Real-time data updates via WebSocket
- [ ] Multi-device responsive (dedicated display, desktop, mobile)

### Out of Scope

- Voice / text-to-speech -- deferred to future version
- Face / user recognition -- future feature
- Predictive maintenance / anomaly detection -- future, needs data collection first
- Multi-user permissions -- single operator for now
- Smart home integration -- Proxmox cluster focus only for v1
- Mobile native app -- responsive web handles mobile

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
| Hybrid LLM (Claude + Qwen) | Claude for complex reasoning, Qwen for fast routine ops | -- Pending |
| MCP protocol for tool layer | Standard protocol, works with Claude natively, extensible | -- Pending |
| Management VM deployment | Already the management hub, Docker ready, good resource balance | -- Pending |
| Iron Man JARVIS personality | User's core vision -- not just functional, experiential | -- Pending |
| React + TypeScript frontend | Existing scaffold, rich ecosystem for complex UI | -- Pending |
| SQLite + markdown for memory | SQLite for structured events, markdown for LLM context injection | -- Pending |
| Act + report autonomy model | Fix problems automatically, report after -- availability first | -- Pending |
| Text-only for v1 | TTS deferred, focus on core dashboard + AI actions | -- Pending |

---
*Last updated: 2026-01-26 after initialization*

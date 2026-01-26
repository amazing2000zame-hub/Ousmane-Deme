# Feature Landscape

**Domain:** AI-powered infrastructure management dashboard (Proxmox homelab)
**Project:** Jarvis 3.1
**Researched:** 2026-01-26

---

## Table Stakes

Features users expect from an infrastructure dashboard with AI assistant. Missing any of these and the product feels broken or incomplete.

### Dashboard / Monitoring

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Node health overview (CPU, RAM, disk, uptime) | Every monitoring tool shows this. Users need cluster-at-a-glance. | Low | Proxmox API provides all via `/nodes`. Poll every 5-10s via WebSocket. |
| VM/Container list with status | Core of any Proxmox dashboard. Must show running/stopped, resource usage per guest. | Low | `/cluster/resources` endpoint. Color-code by status. |
| Real-time updates (WebSocket) | Static dashboards feel dead. Users expect live-updating metrics without page refresh. | Medium | WebSocket push from backend polling PVE API. 2-5s intervals for nodes, 10s for VMs. |
| VM/CT start/stop/restart controls | If you can see it, you should be able to act on it. Read-only dashboards frustrate. | Low | PVE API `POST /nodes/{node}/qemu/{vmid}/status/{action}`. Already in existing proxmox.ts service. |
| Storage overview | Disk full = cluster down. Must show all storage pools with usage percentages. | Low | `/nodes/{node}/storage` and `/storage`. Show capacity bars with color thresholds. |
| System terminal | Power users need shell access. eDEX-UI style terminal is core to the JARVIS aesthetic. | Medium | Already scaffolded via xterm.js + WebSocket PTY. Needs polish, not invention. |
| Cluster quorum status | Quorum loss = can't manage anything. Must be prominently visible. | Low | `pvecm status` output or API equivalent. Show votes and expected votes. |
| Temperature monitoring | Hardware damage prevention. Users expect to see thermals on bare-metal systems. | Low | Read `/sys/class/thermal/thermal_zone*/temp` via SSH. Already in proxmox.ts. |

### AI Assistant

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Natural language chat interface | This is an AI dashboard. Text input to ask questions / give commands is fundamental. | Medium | Chat panel with message history. Send to LLM backend, stream response. |
| Cluster status queries ("How's the cluster?") | Most basic AI use case. Ask questions, get answers about infrastructure state. | Medium | LLM calls MCP tools to gather data, synthesizes response. Requires tool calling. |
| VM/CT management via chat ("Start VM 100") | If the UI can do it, the AI should be able to do it too. | Medium | MCP tools for PVE lifecycle operations. Requires action confirmation UX. |
| Error explanation ("Why is node X offline?") | AI value-add over raw dashboards. Should correlate data and explain. | Medium | LLM reads node status, recent logs, and provides diagnosis. |
| JARVIS personality (formal, British, witty) | Core user requirement. This is the product identity, not a nice-to-have. | Low | System prompt engineering. Test with both Claude and Qwen. Personality must be consistent. |
| Streaming responses | Users expect to see text appearing as the AI generates. Waiting for full response feels broken. | Medium | Server-sent events or WebSocket streaming from LLM endpoint. |

### Alerting / Notifications

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Node down detection | If a node goes offline, the user must know immediately. | Low | Poll node status. If unreachable for 2+ checks, alert. |
| Visual alert indicators (dashboard) | Problems must be visually obvious without reading text. Red/amber/green status. | Low | Color coding on node cards. Pulsing/glowing for active issues (fits JARVIS aesthetic). |
| Basic threshold alerts (disk >90%, RAM >95%) | Common pitfalls that cause outages if unnoticed. | Medium | Configurable thresholds. Check on each poll cycle. |

---

## Differentiators

Features that set Jarvis 3.1 apart from Pulse, Grafana, Homepage, and generic Proxmox dashboards. These are the reason to build this instead of using existing tools.

### Dashboard / Monitoring

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| eDEX-UI / Iron Man HUD aesthetic | No other Proxmox tool looks like this. Amber/gold on dark, sci-fi grid patterns, glowing edges. This is the visual identity. | High | Custom CSS/Canvas/WebGL. Animated transitions. This is where most UI effort goes. |
| 3-column command center layout | Purpose-built layout: Left=infrastructure, Center=Jarvis, Right=terminal. Not a generic dashboard grid. | Medium | Fixed layout, not widget-based. Opinionated design, faster to build than flexible grid. |
| Jarvis activity feed | No other tool has a live AI activity log showing what the assistant is doing, thinking, and fixing. | Medium | Event stream panel showing timestamped Jarvis actions. "Detected node pve elevated CPU...", "Running diagnostic...", "Restarted service X." |
| Unified data + AI + terminal | Three tools in one: monitoring dashboard, AI assistant, and SSH terminal. No alt-tabbing between Pulse + ChatGPT + PuTTY. | High | Integration complexity. Each panel must work independently and together. |

### AI Assistant

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hybrid LLM (Claude + local Qwen) | Claude for complex reasoning/planning, Qwen for fast routine queries. Best of both worlds -- smart when needed, fast and free when possible. | High | Router logic to decide which LLM handles each request. Cost management. Fallback when Claude unavailable. |
| MCP tool server for infrastructure ops | Standard protocol for tool use. Claude speaks MCP natively. Extensible -- add Docker, Samba, backup tools later. | High | Custom MCP server implementation. Must cover: PVE lifecycle, node health, storage, Docker, SSH exec. |
| Autonomous monitoring + remediation | Jarvis fixes problems without being asked. Node down? Restart. Service crashed? Recover. Then report what happened. This is the "availability > everything" philosophy. | Very High | Background monitoring loop. Predefined runbooks for common issues. Act first, report after. Requires safety guardrails. |
| Persistent memory system | Jarvis remembers past conversations, actions taken, cluster preferences, and operational history. Context persists across sessions. | High | SQLite for structured events + markdown/vector for LLM context injection. Memory retrieval at query time. |
| Context-aware responses | Jarvis knows the cluster topology, which VMs matter, storage layout, and recent issues without being told every time. | Medium | Inject cluster context into system prompt. Update on schedule. Use CLAUDE.md-style context documents. |
| Action confirmation UX | For destructive operations (stop VM, reboot node), show what will happen and get confirmation. Non-destructive ops execute immediately. | Medium | Tiered safety: read-only (auto), lifecycle (confirm), destructive (double-confirm). Visual confirmation cards in chat. |

### Alerting / Notifications

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI-powered alert analysis | Jarvis doesn't just say "disk full" -- it says "Disk on pve at 92%. Based on growth rate, you have ~3 days. I recommend cleaning backup snapshots older than 7 days. Want me to do that?" | High | LLM analyzes alert context, provides diagnosis and recommendation. May auto-remediate. |
| Email reports with AI narrative | Daily/weekly email summarizing cluster health, actions taken, issues resolved, upcoming concerns. Written in JARVIS voice. | Medium | Already have email agent on agent1. Generate HTML email via LLM, send via existing infrastructure. |
| Severity-tiered notification channels | Critical: dashboard flash + email. Warning: activity feed + optional email. Info: activity feed only. | Medium | Graduated thresholds. Match notification channel to severity. Prevents alert fatigue. |

### Memory / Context

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Action audit log | Every action Jarvis takes is logged with timestamp, reason, result, and rollback instructions. Full accountability. | Medium | SQLite table: action_id, timestamp, tool_called, parameters, result, success. Queryable via chat and API. |
| Cluster state snapshots | Periodic snapshots of full cluster state. Enables "what changed since yesterday?" queries and drift detection. | Medium | Cron-style state capture. Diff comparison. Feed into LLM context for trend analysis. |
| Preference learning | Jarvis learns operator preferences: "Always email me about node outages", "Don't wake me for disk warnings under 85%". | High | Preference store with natural language extraction. Complex to get right -- defer to post-MVP. |

---

## Anti-Features

Features to explicitly NOT build in v1. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Grafana-style metric graphing with time series | Already have Grafana + Prometheus running. Reimplementing time-series graphing is massive effort for inferior result. | Show current-state gauges/bars. Link out to Grafana for historical deep-dives. |
| Widget-based configurable dashboard grid | Flexibility = complexity. Drag-and-drop widget layouts take months to build well. The JARVIS identity IS the fixed layout. | Fixed 3-column layout. Opinionated. If users want customizable grids, they have Grafana/Homepage. |
| Multi-user RBAC / permissions | Single operator system. Building user management, roles, and permissions is enterprise overhead with no value for a homelab. | Single-user auth (JWT). Assume operator has full access. Add multi-user if ever needed later. |
| Voice input/output (TTS/STT) | Explicitly deferred in PROJECT.md. Voice is a separate product dimension. Adding it now splits focus from dashboard + AI core. | Text-only for v1. Voice is a natural v2 milestone. |
| Smart home integration | Scrypted, Home Assistant, Ring -- all separate systems. Integrating them adds scope with no infrastructure management value. | Proxmox cluster only. Smart home is a future version. |
| Mobile native app | Responsive web handles mobile. Building a native app is months of work for marginal benefit on a homelab. | Responsive CSS with mobile breakpoints. PWA if needed. |
| Predictive maintenance / anomaly detection | Requires weeks of data collection before any model is useful. Building ML pipelines is a rabbit hole. | Start with threshold-based alerts. Collect data from day one. Add prediction when data exists. |
| Log aggregation and search | Loki/Elasticsearch is massive infrastructure. Not core to the JARVIS value prop. | Show recent errors (last 20 lines of journalctl). Link to external log tools if deployed. |
| Backup management UI | Managing backup schedules, retention, and restore is complex. PBS and vzdump already handle this. | Show backup status (last success/failure, next scheduled). Don't manage backup config through Jarvis. |
| Full Proxmox UI replacement | PVE web UI is comprehensive. Trying to replicate all its features is years of work. | Complement PVE UI, don't replace it. Cover the 80% daily operations. Link to PVE UI for advanced config. |

---

## Feature Dependencies

```
Foundation Layer (must exist first):
  Backend API + WebSocket server
  Proxmox API integration (node/VM/CT data)
  Authentication (JWT)
    |
    v
Dashboard Layer (visual, no AI needed):
  Node health grid
  VM/Container list
  Storage overview
  System terminal (xterm.js)
  Real-time updates (WebSocket push)
    |
    v
AI Layer (requires dashboard data flowing):
  Chat interface (UI panel)
  LLM integration (Claude API + local Qwen)
  MCP tool server (wraps Proxmox API for LLM)
  JARVIS personality (system prompt)
  Streaming responses
    |
    v
Autonomy Layer (requires AI + tools working):
  Background monitoring loop
  Threshold-based alerting
  Auto-remediation runbooks
  Activity feed (shows AI actions)
  Action audit log
    |
    v
Intelligence Layer (requires autonomy + data history):
  Persistent memory (SQLite + context injection)
  AI-powered alert analysis
  Cluster state snapshots / drift detection
  Email reports with AI narrative
  Hybrid LLM routing (Claude vs Qwen)
```

### Critical Path Dependencies

| Feature | Hard Dependencies | Soft Dependencies |
|---------|-------------------|-------------------|
| Chat interface | LLM backend, WebSocket | Dashboard data (for context) |
| MCP tool server | Proxmox API integration | None |
| VM start/stop via chat | MCP tool server, Chat interface, Action confirmation UX | Audit log |
| Autonomous remediation | MCP tools, Background monitor, Alerting | Audit log, Email reports |
| Hybrid LLM routing | Both Claude + Qwen backends working | Cost tracking |
| Persistent memory | SQLite setup, Context injection into LLM | Action audit log (provides data) |
| AI alert analysis | Alerting system, LLM integration | Memory (for pattern recognition) |
| eDEX-UI aesthetic | React scaffold, CSS framework | None (can style incrementally) |

---

## MVP Recommendation

### Phase 1: Dashboard Foundation (build this first)

Prioritize these table stakes -- they deliver value even without AI:

1. **Node health grid** -- CPU, RAM, disk, temperature, uptime for all 4 nodes
2. **VM/Container list** -- Status, resource usage, start/stop controls
3. **Storage overview** -- All pools with usage bars
4. **System terminal** -- eDEX-UI styled xterm.js terminal
5. **Real-time WebSocket updates** -- Live data, no page refresh
6. **eDEX-UI visual styling** -- The Iron Man aesthetic from day one (builds momentum and identity)

**Rationale:** A working dashboard is immediately useful and testable. Every feature above is API-call-to-UI with no AI complexity. This validates the visual identity and data pipeline before adding LLM complexity.

### Phase 2: AI Assistant Core (add intelligence)

7. **Chat interface panel** -- Text input, message history, streaming responses
8. **LLM integration** -- Start with Claude API only (simpler, smarter, validates tool use)
9. **MCP tool server** -- Proxmox operations exposed as MCP tools
10. **JARVIS personality** -- System prompt, consistent voice in responses
11. **Action confirmation UX** -- Tiered safety for destructive operations
12. **Cluster context injection** -- Auto-inject cluster topology into system prompt

**Rationale:** Claude API is simpler to integrate than local Qwen (no router needed yet). MCP is Claude's native tool protocol. Get the AI working end-to-end with one LLM before adding hybrid routing.

### Phase 3: Autonomous Operations (add agency)

13. **Background monitoring loop** -- Periodic health checks independent of user
14. **Threshold-based alerting** -- Configurable alert rules
15. **Activity feed** -- Live panel showing Jarvis observations and actions
16. **Auto-remediation runbooks** -- Predefined responses to common issues
17. **Action audit log** -- SQLite-backed action history
18. **Email reports** -- Daily/weekly AI-narrated cluster summaries

**Rationale:** Autonomy requires working AI + tools. This is where Jarvis becomes truly differentiated -- it doesn't just show you problems, it fixes them.

### Defer to Post-MVP

- **Hybrid LLM routing (Claude + Qwen):** Add after Claude-only works. Complexity of routing + fallback logic is significant.
- **Persistent memory system:** Add after audit log provides data to remember. Start with session-only memory.
- **Preference learning:** Complex NLP task. Defer until basic operations are proven.
- **AI-powered alert analysis with trend detection:** Needs data history first. Threshold alerts are sufficient for MVP.
- **Cluster state snapshots / drift detection:** Nice-to-have. Manual `pvecm status` covers this initially.

---

## MCP Tool Inventory (Recommended for Jarvis 3.1)

Based on research of existing Proxmox MCP servers (gilby125/mcp-proxmox, canvrno/ProxmoxMCP, kspr9/mcp-proxmox-extended, RekklesNA/ProxmoxMCP-Plus) and the specific cluster needs:

### Read-Only Tools (safe, no confirmation needed)

| Tool | Purpose | API Source |
|------|---------|------------|
| `get_nodes` | List all cluster nodes with status | `/nodes` |
| `get_node_status` | Detailed node metrics (CPU, RAM, uptime) | `/nodes/{node}/status` |
| `get_vms` | List all VMs across cluster | `/cluster/resources?type=vm` |
| `get_containers` | List all LXC containers | `/cluster/resources?type=container` |
| `get_storage` | Storage pools with usage | `/storage` + `/nodes/{node}/storage` |
| `get_cluster_status` | Quorum, votes, HA status | `pvecm status` |
| `get_node_temperature` | Thermal readings | SSH + `/sys/class/thermal/` |
| `get_recent_tasks` | Recent PVE task log | `/cluster/tasks` |
| `get_backups` | Backup job history and status | `/nodes/{node}/storage/{storage}/content` |

### Lifecycle Tools (require confirmation)

| Tool | Purpose | Safety Level |
|------|---------|-------------|
| `start_vm` | Start a stopped VM | Confirm |
| `stop_vm` | Graceful shutdown of VM | Confirm |
| `restart_vm` | Reboot a running VM | Confirm |
| `start_container` | Start a stopped LXC | Confirm |
| `stop_container` | Graceful shutdown of LXC | Confirm |
| `restart_container` | Reboot a running LXC | Confirm |

### System Tools (require double-confirmation or auto only)

| Tool | Purpose | Safety Level |
|------|---------|-------------|
| `execute_ssh` | Run shell command on a node | Double-confirm (user) / Auto (Jarvis remediation with runbook) |
| `reboot_node` | Reboot a cluster node | Double-confirm always |
| `wake_node` | Send Wake-on-LAN packet | Confirm |

### Future Tools (post-MVP)

| Tool | Purpose | When |
|------|---------|------|
| `create_vm` | Provision new VM | Post-MVP |
| `create_container` | Provision new LXC | Post-MVP |
| `migrate_vm` | Live migrate VM between nodes | Post-MVP |
| `create_snapshot` | Snapshot VM/CT | Post-MVP |
| `manage_docker` | Docker container lifecycle on management VM | Post-MVP |
| `manage_storage` | Add/remove storage pools | Post-MVP |

---

## Autonomy Model: Act + Report

Based on research into AI agent safety patterns and the project's "availability > correctness > data safety" philosophy:

### Autonomy Levels

| Level | Pattern | When | Examples |
|-------|---------|------|----------|
| **L0: Observe** | Monitor and log only | Default for informational items | CPU at 60%, all nodes healthy |
| **L1: Alert** | Detect + notify user | Approaching thresholds | Disk at 85%, RAM at 90% |
| **L2: Recommend** | Detect + suggest fix + wait | Non-urgent issues | "Backup storage growing. Recommend cleaning snapshots older than 14 days." |
| **L3: Act + Report** | Fix automatically, report after | Urgent, well-understood issues | Service crashed -> restart. Node unresponsive -> WOL. |
| **L4: Act Silently** | Fix and log only (no notification) | Routine self-healing | Connection retry, cache clear, temp spike self-resolved |

### Runbook-Based Remediation

Only L3/L4 actions should be runbook-based -- predefined, tested responses to known conditions:

| Condition | Runbook Action | Level |
|-----------|---------------|-------|
| VM/CT crashed (was running, now stopped) | Restart guest, wait 30s, verify | L3 |
| Node unreachable (was online, now no response) | Wait 60s, retry, send WOL, report | L3 |
| Service failed (systemd unit down) | `systemctl restart {unit}`, verify, report | L3 |
| Disk >90% | Alert user with cleanup recommendations | L2 |
| Disk >95% | Clean tmp/cache, alert user | L3 |
| High CPU sustained (>90% for 5min) | Log and alert (don't kill processes) | L1 |
| Backup failed | Retry once, alert user if still failing | L3 |

### Safety Guardrails

| Guardrail | Implementation |
|-----------|---------------|
| **Blocklist** | Never reboot Home node automatically (cluster master). Never delete VMs/data. Never modify firewall rules. |
| **Rate limiting** | Max 3 remediation attempts per issue per hour. Prevent restart loops. |
| **Blast radius** | Never act on >1 node simultaneously (quorum protection). |
| **Audit trail** | Every autonomous action logged: timestamp, condition, action, result, rollback available. |
| **Kill switch** | Global toggle to disable all autonomous actions. Visible on dashboard. |
| **Escalation** | After 3 failed remediations, stop trying and email user with full diagnostic. |

---

## Sources

### Dashboard / Monitoring
- [Pulse - Real-time Proxmox monitoring](https://github.com/rcourtman/Pulse) - PRIMARY reference for Proxmox-specific dashboard features
- [Proxmox Grafana Dashboard](https://grafana.com/grafana/dashboards/10048-proxmox/) - Community dashboard templates
- [Proxmox Monitoring - Netdata](https://www.netdata.cloud/monitoring-101/proxmox-monitoring/) - Metrics catalog
- [Top Proxmox Monitoring Tools](https://www.starwindsoftware.com/blog/proxmox-ve-reporting-monitoring-tools/) - Tool comparison
- [5 Things to Monitor on Homelab Network](https://www.virtualizationhowto.com/2025/10/5-things-you-should-be-monitoring-on-your-home-lab-network-but-probably-arent/) - Often-missed metrics
- [9 Dashboard Tools for Homelabs](https://itsfoss.com/homelab-dashboard/) - Landscape survey

### AI Assistant / MCP
- [gilby125/mcp-proxmox](https://github.com/gilby125/mcp-proxmox) - Most complete Proxmox MCP server (49 tools)
- [kspr9/mcp-proxmox-extended](https://github.com/kspr9/mcp-proxmox-extended) - Extended MCP with lifecycle control
- [RekklesNA/ProxmoxMCP-Plus](https://github.com/RekklesNA/ProxmoxMCP-Plus) - Enhanced MCP with OpenAPI
- [canvrno/ProxmoxMCP](https://github.com/canvrno/ProxmoxMCP) - Original Proxmox MCP
- [MCP Server Documentation](https://modelcontextprotocol.io/docs/develop/connect-local-servers) - Official MCP docs
- [Best MCP Servers 2026](https://www.builder.io/blog/best-mcp-servers-2026) - Ecosystem overview

### Safety / Autonomy
- [AI Agent Guardrails Framework - Galileo](https://galileo.ai/blog/ai-agent-guardrails-framework) - Multi-layered guardrails
- [Autonomous Enterprise Four Pillars](https://stackgen.com/blog/2026-forecast-the-autonomous-enterprise-and-the-four-pillars-of-platform-control/) - Golden paths, guardrails, safety nets
- [AI Guardrails - Obsidian Security](https://www.obsidiansecurity.com/blog/ai-guardrails) - Context-aware controls
- [5 Levels of AI Autonomy - Turian](https://www.turian.ai/blog/the-5-levels-of-ai-autonomy) - Autonomy level framework
- [Human-in-the-Loop Patterns - Zapier](https://zapier.com/blog/human-in-the-loop/) - HITL pattern catalog
- [HITL Best Practices - Permit.io](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) - Approval workflows
- [Agentic AI Safety - Skywork](https://skywork.ai/blog/agentic-ai-safety-best-practices-2025-enterprise/) - Enterprise guardrails

### Memory / Context
- [Memory for AI Agents - The New Stack](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/) - Memory architecture patterns
- [Context Engineering - OpenAI Cookbook](https://cookbook.openai.com/examples/agents_sdk/context_personalization) - State-based long-term memory
- [GAM Dual-Agent Memory - VentureBeat](https://venturebeat.com/ai/gam-takes-aim-at-context-rot-a-dual-agent-memory-architecture-that) - Context rot prevention
- [Google ADK Context-Aware Framework](https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/) - Reactive vs proactive recall

### Alerting
- [DevOps Alert Severity Levels - Google Cloud](https://cloud.google.com/blog/products/devops-sre/devops-best-practices-add-severity-levels-to-alerts) - Severity tiering
- [Alert Management Strategies](https://hyperping.com/blog/devops-alert-management) - Alert fatigue prevention
- [Monitoring 101: Alerting - Datadog](https://www.datadoghq.com/blog/monitoring-101-alerting/) - Symptom vs cause alerting
- [Grafana Alerting Best Practices](https://grafana.com/docs/grafana/latest/alerting/guides/best-practices/) - Alert configuration

### JARVIS-Inspired Projects
- [AI Desktop Automation Assistant](https://github.com/DawoodTouseef/JARVIS) - HUD + system monitoring
- [JARVIS Iron Man AI Assistant - Devpost](https://devpost.com/software/jarvis-iron-man-inspired-ai-personal-assistant) - React + voice + animated UI
- [Building AI Assistant Like Iron Man - Saxifrage](https://www.saxifrage.xyz/post/ai-assistant) - ReAct pattern + memory architecture

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Dashboard metrics (what to show) | HIGH | Multiple authoritative sources agree (Pulse, Grafana community, Netdata, ManageEngine). Well-established domain. |
| MCP tool inventory | HIGH | Reviewed 4 existing Proxmox MCP server implementations on GitHub. Clear consensus on tool set. |
| AI autonomy levels | MEDIUM | Frameworks exist (Turian 5-levels, Galileo guardrails) but real-world infrastructure auto-remediation is emerging, not proven at homelab scale. |
| Memory/context patterns | MEDIUM | Rapid evolution in 2025-2026. Google ADK, OpenAI Agents SDK, GAM all propose different approaches. For Jarvis's simpler needs (single-agent, single-user), SQLite + context injection is well-established. |
| Alert best practices | HIGH | Google SRE, Datadog, Grafana all publish detailed guidance. Well-proven patterns. |
| JARVIS aesthetic/UX | MEDIUM | Multiple JARVIS-inspired projects exist but none combine infrastructure management. UX patterns are aspirational, not battle-tested for this use case. |

---

*Feature landscape research: 2026-01-26*

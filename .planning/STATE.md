# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Phase 7 - Hybrid LLM Router + Cost Tracking

## Current Position

Milestone: v1.1 Hybrid Intelligence & Deployment
Phase: 7 of 10 (Hybrid LLM Router + Cost Tracking)
Plan: --
Status: Ready to plan
Last activity: 2026-01-26 -- v1.1 roadmap created

Progress: [██████░░░░░░░░░░░░░░] 60% (v1.0 complete, v1.1 starting)

## Performance Metrics

**Velocity (from v1.0):**
- Total plans completed: 18
- Average duration: 5.4 min
- Total execution time: 102 min

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4/4 | 22 min | 5.5 min |
| 02 | 6/6 | 32 min | 5.3 min |
| 03 | 3/3 | 19 min | 6.3 min |
| 04 | 3/3 | 23 min | 7.7 min |
| 06 | 2/2 | 6 min | 3.0 min |

**v1.1 Phases:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 07 | 0/? | -- | -- |
| 08 | 0/? | -- | -- |
| 09 | 0/? | -- | -- |
| 10 | 0/? | -- | -- |

## Accumulated Context

### Key Decisions (v1.1)

Full decision log in PROJECT.md. Key decisions for v1.1:

- Hybrid LLM (Claude + Qwen) -- Claude for complex reasoning, Qwen for fast routine ops
- SQLite (not Redis) for memory storage -- single-user, <1ms queries, no external service
- NO LLM gateway (LiteLLM, OpenRouter) -- two-provider system, abstraction in application code
- Phase ordering: Router → Memory → Docker → Testing (dependency-driven)
- Vitest (not Jest) for testing -- native ESM + TypeScript, 30-70% faster

Recent architectural decisions from v1.0:

- 4-tier safety framework (GREEN/YELLOW/RED/BLACK) with fail-safe BLACK default
- Socket.IO namespaces /cluster, /events, /chat, /terminal for data separation
- Dependency injection pattern for eventsNs across modules

### Pending Todos

None.

### Blockers/Concerns

- Proxmox API tokens (`root@pam!jarvis`) must be created manually on each PVE node before deployment
- Context window overflow on local LLM (4096 tokens, need separate minimal system prompt for Qwen)
- SQLite WAL files require proper SIGTERM handler in Docker (WAL checkpoint before shutdown)
- SSH keys must be mounted as volumes, NOT baked into Docker images

## Session Continuity

Last session: 2026-01-26
Stopped at: v1.1 roadmap created with 4 phases (7-10), all 43 requirements mapped
Resume file: None

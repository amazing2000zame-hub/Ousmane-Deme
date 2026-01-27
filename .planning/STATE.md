# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Milestone v1.3 -- Phase 12 complete, ready for Phase 13

## Current Position

Milestone: v1.3 File Operations & Project Intelligence
Phase: 12 of 15 (File Operations Foundation) -- COMPLETE
Plan: 3 of 3 complete (12-01, 12-02, 12-03 all shipped)
Status: Phase complete
Last activity: 2026-01-27 -- Completed 12-03-PLAN.md (file transfer/download tools)

Progress: [████████████████████] 100% Phase 12 (v1.0-v1.2 complete, Phase 12 shipped)

## Performance Metrics

**Velocity (from v1.0-v1.2):**
- Total plans completed: 34
- Average duration: 4.9 min
- Phases shipped: 12

## Accumulated Context

### Key Decisions (v1.3)

- File operations use SSH to remote nodes (not file agents on each node)
- Project intelligence queries existing registry on agent1 (not a new index)
- Code analysis uses Claude via existing agentic loop (not AST parsing)
- Voice training orchestrates existing TTS container scripts via docker exec
- Zero new npm dependencies -- Node.js 22 built-ins handle all requirements
- AsyncLocalStorage with module-level fallback for backward-compatible override context
- Safety audit logs use existing events table (type: action, severity: warning)
- URL validation resolves DNS before checking IP to catch hostname-based SSRF
- Protected path matching: trailing slash = directory subtree, no slash = exact file
- Tree-view output as plain text (not JSON) so Claude presents directory listings naturally
- Noise file filtering: .DS_Store, Thumbs.db, AppleDouble files always excluded from listings
- Remote directory item counts batched in single SSH command (max 30 dirs)
- Transfer tools are YELLOW tier (auto-execute with logging)
- Downloads > 500MB prompt for confirmation via Claude conversation flow
- Cross-node transfers route through Home as SFTP intermediary with temp file cleanup
- Auto-rename on conflict uses filename(1).ext pattern, capped at 100 attempts
- Streaming download via Readable.fromWeb() + pipeline() with byte tracking

Previous milestones:
- v1.0 MVP (Phases 1-6): Full dashboard + AI + monitoring + safety
- v1.1 Hybrid Intelligence (Phases 7-10): Hybrid LLM, memory, Docker, testing
- v1.2 JARVIS Voice (Phase 11): TTS/STT with XTTS v2, ElevenLabs, OpenAI

### Pending Todos

- Voice quality poor with current XTTS v2 training -- Phase 15 will retrain with proper sources
- ~~Override context race condition in context.ts~~ RESOLVED in 12-01

### Blockers/Concerns

- Voice training quality depends on quality of source videos user provides
- ~~Path traversal is the top security risk~~ RESOLVED in 12-01 (paths.ts)
- ~~SSRF protection needed before any download tool ships~~ RESOLVED in 12-01 (urls.ts)
- Secret blocking needed before any project read tool ships

## Session Continuity

Last session: 2026-01-27
Stopped at: Completed 12-03-PLAN.md -- Phase 12 fully complete
Resume file: None

**Next steps:**
1. Begin Phase 13 (Project Intelligence) planning
2. Implement secret blocking before project read tools ship

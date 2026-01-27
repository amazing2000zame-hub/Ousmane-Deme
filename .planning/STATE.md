# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Milestone v1.3 -- Phase 12 File Operations Foundation

## Current Position

Milestone: v1.3 File Operations & Project Intelligence
Phase: 12 of 15 (File Operations Foundation)
Plan: 2 of 3 complete (12-01 and 12-02 done, 12-03 remaining)
Status: In progress
Last activity: 2026-01-27 -- Completed 12-02-PLAN.md (file listing and info tools)

Progress: [██████████████████░░] 87% (v1.0-v1.2 complete, 12-01 and 12-02 shipped)

## Performance Metrics

**Velocity (from v1.0-v1.2):**
- Total plans completed: 31
- Average duration: 5.0 min
- Phases shipped: 11

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
Stopped at: Completed 12-02-PLAN.md (file listing and info tools -- list_directory, get_file_info)
Resume file: None

**Next steps:**
1. Execute 12-03-PLAN.md (file transfer/download tools)
2. Verify Phase 12 success criteria

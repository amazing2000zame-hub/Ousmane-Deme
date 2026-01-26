# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-26)

**Core value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.
**Current focus:** Phase 3 -- AI Chat & Claude Integration

## Current Position

Phase: 3 of 5 (AI Chat & Claude Integration)
Plan: 2 of 3 in current phase (03-01, 03-02 complete)
Status: In progress
Last activity: 2026-01-26 -- Completed 03-02-PLAN.md (Frontend Chat UI)

Progress: [#####.....] ~55% (plan 2/3 of phase 3 complete, phases 1-2 done)

## Accumulated Decisions

| # | Decision | Rationale | Phase |
|---|----------|-----------|-------|
| 1 | Hardcoded 18 LLM-optimized tool definitions | Manual descriptions guide Claude better than auto-converted Zod schemas | 03-01 |
| 2 | Sequential tool processing in agentic loop | Deterministic safety enforcement; RED tool halts subsequent blocks | 03-01 |
| 3 | PendingConfirmation pattern for RED-tier tools | Saves conversation state for loop resumption after user confirms/denies | 03-01 |
| 4 | Live cluster context in system prompt | buildClusterSummary() calls executeTool() at start of each turn | 03-01 |
| 5 | Max 10 loop iterations with forced text on final | Prevents runaway tool-calling; omits tools param on last iteration | 03-01 |
| 6 | Ephemeral chat sessions via crypto.randomUUID() | No persistence until Phase 5; sessions are in-memory only | 03-02 |
| 7 | Store actions via getState() in socket handlers | Avoids stale React closures; socket handlers use useChatStore.getState() | 03-02 |
| 8 | Optimistic user message rendering | sendMessage adds to store immediately before socket emit | 03-02 |

## Blockers / Concerns

- ANTHROPIC_API_KEY must be set in backend .env before chat can work
- Integration test with live Claude API not yet performed (structural/type correctness only)
- Tool confirmation UI (approve/deny buttons) not yet wired -- stubbed via confirmTool, to be completed in Plan 03

## Session Continuity

Last session: 2026-01-26T10:55:33Z
Stopped at: Completed 03-02-PLAN.md (Frontend Chat UI)
Resume file: None

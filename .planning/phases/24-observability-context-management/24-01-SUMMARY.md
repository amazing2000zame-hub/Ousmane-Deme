---
phase: 24-observability-context-management
plan: 01
status: complete
completed: 2026-01-28
duration: ~2 min
subsystem: backend-ai-infrastructure
tags: [timing, tokenization, context-management, summarization, sliding-window]

dependency_graph:
  requires: []
  provides:
    - RequestTimer class for pipeline timing instrumentation
    - tokenize() and countMessagesTokens() for accurate Qwen token counting
    - ContextManager class for session-scoped sliding window with background summarization
    - Context management config values (window=8192, reserve=1024, threshold=25, ratio=0.7, maxSummary=500)
  affects:
    - 24-02 (integration wiring into live chat pipeline)

tech_stack:
  added: []
  patterns:
    - performance.now() mark/breakdown for pipeline timing
    - Token counting via /tokenize endpoint with character fallback
    - Session-scoped sliding window with token budgeting
    - Background summarization with entity extraction via Qwen

key_files:
  created:
    - jarvis-backend/src/realtime/timing.ts
    - jarvis-backend/src/ai/context-manager.ts
  modified:
    - jarvis-backend/src/ai/local-llm.ts
    - jarvis-backend/src/config.ts

decisions:
  - id: d24-01-01
    decision: "Conservative 8192 context window (per-slot, not total 16384)"
    rationale: "Research confirms /props n_ctx shows 8192 per slot when -c 16384 -np 2"
  - id: d24-01-02
    decision: "Character/4 fallback for tokenization when endpoint unreachable"
    rationale: "Graceful degradation -- approximate counting is better than failure"
  - id: d24-01-03
    decision: "70/30 recent/summary token budget split"
    rationale: "Recent messages are more relevant; summary provides continuity"
  - id: d24-01-04
    decision: "Entity extraction via ---ENTITIES--- marker in summarization response"
    rationale: "Structured entities survive multiple summarization cycles, preserving VMIDs, IPs, node names"
  - id: d24-01-05
    decision: "Direct Qwen fetch for summarization (not provider abstraction)"
    rationale: "Avoids consuming the agentic loop; summarization is background work"

metrics:
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
  duration: ~2 min
---

# Phase 24 Plan 01: Observability & Context Infrastructure Summary

**One-liner:** RequestTimer for pipeline timing, tokenize() with Qwen endpoint + char fallback, ContextManager with sliding window and background summarization via entity-preserving Qwen calls.

## What Was Built

### 1. RequestTimer (`jarvis-backend/src/realtime/timing.ts`)

Pipeline timing class that records `performance.now()` marks at named stages and produces relative-time breakdowns.

- `mark(name)` -- records timestamp at pipeline stage
- `breakdown()` -- returns all marks as ms relative to t0 (TimingBreakdown interface)
- `toLog()` -- single-line human-readable: `[Timing] route=12ms first_token=890ms total=2450ms`
- Auto-marks t0_received in constructor
- Optional voice marks (t5-t7) are `undefined` when not recorded

### 2. Tokenize Utility (`jarvis-backend/src/ai/local-llm.ts`)

Two new exports added alongside existing `runLocalChat`:

- `tokenize(text)` -- POST to `/tokenize` endpoint with 2s timeout, returns `data.tokens.length`; falls back to `Math.ceil(text.length / 4)` on any error
- `countMessagesTokens(messages)` -- aggregates tokenize() calls with +4 per message for chat template overhead

### 3. ContextManager (`jarvis-backend/src/ai/context-manager.ts`)

Per-session sliding window conversation manager with background summarization:

- `getOrCreateSession(id)` -- lazy session initialization
- `addMessage(id, role, content)` -- appends to recentMessages, increments totalMessageCount
- `shouldSummarize(id)` -- true when totalMessageCount > 25 and not currently summarizing
- `buildContextMessages(id, sysTokens, memTokens)` -- token-budgeted context assembly:
  - Summary (30% budget) + entities + recent messages (70% budget, backwards fill)
  - Always includes at least the latest message
- `summarize(id)` -- background call to Qwen `/v1/chat/completions` (non-streaming, temp=0.3, max_tokens=512, 15s timeout)
  - Parses narrative summary + entities from `---ENTITIES---` marker
  - Merges entities (new overwrites old), trims recentMessages to last N
  - Error-safe: on failure, logs warning, does not modify session
- `clearSession(id)` -- removes session from map

### 4. Config Updates (`jarvis-backend/src/config.ts`)

Five new context management values:
- `contextWindowTokens: 8192` -- conservative per-slot context window
- `contextResponseReserve: 1024` -- tokens reserved for LLM generation
- `contextSummarizeThreshold: 25` -- message count trigger
- `contextRecentRatio: 0.7` -- 70% recent, 30% summary
- `contextMaxSummaryTokens: 500` -- summary size cap

Updated: `qwenContextWindow` default from 4096 to 8192.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | RequestTimer class and tokenize utility | `db2fd38` | timing.ts (new), local-llm.ts (modified) |
| 2 | ContextManager class and config updates | `d8fbbe2` | context-manager.ts (new), config.ts (modified) |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

1. TypeScript compilation (`npx tsc --noEmit`) -- PASS
2. All 4 files exist -- PASS
3. No runtime changes -- existing chat behavior unaffected (integration deferred to Plan 02)
4. Config contains all 5 new context values and updated qwenContextWindow -- PASS

## Next Phase Readiness

Plan 24-02 can proceed immediately. It will wire:
- RequestTimer into the chat pipeline (mark stages in handleSend)
- ContextManager into session handling (replace raw history with windowed context)
- Timing data emission to frontend via chat:done events

No blockers. All exports are clean and ready for import.

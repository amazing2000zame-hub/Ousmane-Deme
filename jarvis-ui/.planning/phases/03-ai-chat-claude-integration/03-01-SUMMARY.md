---
phase: 03-ai-chat-claude-integration
plan: 01
subsystem: ai
tags: [claude, anthropic-sdk, socket.io, streaming, tool-calling, agentic-loop, safety-tiers]

# Dependency graph
requires:
  - phase: 01-backend-foundation
    provides: MCP server with executeTool(), safety tier system, memoryStore, Socket.IO infrastructure
provides:
  - Claude API client singleton with model configuration
  - 18 LLM-optimized tool definitions for Claude tool_use
  - JARVIS system prompt with live cluster context injection
  - Agentic tool-calling loop with streaming, safety tier interception, and confirmation flow
  - Socket.IO /chat namespace with full event protocol
affects: [03-02-frontend-chat-ui, 03-03-polish-integration]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk"]
  patterns: ["agentic-loop", "streaming-callbacks", "confirmation-flow", "tool-tier-interception"]

key-files:
  created:
    - jarvis-backend/src/ai/claude.ts
    - jarvis-backend/src/ai/tools.ts
    - jarvis-backend/src/ai/system-prompt.ts
    - jarvis-backend/src/ai/loop.ts
    - jarvis-backend/src/realtime/chat.ts
  modified:
    - jarvis-backend/src/config.ts
    - jarvis-backend/src/realtime/socket.ts
    - jarvis-backend/src/index.ts
    - jarvis-backend/package.json

key-decisions:
  - "Hardcoded 18 tool definitions with LLM-optimized descriptions instead of auto-converting from Zod schemas"
  - "Agentic loop processes tool_use blocks sequentially (not in parallel) for deterministic safety enforcement"
  - "RED-tier tools return PendingConfirmation state to the caller instead of blocking the loop"
  - "System prompt includes live cluster context via buildClusterSummary() which calls executeTool() internally"
  - "Max loop iterations default 10 with final forced text response when limit reached"

patterns-established:
  - "StreamCallbacks interface: onTextDelta/onToolUse/onToolResult/onConfirmationNeeded/onBlocked/onDone/onError"
  - "PendingConfirmation pattern: save assistant content + prior messages for loop resumption"
  - "Chat event protocol: chat:send -> chat:token* -> chat:tool_use? -> chat:tool_result? -> chat:confirm_needed? -> chat:done"

# Metrics
duration: 7min
completed: 2026-01-26
---

# Phase 3 Plan 1: Backend AI Pipeline Summary

**Claude agentic loop with streaming, 18 tool definitions, safety tier interception (GREEN auto-exec, RED confirmation, BLACK block), JARVIS system prompt, and Socket.IO /chat namespace**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-26T10:43:15Z
- **Completed:** 2026-01-26T10:49:49Z
- **Tasks:** 2/2
- **Files created:** 5
- **Files modified:** 4

## Accomplishments

- Claude API client singleton with configurable model, max tokens, history limit, and loop iteration settings
- 18 hardcoded LLM-optimized tool definitions matching all registered MCP tools with descriptions that guide Claude's tool selection
- JARVIS personality system prompt with formal British butler wit, safety rules documentation, and live cluster context injection via `<cluster_context>` tags
- Agentic tool-calling loop that streams text deltas, intercepts tool calls through safety tiers, handles RED-tier confirmation pauses, blocks BLACK-tier actions, and auto-executes GREEN/YELLOW through existing executeTool() pipeline
- Socket.IO /chat namespace with JWT auth, chat:send and chat:confirm events, streaming response protocol, and SQLite message persistence

## Task Commits

Each task was committed atomically:

1. **Task 1: Claude client, tool definitions, and system prompt** - `1c43112` (feat)
2. **Task 2: Agentic loop, /chat namespace, and application wiring** - `5101d43` (feat)

## Files Created/Modified

- `jarvis-backend/src/ai/claude.ts` - Claude API client singleton, exports claudeClient and CLAUDE_MODEL
- `jarvis-backend/src/ai/tools.ts` - 18 LLM-optimized tool definitions, exports getClaudeTools()
- `jarvis-backend/src/ai/system-prompt.ts` - JARVIS personality prompt + live cluster context, exports buildSystemPrompt() and buildClusterSummary()
- `jarvis-backend/src/ai/loop.ts` - Agentic tool-calling loop with streaming/safety/confirmation, exports runAgenticLoop() and resumeAfterConfirmation()
- `jarvis-backend/src/realtime/chat.ts` - Socket.IO /chat namespace handler, exports setupChatHandlers()
- `jarvis-backend/src/config.ts` - Added claudeModel, claudeMaxTokens, chatHistoryLimit, chatMaxLoopIterations
- `jarvis-backend/src/realtime/socket.ts` - Added /chat namespace with JWT auth middleware
- `jarvis-backend/src/index.ts` - Wired setupChatHandlers(chatNs) into application startup
- `jarvis-backend/package.json` - Added @anthropic-ai/sdk dependency

## Decisions Made

1. **Hardcoded tool definitions** -- Each of the 18 tools has a manually crafted LLM-optimized description that tells Claude when and why to use it. Auto-converting from Zod would lose the guidance quality.
2. **Sequential tool processing** -- Tool_use blocks are processed one at a time within the loop. This ensures deterministic safety enforcement and correct confirmation flow (a RED tool halts processing of subsequent blocks in the same response).
3. **PendingConfirmation pattern** -- When a RED-tier tool is encountered, the loop saves the complete conversation state (assistant content + prior messages) and returns to the caller. The caller stores this state per-session and resumes via resumeAfterConfirmation() when the user responds.
4. **Live cluster context** -- buildClusterSummary() calls executeTool('get_cluster_status') and related tools at the start of each conversation turn, embedding fresh data in the system prompt. This means Claude has recent cluster state without needing to call monitoring tools for basic questions.
5. **Max loop guard** -- Default 10 iterations prevents runaway tool-calling loops. On the final iteration, tools are omitted from the API call to force a text response.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

The ANTHROPIC_API_KEY environment variable must be set in the backend's .env file for Claude API access. Without it, the Anthropic SDK will fail on first chat message.

## Next Phase Readiness

- Backend AI pipeline is complete and ready for frontend chat UI integration (Phase 3 Plan 2)
- Socket.IO /chat namespace is live with JWT auth -- frontend needs to connect and implement the event protocol
- All event names are documented: chat:send, chat:confirm, chat:token, chat:tool_use, chat:tool_result, chat:confirm_needed, chat:blocked, chat:done, chat:error
- Confirmation flow is tested structurally (TypeScript compiles, types align) -- needs integration test with live Claude API

---
*Phase: 03-ai-chat-claude-integration*
*Plan: 01*
*Completed: 2026-01-26*

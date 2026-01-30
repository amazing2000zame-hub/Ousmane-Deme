---
phase: 30-mcp-reliability-voice-ack
plan: 02
subsystem: ai
tags: [timeout, promise-race, error-handling, mcp, tools]

# Dependency graph
requires:
  - phase: 30-mcp-reliability-voice-ack/30-01
    provides: Voice acknowledgment infrastructure
provides:
  - 60-second tool execution timeout wrapper
  - User-friendly timeout error messages
  - Slow tool warning logs (>10s)
  - Human-readable duration formatting
affects: [proactive-intelligence, mcp-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promise.race for timeout wrapping"
    - "formatDuration() helper for human-readable time"

key-files:
  created: []
  modified:
    - jarvis-backend/src/ai/loop.ts
    - jarvis-backend/src/mcp/server.ts
    - jarvis-backend/src/realtime/chat.ts

key-decisions:
  - "60s timeout chosen (most tools complete in <30s, allows for slow ops)"
  - "Timeout returns user-friendly message, not technical error"
  - "10s threshold for slow tool warnings"

patterns-established:
  - "executeToolWithTimeout: All tool calls go through timeout wrapper"
  - "formatDuration: Display ms as human-readable (ms/s/m)"

# Metrics
duration: 4min
completed: 2026-01-30
---

# Phase 30 Plan 02: Tool Timeout Summary

**60-second tool execution timeout using Promise.race with user-friendly error messages and slow tool warning logs**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-30T08:25:55Z
- **Completed:** 2026-01-30T08:29:38Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added executeToolWithTimeout wrapper with 60-second timeout using Promise.race
- User-friendly timeout messages ("operation took too long" vs technical errors)
- Slow tool warnings (>10s) logged to console for debugging
- Human-readable duration formatting (e.g., "1.5s" vs "1500ms")
- All tool calls now protected from hanging indefinitely

## Task Commits

Each task was committed atomically:

1. **Task 1: Add executeToolWithTimeout wrapper in loop.ts** - `d446f1e` (feat)
2. **Task 2: Update resumeAfterConfirmation to use timeout wrapper** - `4f89562` (feat)
3. **Task 3: Add timeout logging and improve error messages in server.ts** - `21b18bf` (feat)

## Files Created/Modified
- `jarvis-backend/src/ai/loop.ts` - Added TOOL_TIMEOUT_MS constant (60s) and executeToolWithTimeout wrapper
- `jarvis-backend/src/mcp/server.ts` - Added formatDuration helper, slow tool warnings, error logging
- `jarvis-backend/src/realtime/chat.ts` - Fixed voiceMode undefined bug in handleConfirm

## Decisions Made
- **60-second timeout:** Long enough for legitimate slow operations (SSH, file transfers) while catching truly hung tools
- **User-friendly messages:** Timeout tells user what happened and suggests retry, not raw "Promise.race rejected"
- **10-second slow warning:** Alerts operators to tools that might need optimization without false positives on quick tools

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed voiceMode undefined in handleConfirm callback**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Line 579 in chat.ts referenced `voiceMode` variable that wasn't defined in `handleConfirm` function scope (was only defined in `handleMessage`)
- **Fix:** Changed `voiceMode` to `false` with comment explaining confirmation flow doesn't have voice context
- **Files modified:** jarvis-backend/src/realtime/chat.ts
- **Verification:** TypeScript compiles successfully
- **Committed in:** d446f1e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Pre-existing bug discovered during build verification. Required for TypeScript to compile. No scope creep.

## Issues Encountered
None - plan executed smoothly after fixing the pre-existing bug.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tool timeout protection complete, ready for proactive intelligence phase
- All tool calls now have 60-second max execution time
- Slow tool warnings will help identify performance issues in production

---
*Phase: 30-mcp-reliability-voice-ack*
*Completed: 2026-01-30*

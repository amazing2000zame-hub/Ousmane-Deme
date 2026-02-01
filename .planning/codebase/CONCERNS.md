# Codebase Concerns

**Analysis Date:** 2026-01-31

## Tech Debt

**Legacy `tokensUsed` field in database schema:**
- Issue: Schema contains deprecated `tokensUsed` field alongside newer `inputTokens` + `outputTokens` fields
- Files: `jarvis-backend/src/db/schema.ts:31`
- Impact: Duplicate data tracking, potential confusion about which field is authoritative
- Fix approach: Run migration to drop `tokensUsed` column after verifying all code uses new fields

**Deprecated context API still in use:**
- Issue: `setOverrideContext()` in `jarvis-backend/src/safety/context.ts` is marked `@deprecated` but still used by `server.ts` and `system.ts` for backward compatibility
- Files: `jarvis-backend/src/safety/context.ts:90-106`, `jarvis-backend/src/mcp/server.ts`, `jarvis-backend/src/mcp/tools/system.ts`
- Impact: Module-level state instead of request-scoped isolation, potential for state leakage across concurrent requests
- Fix approach: Migrate all callers to use `runWithContext()` for proper AsyncLocalStorage-based isolation, then remove legacy API

**Console.log debugging statements in production code:**
- Issue: Over 100+ `console.log`, `console.warn`, `console.error` statements scattered throughout backend (278 catch blocks found)
- Files: Backend-wide, particularly in `jarvis-backend/src/services/`, `jarvis-backend/src/monitor/`, `jarvis-backend/src/realtime/`, `jarvis-backend/src/mcp/tools/`
- Impact: Inconsistent logging, no structured logging, difficult to filter/search logs, performance overhead
- Fix approach: Replace with structured logging library (e.g., pino, winston) with log levels and JSON output for production

**Email generation via inline Node.js eval:**
- Issue: Email sending uses inline `node -e` eval with template literals injected into command string
- Files: `jarvis-backend/src/monitor/reporter.ts:47`
- Impact: Fragile, difficult to test, potential for injection if variables not properly escaped
- Fix approach: Create dedicated email template files or use a proper email template engine

**Hardcoded `any` types in TypeScript:**
- Issue: Type safety bypassed with `any` in UI code (3 occurrences found), though backend appears well-typed
- Files: `jarvis-ui/src/hooks/useChatSocket.ts`, `jarvis-ui/src/hooks/useSmoothScroll.ts`
- Impact: Loss of type safety at critical points (socket event handling)
- Fix approach: Define proper TypeScript interfaces for all socket events and shared types

**Large complex files (>800 lines):**
- Issue: Several core files exceed 800-900+ lines, indicating potential need for decomposition
- Files:
  - `jarvis-backend/src/mcp/tools/projects.ts` (961 lines)
  - `jarvis-backend/src/ai/tools.ts` (912 lines)
  - `jarvis-backend/src/realtime/chat.ts` (847 lines)
  - `jarvis-backend/src/mcp/tools/smarthome.ts` (843 lines)
  - `jarvis-backend/src/mcp/tools/transfer.ts` (790 lines)
  - `jarvis-backend/src/ai/tts.ts` (779 lines)
  - `jarvis-backend/src/mcp/tools/files.ts` (743 lines)
  - `jarvis-backend/src/mcp/tools/web.ts` (701 lines)
- Impact: Difficult to review, test, and maintain; increased cognitive load
- Fix approach: Extract related functionality into smaller modules (e.g., split tools.ts into tool-registry.ts, tool-definitions.ts, tool-handlers.ts)

## Known Bugs

**Frigate face recognition API inconsistency:**
- Symptoms: `sub_label` field in Frigate events can be null, string (legacy), or [name, confidence] array format
- Files: `jarvis-backend/src/clients/frigate.ts:14-335`
- Trigger: Depends on Frigate version and face recognition configuration
- Workaround: Code handles all three formats but adds complexity to every caller

**Voice pipeline abrupt session termination:**
- Symptoms: No graceful cleanup when voice sessions are aborted mid-processing
- Files: `jarvis-backend/src/realtime/voice.ts:200-299`
- Trigger: Client disconnects or sends new wake word during active TTS synthesis
- Workaround: AbortController is used but may leave orphaned TTS workers in queue
- Impact: Potential memory leak from unfinished synthesis jobs, audio chunks sent to disconnected clients

## Security Considerations

**Missing .env.example entries:**
- Risk: `.env.example` missing several production variables (HOME_ASSISTANT_TOKEN, WHISPER_ENDPOINT, PRESENCE_DEVICES, MQTT_BROKER_URL)
- Files: `jarvis-backend/.env.example` (incomplete compared to `jarvis-backend/src/config.ts`)
- Current mitigation: None - developers must discover required variables from code
- Recommendations: Sync .env.example with all variables in config.ts, add comments explaining each variable's purpose

**TLS certificate validation disabled cluster-wide:**
- Risk: `NODE_TLS_REJECT_UNAUTHORIZED=0` required for self-signed Proxmox certs, but disables all TLS verification
- Files: Environment configuration (not in code)
- Current mitigation: Runs in trusted local network (192.168.1.0/24)
- Recommendations: Configure CA certificate trust for Proxmox self-signed cert instead of global disable

**JWT secret defaults to weak value in development:**
- Risk: `JWT_SECRET` defaults to `'jarvis-dev-secret'` if not set in non-production
- Files: `jarvis-backend/src/config.ts:13-18`
- Current mitigation: Throws error in production if not set
- Recommendations: Add startup warning in development mode, document in .env.example

**CORS origins include localhost variants:**
- Risk: CORS allows multiple localhost/development origins (5173, 5174, 3004) which could be exploited if attacker controls localhost
- Files: `jarvis-backend/src/config.ts:142-150`
- Current mitigation: Only local network IPs, requires authentication
- Recommendations: Use environment-based CORS config, remove unused ports

**Keyword approval system uses single static phrase:**
- Risk: ORANGE tier operations require approval keyword, but it's a single static string that could be leaked
- Files: `jarvis-backend/src/config.ts:43`, `jarvis-backend/src/safety/keyword-approval.ts`
- Current mitigation: Keyword stored in env var, not hardcoded
- Recommendations: Consider time-based or per-session approval tokens for higher security

## Performance Bottlenecks

**Database in synchronous blocking mode:**
- Problem: SQLite better-sqlite3 runs in synchronous mode, blocking Node.js event loop on all queries
- Files: `jarvis-backend/src/db/memory.ts`, `jarvis-backend/src/db/memories.ts`
- Cause: better-sqlite3 uses synchronous bindings for performance, but blocks event loop
- Improvement path: For high-throughput scenarios, migrate to async SQLite driver or move to PostgreSQL; for current scale, this is acceptable tradeoff

**TTS synthesis blocks response streaming:**
- Problem: Voice pipeline synthesizes entire sentence before sending audio, adds latency
- Files: `jarvis-backend/src/realtime/voice.ts:275-299`, `jarvis-backend/src/ai/tts.ts`
- Cause: Sentence accumulation + synthesis queue processes full sentences sequentially
- Improvement path: Implement word-level or chunk-level streaming TTS if supported by XTTS/Piper engines

**No caching for cluster status queries:**
- Problem: Every chat message triggers fresh cluster status query (PVE API calls to 4 nodes)
- Files: `jarvis-backend/src/ai/system-prompt.ts`, `jarvis-backend/src/realtime/chat.ts`
- Cause: System prompt rebuilds full cluster state on each message
- Improvement path: Cache cluster status with 5-10s TTL, invalidate on state changes from monitor

**Frontend React hook dependency arrays incomplete:**
- Problem: 159+ React hooks (useEffect, useCallback, useMemo) with potential missing dependencies
- Files: Across all `jarvis-ui/src/components/` and `jarvis-ui/src/hooks/`
- Cause: Complex state management with Zustand + Socket.IO, easy to miss dependencies
- Improvement path: Enable exhaustive-deps ESLint rule, audit each hook for correctness

## Fragile Areas

**Tool tier classification system:**
- Files: `jarvis-backend/src/safety/tiers.ts`
- Why fragile: 40+ tools manually classified into 5 tiers; adding new tools requires remembering to add to TOOL_TIERS map or defaults to BLACK (blocked)
- Safe modification: Always add new tools to TOOL_TIERS with explicit tier, add test coverage for tier lookup
- Test coverage: No automated tests for tier classification (found in `__tests__/safety.test.ts` but limited)

**Path sanitization logic:**
- Files: `jarvis-backend/src/safety/paths.ts`
- Why fragile: Complex symlink resolution, parent directory validation, multiple edge cases for non-existent paths
- Safe modification: All changes must be tested with symlinks, relative paths, URL-encoded paths, non-existent files
- Test coverage: Safety audit logging present but no comprehensive test suite visible

**Voice session state management:**
- Files: `jarvis-backend/src/realtime/voice.ts`
- Why fragile: Tracks active sessions in Map with complex state (recording, processing, TTS queue, abort controller)
- Safe modification: Always clean up sessions in finally blocks, check aborted state before emitting events
- Test coverage: No automated tests for concurrent voice sessions or mid-stream aborts

**Context manager token budget calculation:**
- Files: `jarvis-backend/src/ai/context-manager.ts`
- Why fragile: Manual token counting heuristics (chars/3.5), budget splitting between history/summary/tools
- Safe modification: Test with edge cases (empty history, very long tool results, oversized summaries)
- Test coverage: No tests found for context trimming logic

**MCP tool registration:**
- Files: `jarvis-backend/src/mcp/server.ts`, `jarvis-backend/src/ai/tools.ts`
- Why fragile: Tools defined in multiple places, must be registered in both MCP server and AI tools handler
- Safe modification: When adding new tool, update both files + TOOL_TIERS + system prompt
- Test coverage: No integration tests verifying tool registration consistency

## Scaling Limits

**Single-process architecture:**
- Current capacity: All services (HTTP, Socket.IO, MCP, monitoring, voice) in one Node.js process
- Limit: Bound by single-core performance for TTS synthesis, LLM inference calls
- Scaling path: Extract TTS service into separate workers, use Redis for Socket.IO clustering

**In-memory session storage:**
- Current capacity: Voice sessions, pending confirmations, TTS queue all in process memory
- Limit: Lost on process restart, no shared state across multiple instances
- Scaling path: Move to Redis-backed session store with TTL

**SQLite database file:**
- Current capacity: 340KB database, ~20 VMs, 4 nodes, single-user workload
- Limit: SQLite write concurrency limited, single-node deployment required
- Scaling path: Acceptable for homelab scale; if multi-user needed, migrate to PostgreSQL

**TTS cache grows unbounded:**
- Current capacity: Disk cache with max 500 entries (`config.ttsCacheMaxEntries`)
- Limit: 500-entry limit not enforced in code, cache grows indefinitely
- Scaling path: Implement LRU eviction in `jarvis-backend/src/ai/tts-cache.ts`

## Dependencies at Risk

**drizzle-kit vulnerable to esbuild exploit (MODERATE):**
- Risk: CVE in esbuild <=0.24.2 allows arbitrary requests to dev server
- Impact: Only affects `drizzle-kit` dev tool, not runtime code
- Migration plan: Upgrade to drizzle-kit 0.18.1+ (currently 0.31.8 which has issue via transitive dep)
- Priority: Low (dev-only tool, local environment)

**hono vulnerable to XSS and cache poisoning (MODERATE):**
- Risk: 4 moderate CVEs in hono <4.11.7
- Impact: hono is transitive dependency (not directly used), likely via drizzle-kit
- Migration plan: Upgrade transitive dependencies or wait for upstream fix
- Priority: Low (not in production dependency chain)

**express v5.2.1 (release candidate):**
- Risk: Using Express 5 RC instead of stable v4
- Impact: Potential API changes before final release, undiscovered bugs
- Migration plan: Monitor for Express 5.0 stable release, test before upgrading
- Priority: Medium (core dependency, but API stable in practice)

## Missing Critical Features

**No health check endpoint for Docker:**
- Problem: Backend has `/health` endpoint but doesn't verify critical dependencies (database, SSH, PVE API)
- Blocks: Kubernetes/Docker health probes can't detect degraded state
- Files: `jarvis-backend/src/api/health.ts`

**No graceful shutdown:**
- Problem: Process termination doesn't clean up active voice sessions, close database connections, or drain TTS queue
- Blocks: Zero-downtime deployments, data loss on restart
- Files: `jarvis-backend/src/index.ts:143-148`

**No rate limiting on LLM API:**
- Problem: Claude API calls have daily cost limit check but no per-minute/per-user rate limiting
- Blocks: Protection against runaway costs from loops or abuse
- Files: `jarvis-backend/src/ai/cost-tracker.ts`

**No WebSocket connection limits:**
- Problem: Unlimited concurrent Socket.IO connections, no per-IP limits
- Blocks: DoS protection
- Files: `jarvis-backend/src/index.ts`

## Test Coverage Gaps

**No tests for realtime Socket.IO handlers:**
- What's not tested: Chat, terminal, voice socket handlers
- Files: `jarvis-backend/src/realtime/chat.ts`, `jarvis-backend/src/realtime/terminal.ts`, `jarvis-backend/src/realtime/voice.ts`
- Risk: Regressions in event handling, state management, error paths
- Priority: High (core user-facing functionality)

**No tests for MCP tool handlers:**
- What's not tested: 40+ MCP tools in `/mcp/tools/` directory
- Files: All files in `jarvis-backend/src/mcp/tools/`
- Risk: Breaking changes to cluster management, file operations, smart home integrations
- Priority: High (root-level cluster operations)

**No tests for monitoring/autonomy system:**
- What's not tested: Runbooks, guardrails, remediation actions, escalation logic
- Files: `jarvis-backend/src/monitor/runbooks.ts`, `jarvis-backend/src/monitor/guardrails.ts`, `jarvis-backend/src/monitor/poller.ts`
- Risk: Autonomous actions could fail silently or cause unintended cluster changes
- Priority: Critical (autonomous operations on production cluster)

**No integration tests for frontend components:**
- What's not tested: React components, Zustand stores, socket integration
- Files: All `jarvis-ui/src/components/`, `jarvis-ui/src/hooks/`, `jarvis-ui/src/stores/`
- Risk: UI regressions, broken user flows, state management bugs
- Priority: Medium (manual testing catches most issues)

**Limited test coverage overall:**
- Backend has 4 test files: `safety.test.ts`, `memory-extractor.test.ts`, `memory-recall.test.ts`, `cost-tracker.test.ts`, `router.test.ts`
- Frontend has no test files found
- Risk: Major refactoring or dependency upgrades break functionality without detection
- Priority: High (increase to >60% coverage for business logic)

---

*Concerns audit: 2026-01-31*

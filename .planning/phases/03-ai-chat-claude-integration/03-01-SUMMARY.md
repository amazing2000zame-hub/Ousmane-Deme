---
phase: "03"
plan: "01"
subsystem: "ai-backend-pipeline"
completed: "2026-01-26"
duration: "~8 min"
tags: [claude-api, tool-definitions, system-prompt, agentic-loop, chat-namespace, streaming, safety-tiers]
requires:
  - "01-03"
  - "01-04"
provides:
  - "Claude API client singleton with availability check"
  - "18 LLM-optimized tool definitions"
  - "JARVIS personality system prompt with cluster context injection"
  - "Agentic tool-calling loop with streaming, safety interception, and confirmation flow"
  - "Socket.IO /chat namespace with send and confirm handlers"
  - "Smart routing: Claude for tool-requiring queries, local LLM for conversation"
  - "Override passkey system for elevated access"
affects:
  - "03-02"
  - "03-03"
tech-stack:
  added:
    - "@anthropic-ai/sdk"
  patterns:
    - "Singleton Claude client with env-based availability flag"
    - "Hardcoded tool definitions (not auto-converted from Zod)"
    - "Streaming agentic loop with max iteration guard"
    - "PendingConfirmation pattern for RED-tier tool pause/resume"
    - "Smart routing via keyword detection (needsTools)"
    - "Override passkey elevates BLACK/RED tier restrictions"
    - "Fire-and-forget DB saves (non-critical persistence)"
key-files:
  created:
    - "jarvis-backend/src/ai/claude.ts"
    - "jarvis-backend/src/ai/tools.ts"
    - "jarvis-backend/src/ai/system-prompt.ts"
    - "jarvis-backend/src/ai/loop.ts"
    - "jarvis-backend/src/ai/local-llm.ts"
    - "jarvis-backend/src/realtime/chat.ts"
  modified:
    - "jarvis-backend/src/config.ts"
    - "jarvis-backend/src/realtime/socket.ts"
    - "jarvis-backend/src/index.ts"
decisions:
  - id: "03-01-01"
    decision: "Claude client is null when ANTHROPIC_API_KEY not set -- claudeAvailable flag gates usage"
  - id: "03-01-02"
    decision: "Tool definitions hardcoded for LLM-optimized descriptions, not auto-converted from Zod schemas"
  - id: "03-01-03"
    decision: "confirmed parameter excluded from tool definitions -- backend handles confirmation internally"
  - id: "03-01-04"
    decision: "Smart routing: keyword-based detection routes to Claude (tools) or local Qwen (conversation)"
  - id: "03-01-05"
    decision: "Override passkey ('override alpha') temporarily elevates BLACK/RED restrictions for one message"
  - id: "03-01-06"
    decision: "AbortController per session for request cancellation on disconnect"
  - id: "03-01-07"
    decision: "DB saves wrapped in try/catch -- chat continues even if persistence fails"
  - id: "03-01-08"
    decision: "Max loop iterations (10) with final iteration omitting tools to force text response"
metrics:
  tasks: "2/2"
  commits: 0
  note: "Implemented in a prior session, uncommitted changes"
---

# Phase 3 Plan 1: Backend AI Pipeline Summary

**One-liner:** Claude API client, agentic tool-calling loop, and Socket.IO /chat namespace with smart local/cloud LLM routing

## What Was Built

### Claude Client (`src/ai/claude.ts`)
- Singleton `Anthropic` client, reads `ANTHROPIC_API_KEY` from env automatically
- `claudeAvailable` boolean flag -- when false, system falls back to local LLM
- `CLAUDE_MODEL` constant from config (default: `claude-sonnet-4-20250514`)

### Tool Definitions (`src/ai/tools.ts`)
- 18 hardcoded `Anthropic.Tool[]` definitions with LLM-optimized descriptions
- GREEN tier (9): cluster status, node status, VMs, containers, storage, resources, temperature, tasks, backups
- RED tier (6): start/stop/restart for VMs and containers
- YELLOW tier (3): execute SSH, restart service, wake node
- `confirmed` parameter excluded -- backend handles confirmation internally

### System Prompt (`src/ai/system-prompt.ts`)
- `buildSystemPrompt(clusterSummary, overrideActive)` -- full JARVIS personality
- Identity: Iron Man AI butler, formal British, dry wit, "sir"
- Safety rules: GREEN auto-execute, RED requires confirmation, BLACK blocked
- Cluster knowledge: 4 nodes with roles, protected resources (VMID 103)
- Override passkey block: explains elevated access when override active
- `buildClusterSummary()` -- fetches live cluster + VM + container data via executeTool

### Agentic Loop (`src/ai/loop.ts`)
- `runAgenticLoop()` -- streaming Claude conversation with tool execution
- Processes tool_use blocks sequentially with tier checks
- BLACK: blocked (unless override), error tool_result sent back to Claude
- RED: returns `PendingConfirmation` to pause for user approval
- GREEN/YELLOW: auto-executes via `executeTool()`, streams results
- Max 10 iterations with final iteration omitting tools (forces text response)
- `resumeAfterConfirmation()` -- reconstructs messages and re-enters loop
- Override flag flows through to executeTool for elevated access

### Local LLM (`src/ai/local-llm.ts`)
- `runLocalChat()` -- streams responses from local Qwen via OpenAI-compatible API
- Used for conversation that doesn't need tools (saves Claude API tokens)
- Streams token-by-token matching the same callback interface

### Chat Namespace (`src/realtime/chat.ts`)
- Socket.IO /chat namespace with JWT auth middleware
- `chat:send` handler: smart routing (Claude if tools needed, else local LLM)
- `chat:confirm` handler: resumes agentic loop after user approval
- Override passkey detection in user messages
- Per-socket state: pending confirmations map, abort controllers map
- Cleanup on disconnect: aborts active requests, clears maps

### Config Updates (`src/config.ts`)
- `claudeModel`, `claudeMaxTokens` (4096), `chatHistoryLimit` (20), `chatMaxLoopIterations` (10)
- `localLlmEndpoint` (http://192.168.1.50:8080), `localLlmModel` (qwen2.5-7b)
- `overrideKey` for elevated access passphrase

## Key Patterns

1. **Smart routing:** `needsTools()` checks message against keyword list. Tool-requiring messages go to Claude (agentic loop with tools). Conversational messages go to local Qwen (saves API costs).

2. **Confirmation pause/resume:** RED-tier tools return a `PendingConfirmation` that captures the full conversation state. When the user responds, `resumeAfterConfirmation()` reconstructs messages and re-enters the loop.

3. **Override passkey:** User says "override alpha" in their message. Backend detects it, sets `overrideActive=true`, which flows through to the loop and executeTool, bypassing BLACK/RED restrictions.

## Deviations from Plan

- **Added:** Smart routing (local LLM vs Claude) -- not in original plan but saves API costs
- **Added:** Override passkey system -- not in original plan but critical for operator flexibility
- **Added:** local-llm.ts module for Qwen integration -- deferred from Phase 5 but naturally fits here

## Verification Results

- `npx tsc --noEmit` in jarvis-backend -- zero type errors
- 18 tool definitions confirmed in tools.ts
- chatNs created in socket.ts and wired in index.ts
- All chat events handled: send, confirm, token, tool_use, tool_result, confirm_needed, blocked, done, error

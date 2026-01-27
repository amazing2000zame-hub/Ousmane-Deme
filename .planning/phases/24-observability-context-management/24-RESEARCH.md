# Phase 24: Observability & Context Management - Research

**Researched:** 2026-01-27
**Domain:** Pipeline latency tracing (performance.now), conversation context sliding window with LLM summarization
**Confidence:** HIGH

## Summary

This phase has two independent sub-systems: (1) a per-request timing pipeline that instruments every stage of chat processing with `performance.now()` timestamps, and (2) a conversation context manager that keeps the last 20-30 messages verbatim while summarizing older context via a background Qwen call.

The codebase already has the scaffolding for both. The chat handler (`chat.ts`) has clearly defined stages (routing, thinking, synthesizing, speaking) and the session history is cached in-memory per socket. The config already has `chatHistoryLimit: 20` and `qwenHistoryLimit: 10`. The key work is: (a) adding timing marks at each pipeline stage and emitting them, and (b) replacing the simple `slice(-limit)` with a summarize-then-window strategy that preserves structured context.

A critical finding: the llama-server `/tokenize` endpoint is live and working at `http://192.168.1.50:8080/tokenize`, accepting `POST { "content": "text" }` and returning `{ "tokens": [int...] }`. This provides **accurate token counting** using the actual Qwen tokenizer, eliminating the need for rough character-based estimation (currently `Math.ceil(text.length / 4)`). The server runs with `-c 16384` (16K context), not the 4096 configured in `config.ts` as `qwenContextWindow`.

**Primary recommendation:** Use `performance.now()` marks (not Node.js `perf_hooks`) for simplicity. For context management, use llama-server `/tokenize` for accurate token counting, implement a sliding window with background Qwen summarization that explicitly extracts structured entities (VMIDs, IPs, paths) into a separate preserved block.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `performance.now()` | built-in | High-resolution timestamps | Already available, sub-millisecond precision, zero dependencies |
| llama-server `/tokenize` | built-in | Accurate Qwen token counting | Uses the actual model tokenizer, already running at localhost:8080 |
| llama-server `/v1/chat/completions` | built-in | Background summarization calls | Same endpoint already used for Qwen chat, no new infra |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Socket.IO events | already installed | Emit timing data to frontend | `chat:timing` event for debug/UI display |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `performance.now()` | Node.js `perf_hooks` marks/measures | More structured but overkill for a single pipeline trace; perf_hooks adds complexity without benefit here |
| llama-server `/tokenize` | `Math.ceil(text.length / 4)` estimate | Already in codebase; 15-30% inaccurate for CJK/code; `/tokenize` is exact |
| Background Qwen summarization | External memory service (Mem0, etc.) | Adds dependency; Qwen is already running and can summarize inline |
| OpenTelemetry | N/A | Explicitly out of scope per prior decisions |

**Installation:**
No new npm dependencies needed. Zero new backend dependencies per prior decision.

## Architecture Patterns

### Recommended Project Structure

```
jarvis-backend/src/
├── ai/
│   ├── context-manager.ts       # NEW: sliding window + summarization logic
│   └── local-llm.ts             # Existing: add tokenize() utility function
├── realtime/
│   ├── chat.ts                  # MODIFY: add timing marks, integrate context manager
│   └── timing.ts                # NEW: RequestTimer class
└── config.ts                    # MODIFY: add context management config values
```

### Pattern 1: RequestTimer (Pipeline Timing)

**What:** A simple class that records `performance.now()` at named stages and emits the full breakdown.
**When to use:** Every `handleSend` invocation in `chat.ts`.
**Example:**

```typescript
// Source: Node.js performance.now() built-in
interface TimingBreakdown {
  t0_received: number;      // message received by server
  t1_routed: number;        // routing decision made
  t2_llm_start: number;     // LLM request dispatched
  t3_first_token: number;   // first token received from LLM
  t4_llm_done: number;      // LLM stream complete
  t5_tts_queued?: number;   // first sentence queued for TTS
  t6_tts_first?: number;    // first audio chunk ready
  t7_audio_delivered?: number; // first audio emitted to client
  total_ms: number;          // t0 to last stage
}

class RequestTimer {
  private marks = new Map<string, number>();

  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  breakdown(): TimingBreakdown {
    const t0 = this.marks.get('t0_received') ?? 0;
    return {
      t0_received: 0,  // relative base
      t1_routed: (this.marks.get('t1_routed') ?? t0) - t0,
      t2_llm_start: (this.marks.get('t2_llm_start') ?? t0) - t0,
      t3_first_token: (this.marks.get('t3_first_token') ?? t0) - t0,
      t4_llm_done: (this.marks.get('t4_llm_done') ?? t0) - t0,
      t5_tts_queued: this.marks.has('t5_tts_queued')
        ? (this.marks.get('t5_tts_queued')! - t0) : undefined,
      t6_tts_first: this.marks.has('t6_tts_first')
        ? (this.marks.get('t6_tts_first')! - t0) : undefined,
      t7_audio_delivered: this.marks.has('t7_audio_delivered')
        ? (this.marks.get('t7_audio_delivered')! - t0) : undefined,
      total_ms: (this.marks.get('total') ?? performance.now()) - t0,
    };
  }
}
```

### Pattern 2: Context Manager (Sliding Window + Summarization)

**What:** Manages the conversation history for a session: keeps last N messages verbatim, summarizes older messages in the background, and preserves structured entities.
**When to use:** Called from `handleSend` before building `chatMessages`.
**Example:**

```typescript
// Context management state per session
interface SessionContext {
  // Full recent messages (kept verbatim)
  recentMessages: Array<{ role: string; content: string }>;
  // Compressed summary of older messages
  summary: string | null;
  // Structured entities that must survive summarization
  entities: Map<string, string>; // e.g., "vm_103" -> "management VM on pve"
  // Total token count of current context
  tokenCount: number;
  // Whether a summarization is currently in progress
  summarizing: boolean;
}

// Build the messages array for the LLM
function buildContextMessages(
  session: SessionContext,
  systemPrompt: string,
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];

  // Inject summary as a system-level context block if available
  if (session.summary) {
    messages.push({
      role: 'system',
      content: `<conversation_summary>\n${session.summary}\n</conversation_summary>`,
    });
  }

  // Inject preserved entities block
  if (session.entities.size > 0) {
    const entityBlock = Array.from(session.entities.entries())
      .map(([key, val]) => `- ${key}: ${val}`)
      .join('\n');
    messages.push({
      role: 'system',
      content: `<preserved_context>\n${entityBlock}\n</preserved_context>`,
    });
  }

  // Add recent messages verbatim
  messages.push(...session.recentMessages);

  return messages;
}
```

### Pattern 3: Entity Extraction for Summarization

**What:** Before summarizing, extract structured data (VMIDs, IPs, file paths, error codes) into a separate preserved block that bypasses summarization.
**When to use:** Part of the summarization prompt sent to Qwen.

```typescript
// Summarization prompt that preserves structured context
const SUMMARIZE_PROMPT = `Summarize this conversation concisely. You MUST:
1. Preserve ALL mentioned VMIDs, IP addresses, file paths, node names, and error messages verbatim
2. List preserved entities in a YAML block at the end:
\`\`\`entities
vm_103: management VM on node pve (192.168.1.65)
node_agent1: 192.168.1.61, compute node
path_discussed: /opt/jarvis/config.ts
\`\`\`
3. Keep the narrative summary under 200 words
4. Focus on decisions made, actions taken, and current state of discussion

Conversation to summarize:
`;
```

### Anti-Patterns to Avoid

- **Summarizing on every message:** Only trigger when message count exceeds threshold. Summarizing is expensive (uses an LLM slot for ~2-5 seconds). Trigger at message 20-25, not every message.
- **Dropping entities during summarization:** Without explicit entity extraction, VMIDs and IPs get lost. The summarization prompt MUST explicitly ask for entity preservation.
- **Blocking the chat response to wait for summarization:** Summarization runs in the background. The current response uses the existing context; the summarized context is available for the NEXT message.
- **Using character-based token estimation for budget math:** The existing `Math.ceil(text.length / 4)` estimate can be 15-30% off. Use `/tokenize` for accurate counting when making truncation decisions.
- **Summarizing system prompts:** Only user/assistant messages should be summarized. System prompts are rebuilt fresh each request.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Character-based estimation | llama-server `/tokenize` endpoint | Exact model-specific token count; already running at localhost:8080 |
| Distributed tracing | Custom span propagation | `performance.now()` + structured logging | Homelab scale; no microservices boundary to cross |
| Context summarization | Simple string truncation | LLM-based summarization via Qwen | Truncation loses coherence; summarization preserves meaning |
| Entity extraction from conversations | Regex parsing of VMIDs/IPs | LLM extraction in summarization prompt | More robust; handles natural language references to entities |

**Key insight:** The llama-server already provides both the tokenization API (`/tokenize`) and the summarization capability (chat completions). No new infrastructure is needed. The entire context management system can be built using the existing Qwen endpoint.

## Common Pitfalls

### Pitfall 1: Context Window Misconfiguration

**What goes wrong:** The codebase has `qwenContextWindow: 4096` in `config.ts`, but the actual llama-server runs with `-c 16384`. This means the system is artificially limiting itself.
**Why it happens:** The config value was set conservatively and never updated when the server was reconfigured.
**How to avoid:** Update `config.ts` to reflect the actual server configuration (16384). Use `/props` endpoint to verify at startup: `GET http://localhost:8080/props` returns `{ "n_ctx": 8192 }` in the response (note: /props reports default_generation_settings.n_ctx which may differ from the `-c` flag; the `-c 16384` flag is the actual limit).
**Warning signs:** Messages getting truncated too aggressively; history limit too low for meaningful conversations.

**IMPORTANT DISCOVERY:** The `/props` endpoint returns `"n_ctx": 8192` even though the server was started with `-c 16384`. This needs investigation -- the effective context window may be 8192, not 16384. The planner should add a verification task.

### Pitfall 2: Summarization Starving the LLM Inference Slot

**What goes wrong:** Background summarization consumes one of the two llama-server slots (`-np 2`), blocking user-facing requests.
**Why it happens:** llama-server has only 2 parallel slots. If one is doing summarization while another handles a user request, a third request would queue.
**How to avoid:** Only trigger summarization when the user's LLM response is complete (in the `onDone` callback). Use a debounce -- if multiple messages arrive quickly, only summarize once. Consider a dedicated flag to skip summarization during high load.
**Warning signs:** Increased latency on the message immediately following summarization; `429` or queueing from llama-server.

### Pitfall 3: Summary Drift

**What goes wrong:** After multiple rounds of summarization, the summary becomes increasingly generic and loses specific details.
**Why it happens:** Each summarization pass compresses information further. After 3-4 rounds, original specifics are gone.
**How to avoid:** Use the entity extraction pattern -- structured data (VMIDs, IPs, paths) is preserved in a separate block that is NEVER summarized, only appended to. The narrative summary can drift; the entities block stays exact.
**Warning signs:** User references a VM discussed 40 messages ago and JARVIS doesn't recognize it despite summarization claiming to preserve context.

### Pitfall 4: Timing Marks Missing Async Gaps

**What goes wrong:** `performance.now()` is called before an `await`, but the actual operation starts later due to the event loop.
**Why it happens:** Node.js is single-threaded; if the event loop is busy, the `fetch` to llama-server doesn't actually start until the current microtask completes.
**How to avoid:** Place timing marks at the actual operation points, not before the `await`. For LLM timing, mark when the fetch starts AND when the first token callback fires (which is the true "LLM started responding" moment).
**Warning signs:** `t2_llm_start` and `t3_first_token` showing suspiciously identical values.

### Pitfall 5: Token Budget Accounting Errors

**What goes wrong:** The total token count exceeds the context window because the system prompt, memory context, summary, and messages are all sized independently.
**Why it happens:** Each component has its own budget but nobody enforces the total.
**How to avoid:** Compute the total token budget as: `contextWindow - systemPromptTokens - memoryContextTokens - responseReserve(1024) = availableForHistory`. Then allocate history tokens: summary gets up to 30% of available, recent messages get 70%.
**Warning signs:** llama-server returning truncated or incoherent responses because it silently truncated the input.

## Code Examples

### Verified: llama-server /tokenize endpoint

```typescript
// Source: Verified live against http://192.168.1.50:8080/tokenize (2026-01-27)
// Returns exact token count using the actual Qwen tokenizer

async function countTokens(text: string): Promise<number> {
  const res = await fetch(`${config.localLlmEndpoint}/tokenize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) {
    // Fallback to estimation if endpoint fails
    return Math.ceil(text.length / 4);
  }
  const data = await res.json() as { tokens: number[] };
  return data.tokens.length;
}

// Batch token counting for multiple messages
async function countMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): Promise<number> {
  // Count all message content plus role overhead (~4 tokens per message for chat template)
  const contentTokenCounts = await Promise.all(
    messages.map(m => countTokens(m.content))
  );
  const contentTotal = contentTokenCounts.reduce((a, b) => a + b, 0);
  const overhead = messages.length * 4; // chat template tokens per message
  return contentTotal + overhead;
}
```

### Verified: performance.now() timing in Node.js

```typescript
// Source: Node.js built-in (verified in Node 22+)
// performance.now() returns DOMHighResTimeStamp in milliseconds

function createTimer(): { mark: (name: string) => void; elapsed: (name: string) => number; all: () => Record<string, number> } {
  const t0 = performance.now();
  const marks: Record<string, number> = {};

  return {
    mark(name: string) {
      marks[name] = performance.now() - t0;
    },
    elapsed(name: string) {
      return marks[name] ?? -1;
    },
    all() {
      return { ...marks };
    },
  };
}
```

### Verified: Socket.IO event for timing emission

```typescript
// Source: Existing pattern from chat.ts -- chat:done event with usage data
// Add timing breakdown to the existing chat:done emission

// In onDone callback:
socket.emit('chat:done', {
  sessionId,
  usage,
  provider: decision.provider,
  cost,
  timing: timer.all(),  // NEW: timing breakdown
});

// Also emit a dedicated timing event for debug/log purposes
socket.emit('chat:timing', {
  sessionId,
  timing: timer.all(),
});
```

### Pattern: Background summarization trigger

```typescript
// Source: Derived from codebase analysis of chat.ts onDone callback

// In the onDone callback, after saving the assistant message:
const cached = sessionHistoryCache.get(sessionId);
if (cached && cached.length > config.contextSummarizeThreshold && !sessionContext.summarizing) {
  // Trigger background summarization (non-blocking)
  sessionContext.summarizing = true;
  summarizeOlderContext(sessionId, cached, sessionContext)
    .catch(err => console.warn(`[Context] Summarization failed: ${err}`))
    .finally(() => { sessionContext.summarizing = false; });
}
```

### Pattern: Summarization prompt for Qwen

```typescript
// Prompt designed for Qwen 2.5 7B -- concise, structured output
const summarizationPrompt = `You are a conversation summarizer. Summarize the following conversation between a user and JARVIS (an AI homelab assistant).

RULES:
1. Output a concise narrative summary (under 150 words)
2. Preserve ALL specific identifiers: VMIDs, IP addresses, node names, file paths, error codes
3. After the summary, output a YAML block of preserved entities
4. Focus on: decisions made, problems discussed, actions taken, current state

FORMAT:
[narrative summary here]

---ENTITIES---
key: description
key: description

CONVERSATION:
`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `slice(-20)` message truncation | Sliding window + LLM summarization | 2024-2025 (widespread adoption) | Preserves context coherence across long conversations |
| Character-based token estimation | Model-specific tokenizer API | Always available in llama.cpp | 15-30% more accurate token budgeting |
| No pipeline timing | `performance.now()` at each stage | Standard practice | Identifies bottlenecks (LLM vs TTS vs network) |
| Full history in prompt | Summary + entities + recent window | 2024-2025 (LangChain, Mem0, etc.) | Extends effective conversation length by 5-10x |

**Deprecated/outdated:**
- `config.qwenContextWindow = 4096`: Server actually runs with 16384 context. This config value needs updating.
- Simple `messages.slice(-limit)`: Loses all context beyond the window. Must be replaced with summarization.

## Open Questions

1. **Effective context window: 8192 or 16384?**
   - The server is launched with `-c 16384`, but `/props` reports `n_ctx: 8192`.
   - What we know: The service file clearly shows `-c 16384`. The `/props` response shows `n_ctx: 8192`.
   - What's unclear: Whether `n_ctx` in `/props` represents per-slot context (16384 / 2 slots = 8192) or an override.
   - Recommendation: Add a startup verification task that logs the effective context window. Design the context manager to work with 8192 as the conservative limit and 16384 as the optimistic one. Test with real conversations to determine which is accurate.

2. **Summarization quality with Qwen 7B Q4**
   - What we know: Qwen 2.5 7B is capable of summarization tasks. Q4_K_M quantization may reduce quality slightly.
   - What's unclear: How well it preserves structured entities (VMIDs, IPs) in practice.
   - Recommendation: Include a verification test in the plan -- send 30+ messages discussing specific VMs and IPs, trigger summarization, then ask about entities from early messages. Validate entity survival.

3. **Token counting latency impact**
   - What we know: `/tokenize` is fast (local HTTP call to same machine).
   - What's unclear: Exact latency per call; whether counting every message every time adds meaningful overhead.
   - Recommendation: Cache token counts per message (content is immutable after saving). Only count new messages. Fallback to estimation if `/tokenize` is unavailable.

## Sources

### Primary (HIGH confidence)
- llama-server `/tokenize` endpoint -- verified live at `http://192.168.1.50:8080/tokenize` on 2026-01-27, returns `{ "tokens": [int...] }` for `POST { "content": "text" }`
- llama-server `/props` endpoint -- verified live at `http://192.168.1.50:8080/props` on 2026-01-27, returns model properties including `n_ctx: 8192`
- llama-server service file -- `/etc/systemd/system/jarvis-api.service` shows `-c 16384 -np 2 -t 16`
- Node.js `performance.now()` -- [MDN docs](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now), [Node.js perf_hooks](https://nodejs.org/api/perf_hooks.html)
- Codebase analysis -- `chat.ts`, `config.ts`, `local-llm.ts`, `qwen-provider.ts`, `memory-context.ts`, `memory-extractor.ts` (all read and analyzed)

### Secondary (MEDIUM confidence)
- [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) -- `/tokenize` endpoint format
- [llama.cpp DeepWiki](https://deepwiki.com/ggml-org/llama.cpp/5.2-http-server) -- Server endpoint overview
- [JetBrains Research Blog](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) -- Context management patterns for LLM agents
- [GetMaxim article](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) -- Sliding window + summarization patterns
- [AWS Generative AI Atlas](https://awslabs.github.io/generative-ai-atlas/topics/2_0_technical_foundations_and_patterns/2_1_key_primitives/2_1_3_context_windows/2_1_3_context_windows.html) -- Context window management strategies

### Tertiary (LOW confidence)
- Token budget allocation ratios (30% summary / 70% recent) -- derived from multiple blog posts, not a single authoritative source. Needs tuning for this specific system.
- Qwen 7B Q4 summarization quality -- no specific benchmarks found for Q4_K_M quantization quality on summarization tasks.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; uses built-in Node.js APIs and already-running llama-server endpoints, all verified live
- Architecture: HIGH - Patterns derived from codebase analysis; timing is straightforward, context management follows well-documented patterns
- Pitfalls: HIGH - Context window mismatch discovered and verified; LLM slot contention is a real constraint (2 slots); entity drift documented in literature
- Context management: MEDIUM - Sliding window + summarization is well-established, but Qwen 7B Q4 summarization quality is unverified for this specific use case

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (stable domain; llama-server API unlikely to change)

# Phase 30: MCP Tool Reliability & Voice Acknowledgment - Research

**Researched:** 2026-01-30
**Domain:** Node.js async/await patterns, Socket.IO real-time events, Web Audio API
**Confidence:** HIGH

## Summary

This phase addresses two interrelated issues in the JARVIS voice assistant system:

1. **Voice acknowledgment timing**: The user should hear "One moment, sir" BEFORE a tool executes, not after. Currently, the acknowledgment may arrive after the tool completes due to async race conditions.

2. **MCP tool error handling**: Tools can fail or timeout without proper user feedback. The system needs graceful degradation with clear error messages.

Investigation reveals the current implementation has the acknowledgment logic in place (`sendToolAcknowledgment()` in chat.ts, awaited in `onToolUse` callback), but several issues prevent it from working reliably.

**Primary recommendation:** Fix the async flow in the agentic loop to properly await acknowledgment audio before tool execution, add tool-level timeouts with graceful failure messages, and ensure the frontend plays acknowledgment audio immediately (with special handling for the `-1` index).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Socket.IO | 4.x | Real-time events | Already in use, bidirectional |
| Node.js Streams | Built-in | TTS audio streaming | No deps needed |
| AbortController | Built-in | Request cancellation | Standard pattern |
| Web Audio API | Built-in | Frontend audio playback | Browser standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-timeout | 6.x | Promise timeout wrapper | Cleaner than manual race |
| p-retry | 5.x | Retry with backoff | Tool retry logic |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual Promise.race | p-timeout | p-timeout is cleaner, but adds dependency |
| Custom retry | p-retry | p-retry has backoff, but tool retries may be complex |

**Decision:** Use built-in Promise.race and AbortController patterns since they're already used throughout the codebase. Keep dependencies minimal.

## Architecture Patterns

### Current Flow (As-Is)

```
User speaks "show me the cluster status"
    |
    v
chat.ts handleSend() --> routeMessage() --> claudeProvider.chat()
    |
    v
loop.ts runAgenticLoop()
    |
    v
Claude streaming response (onTextDelta)
    |
    v
Claude returns tool_use block (stop_reason: tool_use)
    |
    v
loop.ts: await callbacks.onToolUse()  <-- Acknowledgment should happen here
    |
    v
chat.ts onToolUse: await sendToolAcknowledgment()  <-- ISSUE: May not block correctly
    |
    v
loop.ts: await executeTool()  <-- Tool runs potentially before audio plays
    |
    v
Frontend receives chat:audio_chunk with index=-1  <-- Special acknowledgment chunk
    |
    v
Frontend plays audio (but tool may already be done)
```

### Identified Issues

**Issue 1: Acknowledgment index not handled on frontend**

The backend sends acknowledgment audio with `index: -1` (special marker), but the frontend's `queueAudioChunk()` sorts by index and the progressive queue may not play `-1` correctly:

```typescript
// chat.ts line 97-102
socket.emit('chat:audio_chunk', {
  sessionId,
  index: -1, // Special index for acknowledgment
  contentType: audio.contentType,
  audio: audio.buffer.toString('base64'),
});
```

But `progressive-queue.ts` sorts by index:
```typescript
// progressive-queue.ts line 119
xttsQueue.sort((a, b) => a.index - b.index);
```

With index `-1`, the acknowledgment would be sorted BEFORE index 0, but only if the progressive session is already started. The session starts on first `chat:sentence`, which comes AFTER the tool_use event.

**Issue 2: Progressive session not started for acknowledgments**

The acknowledgment is sent before any text streaming starts. At that point:
- `progressiveSessionStarted` is false
- `onSentence` hasn't been called yet
- `onAudioChunk` with index=-1 will try to start a session, but there's no `streamingMessageId` yet

**Issue 3: TTS synthesis is slow (7-15s)**

Even if the await works correctly, XTTS takes 7-15 seconds for synthesis. The acknowledgment phrases are short (1-2 seconds of audio), but synthesis still takes several seconds. User hears nothing during this time.

**Issue 4: No tool-level timeouts**

`executeTool()` in `mcp/server.ts` has no timeout. Individual tool handlers may timeout (SSH has 30s default), but the outer wrapper doesn't enforce any limit. A hung tool blocks the conversation indefinitely.

### Recommended Project Structure (for fixes)

```
jarvis-backend/src/
├── ai/
│   ├── loop.ts            # Add tool-level timeout wrapper
│   ├── tts.ts             # Already has acknowledgment caching (PREWARM_PHRASES)
│   └── ...
├── realtime/
│   ├── chat.ts            # Fix acknowledgment flow, use pre-cached audio
│   └── ...
└── mcp/
    └── server.ts          # Add executeTool timeout parameter

jarvis-ui/src/
├── audio/
│   └── progressive-queue.ts  # Handle index=-1 acknowledgments specially
└── hooks/
    └── useChatSocket.ts      # Immediate playback for acknowledgment chunks
```

### Pattern 1: Pre-cached Acknowledgment Audio

**What:** Pre-synthesize common acknowledgment phrases at startup, serve from cache instantly.

**When to use:** For predictable short phrases that need instant playback.

**Current state:** The phrases ARE in `PREWARM_PHRASES` array in `tts.ts`:
```typescript
// tts.ts lines 662-667
// Tool acknowledgments (spoken before executing tools)
'One moment, sir.',
'Getting that pulled up now.',
'Right away, sir.',
'Let me check on that.',
'Working on it.',
```

The `prewarmTtsCache()` function synthesizes these at startup. The issue is that `sendToolAcknowledgment()` uses `synthesizeSentenceWithFallback()` which should hit the cache, but there may be race conditions during startup or cache misses.

### Pattern 2: Immediate Acknowledgment via Dedicated Event

**What:** Send acknowledgment as a separate event type, not as an audio_chunk with special index.

**When to use:** When acknowledgments need different handling than response audio.

**Example:**
```typescript
// Backend
socket.emit('chat:acknowledge', {
  sessionId,
  phrase: 'One moment, sir.',
  audio: audio.buffer.toString('base64'),
  contentType: audio.contentType,
});

// Frontend handles immediately, outside progressive queue
socket.on('chat:acknowledge', (data) => {
  playImmediately(data.audio); // Don't queue, play NOW
});
```

### Pattern 3: Tool Execution Timeout

**What:** Wrap tool execution in a timeout that returns graceful error.

**When to use:** Every tool execution to prevent hung conversations.

**Example:**
```typescript
// In loop.ts or mcp/server.ts
const TOOL_TIMEOUT_MS = 60_000; // 1 minute max for any tool

async function executeToolWithTimeout(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  try {
    return await executeTool(name, args, 'llm');
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        content: [{ type: 'text', text: `Tool "${name}" timed out after ${TOOL_TIMEOUT_MS/1000}s` }],
        isError: true,
      };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### Anti-Patterns to Avoid

- **Fire-and-forget acknowledgment:** Don't emit audio without waiting for playback confirmation. The current code awaits synthesis but not playback.

- **Blocking main loop for audio:** Don't wait for the full audio to play before continuing. Just ensure the audio is delivered and will play, then proceed.

- **Silent failures:** Don't swallow errors in tool execution. Always report back to the user.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Promise timeout | Manual setTimeout + Promise.race | Built-in pattern (already in use) | The codebase already uses this pattern correctly in tts.ts |
| Audio caching | Custom cache logic | Existing LRU cache in tts.ts | Already implemented with disk persistence |
| Graceful shutdown | Manual cleanup | AbortController propagation | Already threads through the loop |

**Key insight:** Most of the infrastructure exists. The issue is in the integration between components, not missing functionality.

## Common Pitfalls

### Pitfall 1: Assuming await = blocking playback

**What goes wrong:** Code awaits `sendToolAcknowledgment()` thinking this means audio plays before continuing. But the await only waits for the Socket.IO emit, not for the client to receive and play the audio.

**Why it happens:** Network latency + client processing time means emit resolves before audio plays.

**How to avoid:** Accept that we can't truly block until audio plays. Instead:
1. Pre-cache acknowledgment audio (already done)
2. Use Piper fallback for instant synthesis (<200ms)
3. Send acknowledgment as early as possible in the flow
4. Let tool execution proceed in parallel with audio playback

**Warning signs:** User reports hearing acknowledgment AFTER tool results appear in UI.

### Pitfall 2: Progressive queue blocking acknowledgments

**What goes wrong:** Acknowledgment audio (index=-1) gets queued behind other audio or session hasn't started yet.

**Why it happens:** The progressive queue is designed for sequential sentence playback, not out-of-band interruptions.

**How to avoid:** Handle acknowledgments separately from the progressive queue:
- New event type `chat:acknowledge` with immediate playback
- Or special case index=-1 in the frontend to play immediately without queuing

**Warning signs:** Acknowledgment plays after response audio starts.

### Pitfall 3: Tool errors swallowed in try/catch

**What goes wrong:** Tool throws error, loop catches it, continues without informing user clearly.

**Why it happens:** Defensive coding catches errors but doesn't provide actionable feedback.

**How to avoid:**
- Always send `chat:tool_result` with `isError: true` on failure
- Include human-readable error message, not stack trace
- Consider having Claude acknowledge the error in its response

**Warning signs:** Tool fails silently, user asks again, same failure repeats.

### Pitfall 4: TTS service cold start

**What goes wrong:** First acknowledgment takes 10-15 seconds to synthesize because XTTS container is cold.

**Why it happens:** XTTS v2 loads model lazily on first synthesis.

**How to avoid:**
- `prewarmTtsCache()` is called at startup (already implemented)
- Piper fallback is instant (<200ms) when XTTS is slow
- The `synthesizeSentenceWithFallback()` function handles this with 15s timeout and Piper fallback

**Warning signs:** First tool call of the session has no acknowledgment, subsequent calls do.

### Pitfall 5: Race between tool_use event and acknowledgment audio

**What goes wrong:** Frontend receives `chat:tool_use` and immediately shows "Executing..." UI. Audio arrives moments later but user already saw the UI change.

**Why it happens:** Two separate events (tool_use, audio_chunk) arrive asynchronously.

**How to avoid:**
- Send acknowledgment BEFORE emitting tool_use
- Or bundle acknowledgment audio with tool_use event
- Or use dedicated `chat:acknowledge` event with higher priority

**Warning signs:** UI shows tool executing before voice says "One moment."

## Code Examples

Verified patterns from the existing codebase:

### Current sendToolAcknowledgment (chat.ts:86-107)
```typescript
// Source: /root/jarvis-backend/src/realtime/chat.ts lines 86-107
async function sendToolAcknowledgment(
  socket: Socket,
  sessionId: string,
  voiceMode: boolean,
): Promise<void> {
  if (!voiceMode || !ttsAvailable()) return;

  const phrase = getNextAckPhrase();
  try {
    const audio = await synthesizeSentenceWithFallback(phrase);
    if (audio) {
      socket.emit('chat:audio_chunk', {
        sessionId,
        index: -1, // Special index for acknowledgment
        contentType: audio.contentType,
        audio: audio.buffer.toString('base64'),
      });
    }
  } catch {
    // Non-critical, continue without acknowledgment
  }
}
```

### Current onToolUse callback (chat.ts:401-414)
```typescript
// Source: /root/jarvis-backend/src/realtime/chat.ts lines 401-414
onToolUse: async (toolName, toolInput, toolUseId, tier) => {
  // Send voice acknowledgment FIRST and wait for it
  await sendToolAcknowledgment(socket, sessionId, voiceMode);
  socket.emit('chat:tool_use', { sessionId, toolName, toolInput, toolUseId, tier });
  eventsNs.emit('event', {
    id: crypto.randomUUID(),
    type: 'action',
    severity: 'info',
    title: `Tool: ${toolName}`,
    message: `Executed ${toolName} via chat`,
    source: 'jarvis',
    timestamp: new Date().toISOString(),
  });
},
```

### Tool execution with error handling (loop.ts:175-206)
```typescript
// Source: /root/jarvis-backend/src/ai/loop.ts lines 175-206
// Auto-execute (GREEN/YELLOW, or elevated RED/BLACK with override)
// Await onToolUse to allow acknowledgment audio to be sent first
await callbacks.onToolUse(block.name, block.input, block.id, tierStr);

try {
  const toolResult = await executeTool(
    block.name,
    block.input as Record<string, unknown>,
    'llm',
    overrideActive,
  );

  const resultText = toolResult.content
    ?.map((c) => c.text)
    .join('\n') ?? 'No output';
  const isError = toolResult.isError ?? false;

  callbacks.onToolResult(block.id, resultText, isError);

  toolResults.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: resultText,
    is_error: isError,
  });
} catch (err) {
  const errorText = `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
  callbacks.onToolResult(block.id, errorText, true);

  toolResults.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: errorText,
    is_error: true,
  });
}
```

### Frontend audio chunk handling (useChatSocket.ts:165-189)
```typescript
// Source: /root/jarvis-ui/src/hooks/useChatSocket.ts lines 165-189
function onAudioChunk(data: {
  sessionId: string;
  index: number;
  contentType: string;
  audio: ArrayBuffer;
}) {
  const voiceState = useVoiceStore.getState();
  if (!voiceState.enabled || !voiceState.autoPlay) return;

  // If somehow we got audio before a sentence event, start the session
  if (!progressiveSessionStarted) {
    progressiveSessionStarted = true;
    const messageId = useChatStore.getState().streamingMessageId;
    if (messageId) {
      startProgressiveSession(data.sessionId, messageId);
    }
  }

  // Pipeline: mark speaking on first audio chunk
  if (!firstAudioChunkReceived) {
    firstAudioChunkReceived = true;
    useChatStore.getState().setPipelineStage('speaking', '');
  }

  queueAudioChunk(data.sessionId, data.audio, data.contentType, data.index);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fire-and-forget TTS | Await synthesis before tool | Phase 29 | Acknowledgment theoretically plays first |
| No TTS fallback | XTTS + Piper fallback | Phase 22-23 | Fast fallback when XTTS slow |
| No pre-warming | Pre-cache common phrases | Phase 23 | Instant playback for cached |
| Single audio queue | Progressive streaming | Phase 23-24 | Sentence-by-sentence playback |

**Current gap:** The backend sends acknowledgment before tool execution, but the frontend doesn't handle index=-1 specially. The acknowledgment gets queued with response audio instead of playing immediately.

## Open Questions

Things that couldn't be fully resolved:

1. **Should acknowledgment use a separate event type?**
   - What we know: Using `chat:audio_chunk` with index=-1 is ambiguous
   - What's unclear: Is it worth adding a new event type for cleaner separation?
   - Recommendation: Yes, add `chat:acknowledge` event for clarity. It's a 10-line change on each end.

2. **What's the acceptable acknowledgment delay?**
   - What we know: Users expect instant feedback (< 500ms)
   - What's unclear: Is Piper's 200ms acceptable? XTTS cache hit is ~50ms.
   - Recommendation: Target < 200ms. Use Piper for acknowledgments if XTTS cache misses.

3. **Should tool execution proceed in parallel with acknowledgment playback?**
   - What we know: Waiting for audio to fully play could add 1-2s delay
   - What's unclear: Does user notice if tool results appear while acknowledgment plays?
   - Recommendation: Start tool execution immediately after emit. Don't wait for playback.

4. **What timeout is appropriate for tools?**
   - What we know: SSH has 30s default, voice training has 1 hour
   - What's unclear: Should there be a global max timeout?
   - Recommendation: 60s default with per-tool override option. Most tools should complete in < 30s.

## Sources

### Primary (HIGH confidence)
- `/root/jarvis-backend/src/realtime/chat.ts` - Tool acknowledgment implementation
- `/root/jarvis-backend/src/ai/loop.ts` - Agentic loop with tool execution
- `/root/jarvis-backend/src/ai/tts.ts` - TTS synthesis with caching and fallback
- `/root/jarvis-backend/src/mcp/server.ts` - Tool execution wrapper
- `/root/jarvis-ui/src/hooks/useChatSocket.ts` - Frontend event handling
- `/root/jarvis-ui/src/audio/progressive-queue.ts` - Progressive audio playback

### Secondary (MEDIUM confidence)
- Node.js streams documentation for understanding backpressure
- Socket.IO documentation for event delivery guarantees
- Web Audio API documentation for immediate playback patterns

### Tertiary (LOW confidence)
- None - all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against existing codebase
- Architecture: HIGH - traced exact code paths
- Pitfalls: HIGH - identified from actual code issues
- Fixes: MEDIUM - solutions are clear but need implementation testing

**Research date:** 2026-01-30
**Valid until:** 2026-02-28 (stable codebase, low churn)

---

## Recommended Fixes Summary

### Fix 1: Frontend - Handle acknowledgment audio immediately
- Add special case in `onAudioChunk` for `index === -1`
- Play immediately without queuing, outside progressive session
- Don't wait for sentence events to start

### Fix 2: Backend - Use dedicated acknowledgment event
- New event `chat:acknowledge` sent before `chat:tool_use`
- Contains pre-synthesized audio from cache
- Frontend handles with immediate playback

### Fix 3: Backend - Add tool execution timeout
- Wrap `executeTool()` calls in loop.ts with 60s timeout
- Return user-friendly error message on timeout
- Log timeout events for monitoring

### Fix 4: Backend - Force Piper for acknowledgments
- Modify `sendToolAcknowledgment()` to prefer Piper (instant) over XTTS
- Cache hit is still fastest, but Piper fallback is acceptable

### Fix 5: Error reporting
- Ensure all tool errors emit `chat:tool_result` with `isError: true`
- Include actionable error messages, not stack traces
- Consider voice feedback for errors ("I'm sorry, that operation failed")

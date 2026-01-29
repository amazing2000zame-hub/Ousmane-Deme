# Phase 25: Chat Virtualization -- Research

**Phase Goal:** Users can scroll through long chat histories (100+ messages) without UI lag or frame drops

**Milestone:** v1.5 Optimization & Latency Reduction (final phase)

**Status:** Research complete

---

## Current Architecture Analysis

### ChatPanel.tsx (Current Implementation)

**Rendering Approach:**
- Flat list: messages.map rendering all ChatMessage components
- No windowing or virtualization
- Scroll container with overflow-y-auto

**Performance Optimizations Already Present:**
- React.memo on ChatMessage (PERF-09)
- Streaming content optimization (PERF-07) - O(1) token append
- Manual scroll detection (PERF-10) - userScrolledUpRef
- Throttled auto-scroll

**Auto-scroll Logic:**
- Fires when messages.length or streamingContent changes
- Respects manual scroll-up via userScrolledUpRef flag
- Uses smooth scrolling
- Threshold: 100px from bottom

### ChatMessage.tsx

**Variable-Height Content:**
- Text content with whitespace-pre-wrap
- Tool calls with multiple card types (ConfirmCard, BlockedCard, ToolStatusCard)
- Provider badge + voice button in header
- Already wrapped in React.memo

### chat.ts Store

**State Structure:**
- messages: ChatMessage[] - Flat array, no pagination
- streamingContent: string - Separate for O(1) append
- No message index by ID
- All messages loaded into memory

---

## Performance Problems at 100+ Messages

1. **DOM Node Overhead** - 500-1500 DOM nodes in scroll container
2. **React Re-render Cost** - Reconciliation overhead on every scroll/stream
3. **Scroll Performance** - Smooth scrolling calculates positions for all messages
4. **Memory Usage** - All message content held in memory

---

## Implementation Strategy: react-window

**Decision:** Use react-window VariableSizeList with custom auto-scroll

**Rationale:**
- Smallest bundle size (34KB gzipped)
- Mature, battle-tested library
- VariableSizeList handles variable-height messages
- No breaking changes to ChatMessage needed

**Implementation Plan:**
1. Install react-window + types
2. Create useMessageHeights hook for height tracking
3. Create useSmoothScroll hook for auto-scroll animation
4. Refactor ChatPanel to use VariableSizeList
5. Test with 100+ messages

**Success Criteria:**
- 60 FPS scroll on 100+ messages
- Auto-scroll works on new messages
- Manual scroll-up prevents auto-scroll
- Streaming content displays correctly
- No layout shifts

---

**Research Complete:** 2026-01-28
**Next Step:** Create Plan 25-01 and begin implementation

# Phase 31: Web UI Redesign - Research

**Researched:** 2026-01-30
**Domain:** React Dashboard UI, Tailwind CSS Responsive Layouts, Camera Integration
**Confidence:** HIGH

## Summary

This research investigates the current state of the Jarvis UI codebase to identify layout issues, understand the inline camera integration, and document best practices for responsive dashboard design. The existing codebase is well-structured with a 3-column grid layout, CSS variable-based theming (Phase 20), and component patterns that follow React best practices.

Key findings indicate that the inline camera feature is fully implemented but may have integration issues where the backend triggers camera display. The responsive grid has defined breakpoints but may need refinement for tablet/desktop edge cases. Tool output rendering uses expandable cards with truncation that could benefit from polish.

**Primary recommendation:** Focus on auditing specific layout glitches through browser testing, then implement camera dismissal (success criteria #5) as the main missing feature, followed by responsive breakpoint refinement.

## Standard Stack

The existing stack is well-suited for this phase. No new libraries needed.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.x | UI framework | Already in use, latest version |
| Tailwind CSS | 4.x | Utility-first styling | Already configured with custom theme |
| Zustand | 5.x | State management | Lightweight, already used for all stores |
| video-rtc.js | 1.6.0 | go2rtc MSE streaming | Web component for live camera feeds |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Socket.IO Client | 4.x | Real-time events | Already used for chat:show_live_feed |
| Vite | 6.x | Build tooling | Already configured |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tailwind grid | CSS Grid directly | Tailwind already provides responsive utilities; no change needed |
| Custom modal | react-aria useModalOverlay | Would add accessibility but more complexity; native approach works |

**Installation:**
No new dependencies required. All tools already in place.

## Architecture Patterns

### Current Project Structure (No Changes Needed)
```
jarvis-ui/src/
├── components/
│   ├── layout/           # Dashboard.tsx, TopBar.tsx, PanelFrame.tsx
│   ├── center/           # ChatPanel.tsx, ChatMessage.tsx, InlineCameraCard.tsx
│   ├── camera/           # CameraPanel.tsx, LiveStreamModal.tsx
│   ├── left/             # NodeGrid.tsx, VMList.tsx, StoragePanel.tsx
│   └── right/            # TerminalPanel.tsx, CostPanel.tsx
├── stores/               # Zustand stores (chat.ts, camera.ts, etc.)
├── hooks/                # useChatSocket.ts, useCameraPolling.ts
└── index.css             # CSS variables, @theme block
```

### Pattern 1: 3-Column Responsive Grid (Existing)
**What:** Desktop shows 3 columns (left infra, center HUD/chat, right terminal). Tablet drops to 2 columns. Mobile stacks vertically.
**When to use:** Always - this is the primary layout.
**Example (from Dashboard.tsx):**
```typescript
// Source: jarvis-ui/src/components/layout/Dashboard.tsx lines 41-46
<div className="jarvis-grid flex-1 min-h-0 grid
  max-md:grid-cols-1
  md:grid-cols-[300px_1fr]
  lg:grid-cols-[280px_1fr_320px]
  xl:grid-cols-[320px_1fr_380px]"
>
```

### Pattern 2: Inline Camera in Chat Messages
**What:** When backend emits `chat:show_live_feed`, the chat store sets `inlineCamera` on the current assistant message. ChatMessage renders InlineCameraCard conditionally.
**When to use:** When user asks to see a camera.
**Current implementation:**
```typescript
// Source: jarvis-ui/src/hooks/useChatSocket.ts lines 248-258
function onShowLiveFeed(data: { camera: string; timestamp: string }) {
  console.log('[Chat] Received show_live_feed:', data.camera);
  useChatStore.getState().setInlineCamera(data);
}

function onCloseLiveFeed() {
  console.log('[Chat] Received close_live_feed');
  useChatStore.getState().clearInlineCamera();
}
```

### Pattern 3: Modal Dismissal
**What:** LiveStreamModal closes on backdrop click, X button, or Escape key.
**When to use:** Full-screen camera view in Camera tab.
**Example (from LiveStreamModal.tsx):**
```typescript
// Source: jarvis-ui/src/components/camera/LiveStreamModal.tsx lines 20-31
const handleKeyDown = useCallback(
  (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  },
  [onClose]
);

useEffect(() => {
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [handleKeyDown]);
```

### Anti-Patterns to Avoid
- **Hardcoded pixel breakpoints in components:** Use Tailwind's responsive prefixes (sm:, md:, lg:, xl:) instead of inline media queries
- **Inline styles for themeable values:** Use CSS variables from index.css @theme block
- **Direct DOM manipulation in React:** Use refs and state; video-rtc.js is an exception as a web component

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Click outside to close | Custom event listener | stopPropagation + backdrop onClick | Already implemented in LiveStreamModal |
| Responsive grid | Custom CSS | Tailwind grid-cols with breakpoints | Already configured, well-tested |
| Video streaming | Custom WebSocket player | video-rtc.js web component | Handles MSE/WebRTC/HLS fallback |
| Escape key handling | Window event listener | useCallback + useEffect pattern | Memory-safe cleanup pattern |
| CSS variable theming | Hardcoded colors | @theme block in index.css | Already has 5 color themes |

**Key insight:** The existing codebase has good patterns. The work is polish, not rebuild.

## Common Pitfalls

### Pitfall 1: Missing Camera Dismissal for Inline Display
**What goes wrong:** InlineCameraCard has `onClose` prop but it's never passed from ChatMessage
**Why it happens:** The feature was implemented but the close handler wasn't wired up
**How to avoid:** Pass `onClose={() => clearInlineCamera()}` from ChatMessage to InlineCameraCard
**Warning signs:** Camera feed stays in chat even after user wants to dismiss it

### Pitfall 2: Video Stream Cleanup on Unmount
**What goes wrong:** WebSocket connections to go2rtc may linger if component unmounts without cleanup
**Why it happens:** video-rtc.js manages its own WebSocket; setting `el.src = ''` triggers disconnect
**How to avoid:** Always set `el.src = ''` in useEffect cleanup function
**Warning signs:** Console errors about WebSocket connections, memory leaks

### Pitfall 3: Responsive Layout Breakpoint Gaps
**What goes wrong:** UI looks broken at certain screen widths between breakpoints
**Why it happens:** Tailwind breakpoints (md:768px, lg:1024px, xl:1280px) may not cover all devices
**How to avoid:** Test at widths just above and below each breakpoint; add intermediate breakpoints if needed
**Warning signs:** Overlapping elements, truncated content, horizontal scrolling

### Pitfall 4: Z-Index Conflicts with Modals
**What goes wrong:** Modal backdrop appears behind other content, or content bleeds through
**Why it happens:** Stacking context issues with fixed/absolute positioning
**How to avoid:** LiveStreamModal uses z-50; ensure no parent has z-index that creates new stacking context
**Warning signs:** Modal content hidden behind other panels

### Pitfall 5: Tool Output Overflow
**What goes wrong:** Long tool results break layout or cause horizontal scroll
**Why it happens:** Pre-formatted text without word-wrap, or large JSON objects
**How to avoid:** ToolStatusCard already has `max-h-40 overflow-y-auto` for expanded results; ensure `break-words` and `whitespace-pre-wrap` are applied
**Warning signs:** Chat panel becomes wider than viewport, horizontal scrollbar appears

## Code Examples

Verified patterns from the existing codebase:

### Camera Dismissal (Missing - To Implement)
```typescript
// In ChatMessage.tsx, add close handler to InlineCameraCard:
{message.inlineCamera && (
  <InlineCameraCard
    camera={message.inlineCamera.camera}
    onClose={() => useChatStore.getState().clearInlineCamera()}
  />
)}
```

### Responsive Grid with Terminal Collapse
```typescript
// Source: jarvis-ui/src/components/layout/Dashboard.tsx lines 26-33
// Dynamic CSS for collapsed terminal state
<style>{`
  @media (min-width: 1280px) {
    .jarvis-grid { grid-template-columns: 320px 1fr ${rightXl} !important; }
  }
  @media (min-width: 1024px) and (max-width: 1279px) {
    .jarvis-grid { grid-template-columns: 280px 1fr ${rightLg} !important; }
  }
`}</style>
```

### Backdrop Click to Close Modal
```typescript
// Source: jarvis-ui/src/components/camera/LiveStreamModal.tsx lines 63-71
<div
  className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
  onClick={onClose}
>
  <div
    className="relative max-w-5xl w-full mx-4"
    onClick={(e) => e.stopPropagation()}  // Prevent close when clicking content
  >
```

### CSS Variable-Based Theming
```css
/* Source: jarvis-ui/src/index.css lines 4-56 */
@theme {
  --color-jarvis-amber: #ffb800;
  --color-jarvis-bg: #0a0a0f;
  --color-jarvis-bg-panel: #0d0d14;
  /* ... */
  --shadow-jarvis-glow: 0 0 15px rgba(255, 184, 0, 0.4);
}

/* Theme switching via data attribute */
[data-theme="cyan"] {
  --color-jarvis-amber: #00d4ff;
  /* ... */
}
```

### Expandable Tool Output
```typescript
// Source: jarvis-ui/src/components/center/ToolStatusCard.tsx lines 54-65
{hasPreview && !expanded && (
  <p className="text-[10px] font-mono text-jarvis-text-muted mt-0.5 truncate">
    {result.slice(0, 80)}{result.length > 80 ? '...' : ''}
  </p>
)}
{hasPreview && expanded && (
  <pre className="text-[10px] font-mono text-jarvis-text-muted mt-1 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
    {result}
  </pre>
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 config | Tailwind v4 @theme block | Phase 20 | CSS variables in index.css, no tailwind.config.js |
| px-based breakpoints | Responsive utilities | Already in use | sm/md/lg/xl prefixes work correctly |
| Separate modal component | In-chat inline display | Phase 26-29 | InlineCameraCard for embedded streams |

**Deprecated/outdated:**
- No deprecated patterns identified. The codebase is current.

## Identified Issues (From Code Audit)

### 1. Inline Camera Close Handler Not Wired
**Location:** `ChatMessage.tsx` line 139
**Issue:** `InlineCameraCard` receives no `onClose` prop, so cameras cannot be dismissed
**Fix:** Pass `onClose={() => useChatStore.getState().clearInlineCamera()}`

### 2. Voice Dismissal Not Implemented
**Location:** Not implemented anywhere
**Issue:** Success criteria #5 says camera should be dismissable via voice command
**Fix:** Backend needs to handle "close camera" / "dismiss" / "stop showing" intents and emit `chat:close_live_feed`

### 3. InlineCameraCard Loading Overlay Persistence
**Location:** `InlineCameraCard.tsx` lines 92-102
**Issue:** Loading overlay polls every 500ms but may not hide if stream connects slowly
**Fix:** Add timeout or more reliable connection state from video-rtc.js

### 4. Potential Tablet Layout Gap
**Location:** `Dashboard.tsx` lines 43-46
**Issue:** At exactly 768px (md breakpoint), layout jumps from 1 column to 2; this could be abrupt
**Fix:** Test and potentially add an intermediate breakpoint or adjust the md:grid-cols definition

### 5. Terminal Collapse Causes Grid Jump
**Location:** `Dashboard.tsx` lines 17-19, 26-33
**Issue:** When terminal collapses, the grid-template-columns changes via injected `<style>` tag. This is a workaround for Tailwind's inability to handle dynamic column widths.
**Assessment:** Works but is unconventional. Not a bug, but could be simplified if Tailwind v4 supports CSS-in-JS style variables natively.

## Open Questions

Things that couldn't be fully resolved:

1. **What specific layout glitches exist?**
   - What we know: The issue description mentions "layout issues" but doesn't specify
   - What's unclear: Actual bugs require browser testing to identify
   - Recommendation: Create an audit checklist and test in Chrome/Firefox at various widths

2. **Are there z-index stacking issues?**
   - What we know: LiveStreamModal uses z-50, TopBar settings dropdown uses z-50
   - What's unclear: Whether these ever conflict in practice
   - Recommendation: Test modal opening while settings dropdown is open

3. **Does inline camera work end-to-end?**
   - What we know: Frontend code is in place; backend emits `chat:show_live_feed` from `show_live_feed` tool
   - What's unclear: Whether the flow has been tested recently
   - Recommendation: Test with "show me the front door camera" command

## Sources

### Primary (HIGH confidence)
- `jarvis-ui/src/components/layout/Dashboard.tsx` - Main grid layout
- `jarvis-ui/src/components/center/ChatMessage.tsx` - Chat message with inline camera
- `jarvis-ui/src/components/center/InlineCameraCard.tsx` - Inline camera component
- `jarvis-ui/src/components/camera/LiveStreamModal.tsx` - Modal camera patterns
- `jarvis-ui/src/hooks/useChatSocket.ts` - Socket event handlers
- `jarvis-ui/src/stores/chat.ts` - InlineCamera state management
- `jarvis-ui/src/index.css` - CSS variable definitions

### Secondary (MEDIUM confidence)
- [Tailwind CSS Grid Docs](https://tailwindcss.com/docs/grid-template-columns) - Responsive grid patterns
- [React Aria Modal](https://react-spectrum.adobe.com/react-aria/Modal.html) - Accessibility patterns
- [Jayse Hansen Iron Man HUD Portfolio](https://jayse.tv/v2/?portfolio=hud-2-2) - HUD design inspiration

### Tertiary (LOW confidence)
- Web search results on React dashboard best practices - General patterns only

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Examined actual package.json and source files
- Architecture: HIGH - Audited all relevant components directly
- Pitfalls: MEDIUM - Based on code review, not production bug reports
- Identified issues: HIGH - Direct code inspection

**Research date:** 2026-01-30
**Valid until:** 2026-03-01 (stable codebase, no major framework updates expected)

## Planning Recommendations

Based on this research, recommend organizing Phase 31 into:

**31-01: UI Audit & Layout Bug Fixes**
- Create browser testing checklist for all breakpoints
- Identify and fix any layout glitches
- Test z-index conflicts
- Verify responsive behavior at md/lg/xl transitions

**31-02: Inline Camera Polish**
- Wire up camera dismissal (click close button)
- Add voice dismissal support (backend intent handling)
- Fix loading overlay persistence
- Test end-to-end camera flow

**31-03: Dashboard Component Polish**
- Refine tool output rendering for better readability
- Polish camera panel layout
- Ensure consistent spacing and borders
- Add any missing hover/focus states

Total estimated effort: 2-3 plans, medium complexity

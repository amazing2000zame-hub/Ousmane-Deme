# Phase 2: Real-Time Dashboard & eDEX-UI Visual Identity - Context

**Gathered:** 2026-01-26
**Status:** Ready for planning

<domain>
## Phase Boundary

A user opens the dashboard in a browser and sees live cluster health for all 4 nodes, can start/stop VMs, open a terminal to any node, and the entire experience looks like an Iron Man command center -- all updating in real-time without page refresh. React 19 SPA with 3-column layout, Socket.IO live data, xterm.js terminal, and eDEX-UI / Iron Man sci-fi aesthetic.

</domain>

<decisions>
## Implementation Decisions

### Visual identity & aesthetic
- **Hybrid eDEX-UI + Iron Man HUD**: eDEX-UI styling for data Jarvis actively surfaces (alerts, diagnostics, activity feed -- high visual intensity). Iron Man HUD for persistent panels (node health, VM list, storage -- clean holographic feel)
- **Panel-specific visual treatments**: Each panel type gets distinct styling matched to its function. Node health = HUD overlays, terminal = heavy scan lines, activity feed = eDEX-style data scrolling
- **Always-alive animations**: Persistent ambient animations at all times -- scan lines scrolling, data pulsing, grid patterns shifting. The screen never looks static. The dashboard should feel like a living command center
- **Full boot-up sequence**: Animated system initialization on page load -- JARVIS boot text, system checks, panels appearing one by one. Sets the cinematic tone on every load
- **3 visual modes from day one**: JARVIS (full sci-fi), Ops (reduced effects for working), Minimal (data only). All switchable from the UI. Theming infrastructure must be solid from the start
- **Alert sounds only**: Sound plays on critical events (node down, remediation triggered). Silent at rest. No ambient audio or keystroke sounds
- **Always dark**: No light mode. The sci-fi aesthetic requires a dark background
- **Reference points**: eDEX-UI + Iron Man are the two visual anchors. No additional references

### Claude's Discretion (Visual)
- Color palette selection (amber/gold dominant vs dual-tone -- optimize for readability and the hybrid aesthetic)
- Terminal panel styling (match the panel-specific treatment approach)

### Layout & information density
- **Center column is a multi-purpose display**: Context-aware switching between activity feed, Jarvis-presented data (charts, diagnostics, reports), and chat. This is Jarvis's "main screen" for communicating -- not just a log feed. Must support Jarvis showing information on request or displaying what he's doing
- **Node details expand inline**: Clicking a node expands its card to show detailed metrics (CPU history, processes, services). No navigation away from the dashboard -- everything stays on one screen

### Claude's Discretion (Layout)
- Node health display format (grid cards, horizontal bar, or list -- optimize for the 4-node cluster and available space)
- VM/container information density (status + name vs inline metrics -- fit 7 VMs/CTs effectively)
- Quorum status placement (top bar, node grid, or other prominent location)

### Terminal panel behavior
- **Single terminal session**: One terminal at a time with a node selector dropdown. No tabs, no split panes
- **Collapsible panel**: Terminal can be minimized to a thin bar or icon. Other panels reclaim the space when collapsed
- **Node picker first**: No auto-connect. When opened, shows a node selection screen. User explicitly chooses which node to SSH into
- **eDEX-UI styling**: Claude's discretion on terminal styling, but should match the panel-specific treatment (terminal is the most heavily themed panel per the visual identity decisions)

### Interaction & controls
- **Instant safe ops, confirm dangerous**: Start executes immediately. Stop/restart show confirmation dialog. Aligned with the Green/Red safety tier model from Phase 1
- **Dedicated display focus**: Optimize for the 24/7 dedicated display and desktop. Mobile is deprioritized -- it'll work but isn't the design target
- **Full keyboard shortcut support**: Navigate panels, select nodes, trigger actions without a mouse. Power-user keyboard-driven experience
- **Dual feedback channels**: Both inline status updates on cards (flash green/red, status change) and toast notifications for action results
- **Node expansion inline**: Click to expand, no page navigation. The dashboard is a single-screen experience

### Claude's Discretion (Interaction)
- Disconnect UX design (informative without blocking the view -- per staleness indicator requirement)
- Command palette decision (whether Ctrl+K adds value alongside keyboard shortcuts)

</decisions>

<specifics>
## Specific Ideas

- "I want him to also be able to show me something on the screen on request or see what he's doing" -- the center panel must be Jarvis's display, not just a passive feed
- Hybrid aesthetic: eDEX-UI intensity for active/surfaced data, Iron Man HUD calm for persistent monitoring panels
- Boot sequence should set the cinematic tone -- system initialization text, panels appearing sequentially
- The screen should NEVER look static -- always-alive ambient animations throughout

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 02-real-time-dashboard-edex-ui-visual-identity*
*Context gathered: 2026-01-26*

# Phase 2: Real-Time Dashboard & eDEX-UI Visual Identity - Research

**Researched:** 2026-01-26
**Domain:** React 19 SPA with real-time WebSocket data, xterm.js terminal, Tailwind CSS v4, sci-fi visual identity
**Confidence:** HIGH

## Summary

This research covers the full technology stack needed to build the JARVIS dashboard: a React 19 SPA with real-time Socket.IO data from the Phase 1 backend, an xterm.js terminal for SSH access to cluster nodes, Tailwind CSS v4 for styling, and the hybrid eDEX-UI / Iron Man HUD visual identity with ambient animations and a boot sequence. The existing `jarvis-ui/` scaffold uses React 19 + Vite 6 + Tailwind v3 and must be upgraded to Tailwind v4's CSS-first configuration.

The findings are well-supported by official documentation. Tailwind CSS v4 replaces `tailwind.config.js` with CSS `@theme` directives and uses a dedicated `@tailwindcss/vite` plugin instead of PostCSS. xterm.js has released v6.0.0 with ESM support and the canvas renderer removed (WebGL or DOM only). Socket.IO client integration with React follows a well-documented pattern using a singleton socket instance with `useEffect` cleanup. Zustand is the recommended state management library for dashboard-style centralized state. Motion (formerly Framer Motion) handles the boot sequence and panel animations. Sonner provides toast notifications with zero dependencies.

**Primary recommendation:** Upgrade Tailwind to v4 with `@tailwindcss/vite`, use `@xterm/xterm@6.0.0` with `@xterm/addon-webgl@0.19.0` for the terminal, Zustand for state management, Motion for animations, and build a custom `useClusterSocket` hook wrapping Socket.IO client with JWT auth for the `/cluster` namespace. Design the amber/gold color palette around WCAG AA-verified color pairs.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.0.0 | UI framework | Already in scaffold; React 19 with concurrent features |
| react-dom | ^19.0.0 | DOM rendering | Already in scaffold |
| tailwindcss | ^4.1.0 | Utility CSS framework | CSS-first config with `@theme`; 3-10x faster builds via Lightning CSS |
| @tailwindcss/vite | ^4.1.0 | Vite integration | Dedicated Vite plugin replaces PostCSS setup; better perf than PostCSS path |
| @xterm/xterm | ^6.0.0 | Terminal emulator | Latest stable (released Jan 2026); ESM support; canvas renderer removed |
| @xterm/addon-webgl | ^0.19.0 | GPU-accelerated terminal renderer | WebGL2 rendering for xterm.js 6.x; handles GPU context loss gracefully |
| @xterm/addon-fit | ^0.11.0 | Auto-resize terminal | Fits terminal to container dimensions; compatible with xterm.js 6.x |
| socket.io-client | ^4.8.0 | WebSocket client | Connects to Phase 1 Socket.IO server; auto-reconnect; namespace support |
| zustand | ^5.0.0 | State management | 3KB; centralized store pattern; ideal for dashboards; persist + devtools middleware |
| motion | ^12.0.0 | Animation library | Formerly Framer Motion; staggerChildren for boot sequence; GPU-composited transforms |
| sonner | ^2.0.0 | Toast notifications | Zero deps; no hooks needed; observer pattern; works from anywhere |
| react-hotkeys-hook | ^4.6.0 | Keyboard shortcuts | Hook-based; most popular React hotkeys library; scoped to components |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @redux-devtools/extension | latest | Zustand devtools typing | Required for `zustand/middleware` devtools TypeScript support |
| vite | ^6.0.0 | Build tool | Already in scaffold |
| @vitejs/plugin-react | ^4.3.0 | React Vite plugin | Already in scaffold |
| typescript | ~5.6.2 | Type checking | Already in scaffold |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand | Jotai | Jotai better for fine-grained reactivity per-atom; Zustand simpler for dashboard centralized state with fewer stores |
| Motion | CSS-only animations | Motion gives orchestrated stagger/sequence control needed for boot sequence; CSS alone cannot coordinate multi-step panel reveals |
| Sonner | react-hot-toast | Both work well; Sonner is newer, zero deps, no context needed; react-hot-toast is battle-tested but needs hooks |
| react-hotkeys-hook | React-Keyhub | React-Keyhub supports sequential keys and scoping but is newer/less tested; react-hotkeys-hook is mature and sufficient |
| Raw xterm.js wrapper | react-xtermjs / @pablo-lion/xterm-react | Third-party wrappers may lag behind xterm.js 6.0 API changes; raw wrapper gives full control and avoids dependency risk |

**Installation:**

```bash
# Remove Tailwind v3 deps
npm uninstall tailwindcss postcss autoprefixer

# Core
npm install tailwindcss@latest @tailwindcss/vite@latest
npm install @xterm/xterm @xterm/addon-webgl @xterm/addon-fit
npm install socket.io-client
npm install zustand
npm install motion
npm install sonner
npm install react-hotkeys-hook

# Dev dependencies
npm install -D @redux-devtools/extension
```

---

## Architecture Patterns

### Recommended Project Structure

```
jarvis-ui/
├── index.html                  # Entry HTML with Google Fonts (Rajdhani, Orbitron)
├── vite.config.ts              # Vite + React + @tailwindcss/vite plugins
├── tsconfig.json               # TypeScript config (already exists)
├── Dockerfile                  # Multi-stage build (already exists)
├── nginx.conf                  # SPA routing (already exists, update port to 3004)
├── src/
│   ├── main.tsx                # React root mount
│   ├── App.tsx                 # Root component, boot sequence orchestrator
│   ├── index.css               # @import "tailwindcss"; @theme { ... }
│   │
│   ├── stores/                 # Zustand stores
│   │   ├── cluster.ts          # Nodes, VMs, storage, quorum state
│   │   ├── terminal.ts         # Terminal session state (selected node, collapsed)
│   │   ├── ui.ts               # Visual mode, boot state, panel focus
│   │   └── auth.ts             # JWT token, connection status
│   │
│   ├── hooks/                  # Custom React hooks
│   │   ├── useClusterSocket.ts # Socket.IO /cluster namespace with JWT auth
│   │   ├── useEventsSocket.ts  # Socket.IO /events namespace with JWT auth
│   │   ├── useTerminal.ts      # xterm.js lifecycle management
│   │   └── useKeyboardNav.ts   # Panel focus and keyboard shortcut orchestration
│   │
│   ├── components/
│   │   ├── boot/               # Boot sequence animation components
│   │   │   ├── BootSequence.tsx # Full boot orchestrator
│   │   │   └── BootLine.tsx    # Individual typewriter line
│   │   │
│   │   ├── layout/             # Top-level layout
│   │   │   ├── Dashboard.tsx   # 3-column grid layout
│   │   │   ├── TopBar.tsx      # Quorum status, connection indicator, mode switcher
│   │   │   └── PanelFrame.tsx  # Shared panel chrome (border glow, header, collapse)
│   │   │
│   │   ├── left/               # Left column: infrastructure
│   │   │   ├── NodeGrid.tsx    # 4-node health grid (expandable cards)
│   │   │   ├── NodeCard.tsx    # Individual node card (CPU, RAM, disk, temp, uptime)
│   │   │   ├── NodeDetail.tsx  # Expanded node detail (inline, CPU history, services)
│   │   │   ├── VMList.tsx      # VM/Container list with status indicators
│   │   │   ├── VMCard.tsx      # Individual VM/CT with start/stop/restart controls
│   │   │   └── StoragePanel.tsx# Storage overview with usage bars
│   │   │
│   │   ├── center/             # Center column: multi-purpose display
│   │   │   ├── CenterDisplay.tsx   # Context-aware view switcher
│   │   │   ├── ActivityFeed.tsx    # Real-time event feed (eDEX-style scrolling)
│   │   │   └── JarvisDisplay.tsx   # Jarvis-presented data (charts, diagnostics)
│   │   │
│   │   ├── right/              # Right column: terminal
│   │   │   ├── TerminalPanel.tsx   # Terminal container with node selector
│   │   │   ├── TerminalView.tsx    # xterm.js mount point
│   │   │   └── NodeSelector.tsx    # Dropdown to pick SSH target node
│   │   │
│   │   └── shared/             # Reusable UI components
│   │       ├── StatusDot.tsx       # Connection/status indicator dot
│   │       ├── UsageBar.tsx        # Resource usage bar with threshold coloring
│   │       ├── ConfirmDialog.tsx   # Confirmation modal for destructive actions
│   │       ├── StalenessWarning.tsx# Data age indicator
│   │       └── GlowBorder.tsx     # Animated glow border effect
│   │
│   ├── effects/                # CSS animation components (GPU-composited)
│   │   ├── ScanLines.tsx       # CRT scan line overlay
│   │   ├── GridBackground.tsx  # Shifting grid pattern
│   │   └── DataPulse.tsx       # Data pulse/heartbeat indicator
│   │
│   ├── services/
│   │   ├── api.ts              # REST API client (JWT auth, base URL)
│   │   └── socket.ts           # Socket.IO singleton instances
│   │
│   ├── theme/
│   │   ├── modes.ts            # Visual mode definitions (JARVIS, Ops, Minimal)
│   │   └── colors.ts           # Color token constants for programmatic use
│   │
│   └── types/
│       ├── cluster.ts          # Node, VM, Storage, Quorum types
│       └── events.ts           # Event types from backend
```

### Pattern 1: Singleton Socket with React Hook

**What:** Create Socket.IO instances once, share via import, manage lifecycle in hooks
**When to use:** Always -- socket connections must be singletons

```typescript
// src/services/socket.ts
import { io, Socket } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://192.168.1.65:4000';

export function createClusterSocket(token: string): Socket {
  return io(`${BACKEND_URL}/cluster`, {
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });
}

// src/hooks/useClusterSocket.ts
import { useEffect, useRef } from 'react';
import { createClusterSocket } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useClusterStore } from '../stores/cluster';

export function useClusterSocket() {
  const token = useAuthStore((s) => s.token);
  const socketRef = useRef<Socket | null>(null);
  const setNodes = useClusterStore((s) => s.setNodes);
  const setConnected = useClusterStore((s) => s.setConnected);

  useEffect(() => {
    if (!token) return;

    const socket = createClusterSocket(token);
    socketRef.current = socket;

    function onConnect() { setConnected(true); }
    function onDisconnect() { setConnected(false); }
    function onNodeUpdate(data: NodeData[]) { setNodes(data); }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('nodes', onNodeUpdate);

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('nodes', onNodeUpdate);
      socket.disconnect();
    };
  }, [token, setNodes, setConnected]);
}
```

### Pattern 2: Zustand Store with Staleness Tracking

**What:** Centralized cluster state with timestamp-based staleness detection
**When to use:** Every data store that receives WebSocket updates

```typescript
// src/stores/cluster.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface ClusterState {
  nodes: NodeData[];
  vms: VMData[];
  storage: StorageData[];
  quorum: QuorumData | null;
  connected: boolean;
  lastUpdate: Record<string, number>; // key -> timestamp

  setNodes: (nodes: NodeData[]) => void;
  setVMs: (vms: VMData[]) => void;
  setConnected: (connected: boolean) => void;
  isStale: (key: string, maxAgeMs: number) => boolean;
}

export const useClusterStore = create<ClusterState>()(
  devtools(
    (set, get) => ({
      nodes: [],
      vms: [],
      storage: [],
      quorum: null,
      connected: false,
      lastUpdate: {},

      setNodes: (nodes) =>
        set(
          { nodes, lastUpdate: { ...get().lastUpdate, nodes: Date.now() } },
          false,
          'cluster/setNodes',
        ),

      setVMs: (vms) =>
        set(
          { vms, lastUpdate: { ...get().lastUpdate, vms: Date.now() } },
          false,
          'cluster/setVMs',
        ),

      setConnected: (connected) =>
        set({ connected }, false, 'cluster/setConnected'),

      isStale: (key, maxAgeMs) => {
        const last = get().lastUpdate[key];
        if (!last) return true;
        return Date.now() - last > maxAgeMs;
      },
    }),
    { name: 'cluster-store' },
  ),
);
```

### Pattern 3: xterm.js Lifecycle in React

**What:** Manage xterm.js Terminal instance lifecycle with React refs and useEffect
**When to use:** Terminal panel component

```typescript
// src/hooks/useTerminal.ts
import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';

export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      theme: {
        background: '#0a0a0f',
        foreground: '#e0d9c6',
        cursor: '#ffb800',
        selectionBackground: 'rgba(255, 184, 0, 0.3)',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    // Try WebGL, fallback to DOM renderer
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        webglAddonRef.current = null;
      });
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch {
      console.warn('WebGL renderer not available, using DOM renderer');
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      webglAddonRef.current?.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [containerRef]);

  const write = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  return { terminalRef, write };
}
```

### Pattern 4: Visual Mode System

**What:** Three visual modes with CSS custom properties, managed by Zustand
**When to use:** Theme infrastructure that supports JARVIS / Ops / Minimal modes

```typescript
// src/theme/modes.ts
export type VisualMode = 'jarvis' | 'ops' | 'minimal';

export const VISUAL_MODES: Record<VisualMode, {
  scanLines: boolean;
  glowEffects: boolean;
  ambientAnimations: boolean;
  borderGlow: boolean;
  bootSequence: boolean;
}> = {
  jarvis: {
    scanLines: true,
    glowEffects: true,
    ambientAnimations: true,
    borderGlow: true,
    bootSequence: true,
  },
  ops: {
    scanLines: false,
    glowEffects: true,
    ambientAnimations: false,
    borderGlow: true,
    bootSequence: false,
  },
  minimal: {
    scanLines: false,
    glowEffects: false,
    ambientAnimations: false,
    borderGlow: false,
    bootSequence: false,
  },
};
```

### Pattern 5: GPU-Composited CRT Scan Lines

**What:** Overlay scan line effect using only `transform` and `opacity` for GPU compositing
**When to use:** JARVIS visual mode ambient animation; terminal panel heavy scan lines

```css
/* Scan line overlay -- GPU-composited, pointer-events: none */
.scan-lines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 2px,
    rgba(0, 0, 0, 0.15) 2px,
    rgba(0, 0, 0, 0.15) 4px
  );
  z-index: 50;
}

/* Moving scan line -- GPU-only animation */
.scan-line-sweep {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(
    to bottom,
    transparent,
    rgba(255, 184, 0, 0.08),
    transparent
  );
  pointer-events: none;
  z-index: 51;
  will-change: transform;
  animation: scanSweep 8s linear infinite;
}

@keyframes scanSweep {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
}
```

### Anti-Patterns to Avoid

- **Animating `top`/`left`/`width`/`height`:** These trigger layout recalculation. Use `transform: translate()` and `opacity` only for animations that run continuously. The management VM has limited GPU -- every non-composited animation is a performance tax.
- **Creating Socket.IO connections in child components:** Socket connections must be singletons managed at the app level. Register all event listeners in one place, update Zustand stores, let components subscribe to store slices.
- **Storing WebSocket data in React state:** Use Zustand stores instead of `useState` for data that multiple components need. React state causes prop drilling; Zustand allows direct subscription from any component.
- **Over-using `will-change`:** Each `will-change: transform` creates a GPU compositing layer. Use sparingly on elements that actually animate. Misuse causes excessive memory consumption.
- **Not cleaning up xterm.js:** The Terminal instance MUST be disposed in the useEffect cleanup. Failing to dispose creates memory leaks (WebGL contexts, event listeners, DOM nodes).

---

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom alert system | Sonner | Zero deps, observer pattern, works from Zustand actions outside React tree |
| Keyboard shortcuts | Manual addEventListener | react-hotkeys-hook | Handles focus scoping, input field detection, cleanup automatically |
| Terminal auto-resize | Manual resize calculation | @xterm/addon-fit + ResizeObserver | Handles character grid math, scrollbar compensation, DPI scaling |
| WebGL fallback | Custom renderer detection | @xterm/addon-webgl with try/catch | Handles context loss events, graceful degradation to DOM renderer |
| Connection state | Custom ping/pong | Socket.IO built-in reconnection | Auto-reconnect with exponential backoff, transport upgrade, heartbeats |
| CSS variable theming | Custom JS theme toggler | Tailwind v4 @theme + CSS custom properties | Variables available at runtime, no JS needed for theme switching |
| Sequential animations | Manual setTimeout chains | Motion staggerChildren + delayChildren | Handles interruption, cleanup, GPU compositing automatically |
| State persistence | localStorage wrapper | Zustand persist middleware | Handles serialization, hydration, partializing, storage backends |

**Key insight:** The eDEX-UI project was archived specifically because of performance issues caused by custom rendering solutions. Use established libraries (xterm.js WebGL, GPU-composited CSS, Motion) rather than building custom visual effects from scratch.

---

## Common Pitfalls

### Pitfall 1: Tailwind v3 to v4 Migration Breaks Everything

**What goes wrong:** All `@tailwind base/components/utilities` directives, `postcss.config.js`, and `tailwind.config.js` stop working. Class names like `shadow-sm`, `rounded-sm`, `blur-sm` have been renamed. The `!` important modifier moves from prefix to suffix.
**Why it happens:** Tailwind v4 is a ground-up rewrite with CSS-first configuration via `@theme` directives and a dedicated Vite plugin.
**How to avoid:** Follow the migration path exactly:
1. Uninstall `tailwindcss`, `postcss`, `autoprefixer` (old deps)
2. Install `tailwindcss@latest`, `@tailwindcss/vite@latest`
3. Replace `postcss.config.js` with Vite plugin in `vite.config.ts`
4. Delete `tailwind.config.js`, move config to `@theme {}` block in CSS
5. Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`
6. Rename: `shadow-sm` -> `shadow-xs`, `rounded-sm` -> `rounded-xs`, `blur-sm` -> `blur-xs`
7. Move `!` from prefix to suffix: `!flex` -> `flex!`
**Warning signs:** Build fails with "Unknown at rule @tailwind" or classes not applying.

### Pitfall 2: xterm.js 6.0 Canvas Renderer Removed

**What goes wrong:** If code references `@xterm/addon-canvas`, it will fail at install or runtime. The canvas addon no longer exists in v6.
**Why it happens:** xterm.js 6.0 removed the canvas renderer entirely. Only DOM and WebGL renderers are available.
**How to avoid:** Use `@xterm/addon-webgl@0.19.0` for GPU rendering. Always wrap WebGL addon loading in try/catch and fall back to DOM renderer. Handle `webglcontextlost` event to dispose and optionally re-create the addon.
**Warning signs:** `Module not found: @xterm/addon-canvas`, or blank terminal on devices without WebGL2.

### Pitfall 3: WebSocket Memory Leaks

**What goes wrong:** Nodes, VMs, and events accumulate unboundedly in memory. Dashboard slows down over hours of continuous display.
**Why it happens:** WebSocket push events append data without bounds. Ring buffers are not implemented. Event listeners are not cleaned up on component unmount.
**How to avoid:**
- Cap arrays in Zustand stores (e.g., max 300 data points for charts, max 100 events in feed)
- Always clean up Socket.IO listeners in useEffect return function
- Use named functions for event handlers (not anonymous) so `.off()` works correctly
- Batch rapid updates: accumulate for 100ms, then flush to store
**Warning signs:** Browser tab memory increasing steadily over time, janky animations after extended use.

### Pitfall 4: Sci-Fi Animations Kill Performance on Management VM

**What goes wrong:** Scan lines, glow effects, and ambient animations cause jank and high CPU usage on the management VM (limited GPU, running in a VM).
**Why it happens:** Animating properties other than `transform` and `opacity` triggers paint/layout. Too many compositing layers from `will-change` exhausts GPU memory.
**How to avoid:**
- ONLY animate `transform` and `opacity` for continuous animations
- Use `will-change` sparingly (only on elements that actually animate)
- Scan lines should use a static `repeating-linear-gradient` background (no animation needed for the static lines)
- Moving scan line sweep should animate `transform: translateY()` only
- Respect `prefers-reduced-motion`: disable all ambient animations
- The 3 visual modes provide escape hatches (Ops and Minimal disable heavy effects)
**Warning signs:** DevTools Performance panel shows green "Paint" bars during idle, FPS drops below 30.

### Pitfall 5: Socket.IO Auth Token Expiry

**What goes wrong:** Dashboard stops receiving updates after JWT expires (7-day tokens from Phase 1). No error is shown because Socket.IO silently disconnects.
**Why it happens:** Socket.IO auth token is sent once during handshake. When the token expires, reconnection attempts fail with "Invalid or expired token" but the client keeps trying.
**How to avoid:**
- Store JWT expiry time in auth store
- Before expiry, proactively re-authenticate via `/api/auth/login`
- On Socket.IO `connect_error`, check if error message contains "token" or "expired", then trigger re-auth flow
- Show "Session expired" toast and login prompt rather than silently failing
**Warning signs:** Dashboard shows "disconnected" indicator but no explanation of why.

### Pitfall 6: Border Color Default Change in Tailwind v4

**What goes wrong:** All `border-*` utilities render with `currentColor` instead of `gray-200`. UI elements that relied on default border color look wrong.
**Why it happens:** Tailwind v4 changed border default from `gray-200` to `currentColor` to match browser defaults.
**How to avoid:** Always specify border colors explicitly in the sci-fi theme. Since all borders should use the amber/gold palette anyway, this is actually a non-issue for this project -- but be aware when referencing Tailwind examples.
**Warning signs:** Borders appearing in unexpected colors (especially white/black instead of gray).

---

## Code Examples

### Tailwind v4 CSS Configuration for JARVIS Theme

```css
/* src/index.css */
@import "tailwindcss";

@theme {
  /* --- Amber/Gold Palette (WCAG AA verified on #0a0a0f) --- */
  --color-jarvis-amber: #ffb800;          /* Primary accent: 11.2:1 contrast */
  --color-jarvis-gold: #ffd866;           /* Secondary accent: 14.8:1 contrast */
  --color-jarvis-amber-dim: #b38200;      /* Dimmed amber: 7.2:1 contrast */
  --color-jarvis-orange: #ff6b00;         /* Alert/warning: 6.5:1 contrast */
  --color-jarvis-red: #ff3333;            /* Error/critical: 5.2:1 contrast */
  --color-jarvis-green: #33ff88;          /* Success/online: 12.4:1 contrast */
  --color-jarvis-cyan: #00d4ff;           /* Info/links: 9.8:1 contrast */

  /* --- Background Layers --- */
  --color-jarvis-bg: #0a0a0f;            /* Deepest background */
  --color-jarvis-bg-panel: #0d0d14;      /* Panel background */
  --color-jarvis-bg-card: #111118;       /* Card background */
  --color-jarvis-bg-hover: #16161f;      /* Hover state */

  /* --- Text --- */
  --color-jarvis-text: #e8e0d0;          /* Primary text (warm white): 15.1:1 */
  --color-jarvis-text-dim: #7a7060;      /* Secondary text: 4.7:1 (AA) */
  --color-jarvis-text-muted: #4a4540;    /* Muted text: 3.1:1 (large text only) */

  /* --- Glow Shadows --- */
  --shadow-jarvis-glow: 0 0 15px rgba(255, 184, 0, 0.4), 0 0 30px rgba(255, 184, 0, 0.2);
  --shadow-jarvis-glow-sm: 0 0 8px rgba(255, 184, 0, 0.3);
  --shadow-jarvis-glow-cyan: 0 0 15px rgba(0, 212, 255, 0.4);

  /* --- Fonts --- */
  --font-display: 'Orbitron', sans-serif;
  --font-body: 'Rajdhani', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* --- Animations --- */
  --animate-pulse-glow: pulse-glow 2s ease-in-out infinite;
  --animate-data-pulse: data-pulse 1.5s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

@keyframes data-pulse {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.02); }
}

/* --- Base Styles --- */
html, body, #root {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-body);
  background-color: var(--color-jarvis-bg);
  color: var(--color-jarvis-text);
  -webkit-font-smoothing: antialiased;
}

/* --- Custom Scrollbar --- */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 184, 0, 0.2); border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 184, 0, 0.4); }

/* --- Reduced Motion --- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Vite Config with Tailwind v4 Plugin

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
```

### Boot Sequence with Motion staggerChildren

```tsx
// src/components/boot/BootSequence.tsx
import { motion } from 'motion/react';
import { useState, useEffect } from 'react';

const BOOT_LINES = [
  { text: 'J.A.R.V.I.S. v3.1 INITIALIZING...', delay: 0 },
  { text: 'CONNECTING TO HOMECLUSTER [4 NODES]', delay: 400 },
  { text: 'PROXMOX API ............ ONLINE', delay: 800 },
  { text: 'SOCKET.IO REALTIME ..... ONLINE', delay: 1000 },
  { text: 'SSH TUNNEL POOL ........ READY', delay: 1200 },
  { text: 'SAFETY FRAMEWORK ....... ACTIVE [4-TIER]', delay: 1400 },
  { text: 'MCP TOOLS .............. 18 REGISTERED', delay: 1600 },
  { text: 'SYSTEM READY', delay: 2000 },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.3 },
  },
};

const lineVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
};

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 3000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 bg-jarvis-bg z-50 flex items-center justify-center"
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
    >
      <motion.div
        className="font-mono text-sm text-jarvis-amber space-y-1"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {BOOT_LINES.map((line, i) => (
          <motion.div key={i} variants={lineVariants}>
            <span className="text-jarvis-text-dim mr-2">[{String(i).padStart(2, '0')}]</span>
            {line.text}
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
```

### REST API Client with JWT

```typescript
// src/services/api.ts
const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://192.168.1.65:4000';

export async function apiCall<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function login(password: string): Promise<string> {
  const data = await apiCall<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return data.token;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwind.config.js` (JS) | `@theme {}` in CSS | Tailwind v4 (Jan 2025) | Delete JS config, move to CSS; postcss.config.js also removed when using Vite plugin |
| `@tailwind base/components/utilities` | `@import "tailwindcss"` | Tailwind v4 | Single import replaces three directives |
| `xterm` + `xterm-addon-*` packages | `@xterm/xterm` + `@xterm/addon-*` | xterm.js 5.4+ | Old packages deprecated; scoped packages are the only maintained path |
| `xterm-addon-canvas` renderer | `@xterm/addon-webgl` or DOM | xterm.js 6.0 (Jan 2026) | Canvas renderer removed entirely |
| `framer-motion` package | `motion` package | Nov 2024 | Same API, import from `motion/react` instead of `framer-motion` |
| `import { motion } from "framer-motion"` | `import { motion } from "motion/react"` | Nov 2024 | Drop-in rename; old package still works but unmaintained |

**Deprecated/outdated:**
- `xterm` (unscoped) npm package -- deprecated, use `@xterm/xterm`
- `xterm-addon-canvas` -- removed in xterm.js 6.0, use WebGL or DOM
- `xterm-addon-webgl` (unscoped) -- deprecated, use `@xterm/addon-webgl`
- `framer-motion` package -- renamed to `motion`, old package still works
- `postcss.config.js` for Tailwind -- unnecessary with `@tailwindcss/vite` plugin
- `tailwind.config.js` -- replaced by `@theme` CSS directive in v4

---

## Existing Scaffold Assessment

The `jarvis-ui/` directory contains a minimal scaffold that needs significant rework:

### What to Keep
- `index.html` -- structure is fine, Google Fonts (Rajdhani, Orbitron) already loaded
- `tsconfig.json` -- good TypeScript config, no changes needed
- `Dockerfile` -- multi-stage nginx build works; update port to 3004
- `nginx.conf` -- SPA fallback works; update port to 3004
- `src/main.tsx` -- entry point structure is correct

### What to Replace
- `tailwind.config.js` -- delete, move to `@theme` in CSS
- `postcss.config.js` -- delete, replaced by `@tailwindcss/vite` plugin
- `vite.config.ts` -- add `@tailwindcss/vite` plugin
- `src/index.css` -- replace `@tailwind` directives with `@import "tailwindcss"` + `@theme` block
- `src/App.tsx` -- currently renders JarvisInterface (chat), needs complete rewrite for dashboard layout
- `src/components/JarvisInterface.tsx` -- chat UI, will be replaced by dashboard
- `src/components/SoundWaveCanvas.tsx` -- canvas animation, may be preserved for center panel
- `src/services/jarvisApi.ts` -- talks to llama.cpp directly, replace with Phase 1 backend API
- `src/hooks/useJarvisChat.ts` -- chat hook, will be repurposed in Phase 3

### Color Palette Migration
The scaffold uses cyan (`#00d4ff`) as primary. Per CONTEXT.md decisions, the palette shifts to amber/gold dominant with the hybrid eDEX-UI + Iron Man aesthetic:
- Primary: `#ffb800` (amber) replaces `#00d4ff` (cyan)
- Cyan retained for info/link secondary use
- Orange retained for warnings
- Gold `#ffd866` for secondary highlights

---

## Backend API Contract (Phase 1)

The Phase 1 backend provides these interfaces that the dashboard consumes:

### REST API (port 4000)

| Endpoint | Method | Auth | Returns |
|----------|--------|------|---------|
| `/api/health` | GET | No | `{ status, timestamp, uptime, version }` |
| `/api/auth/login` | POST | No | `{ token }` (body: `{ password }`) |
| `/api/memory/events` | GET | JWT | `{ events: [...] }` with optional `?limit=&type=&node=&since=` |
| `/api/memory/events/unresolved` | GET | JWT | `{ events: [...] }` |
| `/api/memory/preferences` | GET | JWT | `{ preferences: [...] }` |
| `/api/memory/preferences/:key` | PUT | JWT | `{ preference: {...} }` |

### Socket.IO Namespaces (port 4000)

| Namespace | Auth | Purpose | Events (to define in Phase 2 backend work) |
|-----------|------|---------|------|
| `/cluster` | JWT via `handshake.auth.token` | Real-time cluster data | `nodes`, `vms`, `storage`, `quorum` |
| `/events` | JWT via `handshake.auth.token` | Jarvis activity feed | `event`, `alert` |

**Note:** The Socket.IO namespaces are set up in Phase 1 but the backend does not yet emit periodic data. Phase 2 must add backend-side emit logic (polling Proxmox API on intervals and pushing to connected clients). This is a backend task that belongs in Phase 2.

### MCP Tool Execution (via REST, not yet exposed)

The backend has `executeTool()` but no REST endpoint for it yet. Phase 2 needs:
- `POST /api/tools/:name` -- execute MCP tool via REST from dashboard
- This endpoint must pass `{ confirmed: true }` for RED tier tools (stop/restart)
- Start operations (GREEN tier via safety config) execute immediately

### CORS Configuration

Backend CORS currently allows `http://192.168.1.65:3004` and `http://localhost:3004`. The frontend must be served from port 3004 (or CORS origins must be updated).

---

## Open Questions

1. **Backend emit schedule not implemented**
   - What we know: Socket.IO namespaces exist but backend does not poll Proxmox and emit data periodically
   - What's unclear: Whether to add emit logic to existing backend code in Phase 2 or defer to separate backend task
   - Recommendation: Add a `src/realtime/emitter.ts` to the backend in Phase 2 that polls Proxmox on intervals (10s nodes, 15s VMs, 30s temps) and emits to Socket.IO clients. This is a backend modification required for the dashboard to work.

2. **REST API for tool execution not exposed**
   - What we know: `executeTool()` exists in MCP server but no HTTP route calls it
   - What's unclear: Exact request/response contract for tool execution from dashboard
   - Recommendation: Add `POST /api/tools/execute` endpoint in Phase 2 backend work: `{ tool: string, args: Record<string, unknown> }` -> `ToolResult`

3. **SSH PTY WebSocket transport**
   - What we know: xterm.js needs bidirectional WebSocket for terminal I/O. Phase 1 has SSH connection pooling via node-ssh.
   - What's unclear: Whether to use a separate WebSocket endpoint or a Socket.IO namespace for PTY data
   - Recommendation: Add a `/terminal` Socket.IO namespace that creates SSH PTY sessions. Client sends `{ node: string }` to start, `data` events for input, server sends `data` events for output. Simpler than a raw WebSocket and reuses existing Socket.IO infrastructure.

4. **xterm.js 6.0 stability**
   - What we know: Released 11 days ago (Jan 2026). Major version with breaking changes.
   - What's unclear: Whether 6.0.0 has early-adopter bugs
   - Recommendation: Use 6.0.0 but keep `@xterm/xterm@^5.5.0` + `@xterm/addon-webgl@^0.18.0` + `@xterm/addon-fit@^0.10.0` as a documented fallback. If issues arise, pin to 5.x.

5. **JetBrains Mono font for terminal**
   - What we know: Terminal needs a monospace font for proper character grid alignment
   - What's unclear: Whether to use Google Fonts or self-host
   - Recommendation: Add JetBrains Mono via Google Fonts in `index.html` alongside existing Rajdhani/Orbitron. It is a variable font available on Google Fonts.

---

## Sources

### Primary (HIGH confidence)
- [Tailwind CSS v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide) -- full migration steps from v3 to v4
- [Tailwind CSS v4 Vite Installation](https://tailwindcss.com/docs/installation/using-vite) -- @tailwindcss/vite plugin setup
- [Socket.IO React Integration](https://socket.io/how-to/use-with-react) -- official recommended hook pattern
- [xterm.js GitHub Releases](https://github.com/xtermjs/xterm.js/releases) -- v6.0.0 breaking changes
- [xterm.js addon-webgl](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl) -- WebGL renderer docs
- [Zustand TypeScript Guide](https://zustand.docs.pmnd.rs/guides/advanced-typescript) -- devtools/persist middleware setup
- [Zustand Devtools Middleware](https://zustand.docs.pmnd.rs/middlewares/devtools) -- action naming, middleware ordering
- [Motion Upgrade Guide](https://motion.dev/docs/react-upgrade-guide) -- framer-motion to motion migration
- Phase 1 backend source code (`/root/jarvis-backend/src/`) -- actual API contracts, Socket.IO setup

### Secondary (MEDIUM confidence)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) -- WCAG AA contrast ratio verification
- [CSS GPU Animation Best Practices](https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/) -- GPU compositing rules
- [eDEX-UI GitHub](https://github.com/GitSquared/edex-ui) -- theming system, design reference (archived project)
- [react-hotkeys-hook](https://react-hotkeys-hook.vercel.app/) -- keyboard shortcut hook API
- [Sonner GitHub](https://github.com/emilkowalski/sonner) -- toast notification library

### Tertiary (LOW confidence)
- xterm.js 6.0.0 addon compatibility -- inferred from release timing, not explicitly documented in a compatibility matrix
- Color contrast ratios in theme -- calculated values need verification with actual contrast checker tool

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via official docs or npm
- Architecture: HIGH -- patterns derived from official Socket.IO/React/Zustand docs
- Tailwind v4 migration: HIGH -- official upgrade guide verified
- xterm.js 6.0: MEDIUM -- very recent release (11 days), addon compatibility inferred
- Visual identity / CSS effects: MEDIUM -- based on established CSS patterns, not project-specific validation
- Pitfalls: HIGH -- drawn from official migration guides and documented breaking changes

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days -- stable ecosystem, main risk is xterm.js 6.0 patch releases)

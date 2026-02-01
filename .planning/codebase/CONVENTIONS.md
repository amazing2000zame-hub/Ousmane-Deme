# Coding Conventions

**Analysis Date:** 2026-01-31

## Naming Patterns

**Files:**
- TypeScript source: `kebab-case.ts` (e.g., `system-prompt.ts`, `memory-extractor.ts`)
- React components: `PascalCase.tsx` (e.g., `ChatPanel.tsx`, `BootOverlay.tsx`)
- Test files: `*.test.ts` co-located with source (e.g., `safety.test.ts`)
- Config files: `kebab-case.ts` or dotfiles (e.g., `vitest.config.ts`, `tsconfig.json`)

**Functions:**
- camelCase for all functions (e.g., `getToolTier()`, `checkSafety()`, `sendMessage()`)
- Async functions: no special prefix (e.g., `async function executeTool()`)
- React hooks: `use` prefix (e.g., `useChatSocket()`, `useVoice()`)

**Variables:**
- camelCase for local variables (e.g., `streamingContent`, `userScrolledUpRef`)
- SCREAMING_SNAKE_CASE for constants (e.g., `CONNECT_TIMEOUT`, `DEFAULT_EXEC_TIMEOUT`)
- Boolean flags: descriptive names without `is` prefix for state (e.g., `loading`, `isStreaming`)

**Types:**
- PascalCase for interfaces and types (e.g., `ChatMessage`, `SafetyResult`, `ToolCall`)
- PascalCase for enums (e.g., `ActionTier`, `PipelineStage`)
- Enum values: SCREAMING_SNAKE_CASE or lowercase depending on usage (ActionTier uses lowercase strings)

## Code Style

**Formatting:**
- Tool: None enforced (no Prettier config detected)
- Indentation: 2 spaces
- Line width: Generally stays under 120 characters, but not strictly enforced
- Semicolons: Always used
- Quotes: Single quotes for strings, backticks for templates
- Trailing commas: Used in multi-line arrays and objects

**Linting:**
- Backend: ESLint configured via package.json (`"lint": "eslint ."` in jarvis-ui)
- TypeScript strict mode enabled in both projects (`tsconfig.json`)
- Unused locals/parameters checking enabled in frontend (`noUnusedLocals: true`)

**TypeScript Configuration:**
- Backend: `target: ES2022`, `module: NodeNext`, strict mode
- Frontend: `target: ES2020`, `module: ESNext`, JSX React, strict mode with extra checks
- Both use `skipLibCheck: true` for faster compilation

## Import Organization

**Order:**
1. Node.js built-ins (e.g., `import crypto from 'node:crypto'`)
2. External packages (e.g., `import { create } from 'zustand'`)
3. Internal absolute imports (e.g., `import { config } from './config.js'`)
4. Relative imports (e.g., `import { useChatStore } from '../stores/chat'`)

**Path Aliases:**
- None used — all imports are relative or package-based
- Backend uses explicit `.js` extensions in imports (ESM requirement)
- Frontend omits extensions (bundler handles resolution)

**Import Style:**
- Named imports preferred (e.g., `import { describe, it, expect } from 'vitest'`)
- Type-only imports when needed (e.g., `import type { Socket } from 'socket.io-client'`)

## Error Handling

**Patterns:**
- Try-catch for async operations with detailed error messages
- Errors thrown with context (e.g., `throw new Error(\`SSH connect to ${host} failed: ${err.message}\`)`)
- Result objects for validation functions (e.g., `SafetyResult` with `allowed` boolean and `reason` string)
- Graceful degradation: log errors, continue operation when safe (e.g., `emitErr` in `/root/jarvis-backend/src/api/routes.ts:215`)

**Backend Examples:**
```typescript
// SSH connection error with context
catch (err: unknown) {
  throw new Error(
    `SSH connect to ${host} failed: ${err instanceof Error ? err.message : String(err)}`
  );
}

// Safety check returns structured result
export interface SafetyResult {
  allowed: boolean;
  reason?: string;
  tier: ActionTier;
}
```

**Frontend Examples:**
```typescript
// API error handling with toast notification
catch (err) {
  const msg = err instanceof Error ? err.message : 'Authentication failed';
  setError(msg);
  toast.error('Login failed');
}
```

## Logging

**Framework:** `console.log/warn/error` (no structured logging library)

**Patterns:**
- Prefix logs with context in brackets (e.g., `console.log('[Chat] AI chat handler initialized')`)
- Use template literals for dynamic values (e.g., ``console.log(`MCP server initialized: ${tools.length} tools`)``)
- Warning for non-fatal issues (e.g., `console.warn('[TTS Cache] Pre-warm error: ${err}')`)
- Error for critical failures (e.g., `console.error('[Camera API] Failed to get thumbnail:', err.message)`)

**Log Locations:**
- Backend: `jarvis-backend/src/index.ts` startup logs show service initialization
- Frontend: Component lifecycle events and socket events logged in development

## Comments

**When to Comment:**
- File-level JSDoc for module purpose (e.g., `/root/jarvis-backend/src/realtime/chat.ts:1-21`)
- Function-level JSDoc for complex public functions
- Inline comments for non-obvious logic or performance optimizations (e.g., `// PERF-08: RAF-batched token buffer`)
- TODO/FIXME not found in codebase (clean code, issues tracked externally)

**JSDoc/TSDoc:**
- Used consistently for public API functions
- Includes parameter descriptions and return types
- Example from `/root/jarvis-backend/src/clients/ssh.ts:68-79`:

```typescript
/**
 * Execute a command on a cluster node by IP address.
 *
 * @param host - IP address of the target node
 * @param command - Shell command to execute
 * @param timeout - Command timeout in ms (default 30s)
 */
export async function execOnNode(
  host: string,
  command: string,
  timeout?: number,
): Promise<ExecResult>
```

**Performance Tags:**
- Special comment convention for optimization tracking (e.g., `PERF-07`, `PERF-08`, `PERF-21`)
- References specific optimization work across codebase

## Function Design

**Size:**
- Functions generally under 100 lines
- Complex functions split into named sub-functions (e.g., `useChatSocket` defines 20+ named event handlers)
- Long files acceptable when cohesive (e.g., `/root/jarvis-backend/src/safety/tiers.ts` at 253 lines)

**Parameters:**
- Use objects for 3+ parameters (e.g., `checkSafety(tool, args, confirmed, overrideActive, keywordApproved)`)
- Optional parameters with default values (e.g., `timeout?: number` defaults to `DEFAULT_EXEC_TIMEOUT`)
- Destructuring for object parameters in function bodies (e.g., `const { limit, type, node } = req.query`)

**Return Values:**
- Explicit return types for public functions
- Structured result objects for complex operations (e.g., `SafetyResult`, `ExecResult`)
- Promises for async operations (e.g., `Promise<ExecResult>`)
- Void for side-effect functions (e.g., `stopEmitter(): void`)

## Module Design

**Exports:**
- Named exports preferred (e.g., `export function checkSafety()`)
- Default exports for React components (e.g., `export default App`)
- Barrel files: Not used — direct imports preferred

**File Organization:**
- Types defined at top of file or in separate `types.ts` (e.g., `/root/jarvis-backend/src/monitor/types.ts`)
- Constants follow types, before functions
- Main logic after helpers
- Export statements inline with declarations

**Dependency Injection:**
- Used for breaking circular dependencies (e.g., `setupMonitorRoutes(router, eventsNs)` in `/root/jarvis-backend/src/api/routes.ts:232`)
- Socket.IO namespaces passed to setup functions

## State Management

**Backend:**
- In-memory Maps for connection pools (e.g., `const pool = new Map<string, NodeSSH>()` in `/root/jarvis-backend/src/clients/ssh.ts:24`)
- SQLite database via Drizzle ORM (schema in `/root/jarvis-backend/src/db/schema.ts`)
- Config loaded from environment via dotenv (centralized in `/root/jarvis-backend/src/config.ts`)

**Frontend:**
- Zustand for global state (e.g., `useChatStore`, `useAuthStore`, `useVoiceStore`)
- Zustand devtools middleware enabled for debugging
- Local `useState` for component-local state
- `useRef` for mutable values that don't trigger re-renders (e.g., `userScrolledUpRef`)

**Zustand Store Pattern:**
```typescript
export const useChatStore = create<ChatState>()(
  devtools(
    (set, get) => ({
      // State
      messages: [],
      isStreaming: false,

      // Actions
      sendMessage: (content) => {
        set(
          (state) => ({ messages: [...state.messages, message] }),
          false,
          'chat/sendMessage',  // Action name for devtools
        );
      },
    }),
    { name: 'chat-store' },
  ),
);
```

## API Design

**REST Endpoints:**
- Pattern: `/api/<resource>/<action>` (e.g., `/api/tools/execute`, `/api/monitor/status`)
- Authentication: JWT bearer token in Authorization header (via `authMiddleware`)
- Public routes explicitly declared (e.g., health checks, image proxies for browser `<img>` tags)

**Socket.IO Namespaces:**
- Pattern: `/<resource>` (e.g., `/chat`, `/cluster`, `/terminal`, `/voice`)
- Events: `<namespace>:<action>` (e.g., `chat:send`, `chat:token`, `chat:done`)
- Authentication on connection handshake

**Request/Response Format:**
- JSON for all REST APIs
- Binary ArrayBuffer for audio/image data over Socket.IO
- Structured error responses with status codes (e.g., 403 for blocked, 404 for not found)

---

*Convention analysis: 2026-01-31*

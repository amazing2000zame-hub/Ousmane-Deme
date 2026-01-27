/**
 * Execution context for the current tool invocation.
 *
 * Provides request-scoped override state using AsyncLocalStorage so that
 * concurrent WebSocket sessions cannot corrupt each other's override flags.
 *
 * **New API (preferred for file operation tools):**
 *   - `runWithContext(overrideActive, fn)` -- wraps fn in a scoped context
 *   - `isOverrideActive()` -- reads from the current async context
 *
 * **Legacy API (backward-compatible, used by server.ts and system.ts):**
 *   - `setOverrideContext(active)` -- sets a module-level fallback
 *   - `isOverrideActive()` -- checks AsyncLocalStorage first, falls back to module-level
 *
 * The legacy API exists so that existing callers in server.ts (line 186) and
 * system.ts (line 47) continue to work without modification. New code should
 * use `runWithContext()` for proper request isolation.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// ---------------------------------------------------------------------------
// AsyncLocalStorage-based context (request-scoped, race-condition-safe)
// ---------------------------------------------------------------------------

interface OverrideContext {
  overrideActive: boolean;
}

const contextStore = new AsyncLocalStorage<OverrideContext>();

// ---------------------------------------------------------------------------
// Module-level fallback (backward compatibility with setOverrideContext)
// ---------------------------------------------------------------------------

let _fallbackOverride = false;
let _deprecationWarned = false;

// ---------------------------------------------------------------------------
// New API: runWithContext
// ---------------------------------------------------------------------------

/**
 * Execute a function within a request-scoped override context.
 *
 * This is the preferred way to set override state for new code.
 * Each call creates an isolated context that cannot be corrupted
 * by concurrent requests.
 *
 * @param overrideActive - Whether the override passkey is active for this request
 * @param fn - The function to execute within this context
 * @returns The return value of fn
 *
 * @example
 * ```ts
 * const result = await runWithContext(true, async () => {
 *   // isOverrideActive() returns true here
 *   return await handler(args);
 * });
 * ```
 */
export function runWithContext<T>(
  overrideActive: boolean,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return contextStore.run({ overrideActive }, fn);
}

// ---------------------------------------------------------------------------
// isOverrideActive (works with both new and legacy API)
// ---------------------------------------------------------------------------

/**
 * Check whether the override passkey is active in the current context.
 *
 * Resolution order:
 *  1. AsyncLocalStorage context (set by runWithContext) -- preferred
 *  2. Module-level fallback (set by setOverrideContext) -- legacy
 *  3. Default: false
 */
export function isOverrideActive(): boolean {
  const store = contextStore.getStore();
  if (store !== undefined) {
    return store.overrideActive;
  }
  return _fallbackOverride;
}

// ---------------------------------------------------------------------------
// Legacy API: setOverrideContext (backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Set the override context using a module-level variable.
 *
 * @deprecated Use `runWithContext()` for proper request-scoped isolation.
 * This function exists for backward compatibility with existing callers
 * in server.ts and system.ts. It is NOT safe for concurrent requests.
 *
 * @param active - Whether the override passkey is active
 */
export function setOverrideContext(active: boolean): void {
  if (!_deprecationWarned) {
    console.warn(
      '[context.ts] setOverrideContext() is deprecated. Use runWithContext() for request-scoped isolation.',
    );
    _deprecationWarned = true;
  }
  _fallbackOverride = active;
}

# Testing Patterns

**Analysis Date:** 2026-01-31

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `/root/jarvis-backend/vitest.config.ts`

**Assertion Library:**
- Vitest built-in `expect` API (compatible with Jest)

**Run Commands:**
```bash
cd /root/jarvis-backend
npm test              # Run all tests once
npm run test:watch    # Watch mode (re-run on file changes)
npm run test:coverage # Coverage report with v8
```

## Test File Organization

**Location:**
- Co-located with source in `src/__tests__/` directory
- Pattern: `/root/jarvis-backend/src/__tests__/*.test.ts`

**Naming:**
- Pattern: `<module-name>.test.ts`
- Examples:
  - `safety.test.ts` — tests `/root/jarvis-backend/src/safety/tiers.ts`
  - `memory-extractor.test.ts` — tests `/root/jarvis-backend/src/ai/memory-extractor.ts`
  - `router.test.ts` — tests `/root/jarvis-backend/src/ai/router.ts`

**Structure:**
```
jarvis-backend/
├── src/
│   ├── __tests__/
│   │   ├── safety.test.ts
│   │   ├── memory-extractor.test.ts
│   │   ├── memory-recall.test.ts
│   │   ├── cost-tracker.test.ts
│   │   └── router.test.ts
│   ├── safety/
│   │   ├── tiers.ts
│   │   └── protected.ts
│   └── ai/
│       ├── memory-extractor.ts
│       └── router.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from 'vitest';
import { checkSafety, getToolTier, ActionTier } from '../safety/tiers.js';

describe('getToolTier', () => {
  it('classifies monitoring tools as GREEN', () => {
    expect(getToolTier('get_cluster_status')).toBe(ActionTier.GREEN);
    expect(getToolTier('get_vms')).toBe(ActionTier.GREEN);
  });

  it('classifies operational tools as YELLOW', () => {
    expect(getToolTier('execute_ssh')).toBe(ActionTier.YELLOW);
  });
});

describe('checkSafety', () => {
  it('allows GREEN tools without confirmation', () => {
    const result = checkSafety('get_cluster_status', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe(ActionTier.GREEN);
  });
});
```

**Patterns:**
- Outer `describe` block per function or module
- Nested `describe` blocks for related test groups (optional, not always used)
- One `it` block per test case
- Descriptive test names in plain English (e.g., "allows GREEN tools without confirmation")

**Setup/Teardown:**
- `beforeEach` used for resetting mocks between tests
- No `afterEach` observed (cleanup handled by Vitest automatically)
- Example from `/root/jarvis-backend/src/__tests__/router.test.ts:38-43`:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkDailyBudget).mockReturnValue({ spent: 0, limit: 10, exceeded: false });
  Object.defineProperty(claudeModule, 'claudeAvailable', { value: true, writable: true });
});
```

## Mocking

**Framework:** Vitest built-in `vi` mock utilities

**Patterns:**
- Mock entire modules with `vi.mock()` at top of file (before imports)
- Mock return values with `vi.fn(() => value)`
- Reset mocks in `beforeEach` with `vi.clearAllMocks()`
- Access mocked functions with `vi.mocked(functionName)`

**Example from `/root/jarvis-backend/src/__tests__/router.test.ts:9-31`:**
```typescript
// Mock external dependencies before importing the module under test
vi.mock('../ai/claude.js', () => ({
  claudeAvailable: true,
  default: null,
}));

vi.mock('../ai/cost-tracker.js', () => ({
  checkDailyBudget: vi.fn(() => ({ spent: 0, limit: 10, exceeded: false })),
  calculateCost: vi.fn(() => 0),
}));

vi.mock('../db/index.js', () => ({
  db: {},
  sqlite: {
    exec: vi.fn(),
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }))
  },
}));

// Import after mocks are registered
import { routeMessage } from '../ai/router.js';
import { checkDailyBudget } from '../ai/cost-tracker.js';
```

**What to Mock:**
- External APIs and network calls (e.g., Claude AI client, database)
- Environment-dependent modules (e.g., file system, SSH connections)
- Expensive operations (e.g., model inference, large computations)

**What NOT to Mock:**
- Pure functions being tested directly
- Simple data transformations
- Type definitions and constants

## Fixtures and Factories

**Test Data:**
- Inline test data preferred over separate fixture files
- Simple objects created directly in test cases
- Constants defined at module level for reused values

**Example from `/root/jarvis-backend/src/__tests__/safety.test.ts:52-54`:**
```typescript
it('allows YELLOW tools without confirmation', () => {
  const result = checkSafety('execute_ssh', { command: 'uptime', host: '192.168.1.50' });
  expect(result.allowed).toBe(true);
});
```

**Location:**
- No dedicated fixtures directory observed
- Test data defined inline or at top of test file

## Coverage

**Requirements:** None enforced (no coverage thresholds in config)

**Configuration:**
```typescript
// vitest.config.ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/index.ts'],
}
```

**View Coverage:**
```bash
npm run test:coverage
# Generates HTML report in coverage/ directory
```

**Current Coverage:**
- Tests exist for critical safety, routing, memory, and cost-tracking logic
- Integration tests not present (unit tests only)
- Frontend has no tests currently

## Test Types

**Unit Tests:**
- Scope: Individual functions and modules
- Approach: Test pure functions with various inputs
- Example: `checkSafety()` tested with different tiers, confirmations, overrides

**Integration Tests:**
- Not currently implemented
- Future scope: Test Socket.IO handlers, database operations, MCP tool execution

**E2E Tests:**
- Framework: Not used
- Frontend uses manual testing via browser

## Common Patterns

**Async Testing:**
- Not needed for current tests (all test pure synchronous functions)
- Vitest supports async tests with `async it()` syntax when needed

**Error Testing:**
- Tests verify error messages and blocking behavior
- Example from `/root/jarvis-backend/src/__tests__/safety.test.ts:72-77`:

```typescript
it('blocks BLACK tools always', () => {
  const result = checkSafety('reboot_node', { node: 'pve' });
  expect(result.allowed).toBe(false);
  expect(result.tier).toBe(ActionTier.BLACK);
  expect(result.reason).toContain('BLACK tier');
});
```

**Parameter Variation Testing:**
- Multiple test cases for different parameter combinations
- Example: testing safety tiers (GREEN, YELLOW, RED, BLACK, unknown)
- Example: testing with/without confirmation, with/without override

**Boundary Testing:**
- Tests for edge cases (empty input, unknown values)
- Example from `/root/jarvis-backend/src/__tests__/safety.test.ts:141-143`:

```typescript
it('returns not protected for empty args', () => {
  expect(isProtectedResource({}).protected).toBe(false);
});
```

**Preference Detection Testing:**
- Pattern matching tests for natural language patterns
- Example from `/root/jarvis-backend/src/__tests__/memory-extractor.test.ts:10-15`:

```typescript
it('detects "I prefer" statements', () => {
  const prefs = detectPreferences('I prefer email alerts for critical issues');
  expect(prefs.length).toBeGreaterThan(0);
  expect(prefs[0].content).toContain('prefers');
  expect(prefs[0].key).toMatch(/^pref_/);
});
```

## Test Philosophy

**Focus:**
- Test business logic, not implementation details
- Verify behavior and contracts, not internal state
- Pure functions preferred (easier to test, no mocking needed)

**What's Tested:**
- Safety tier classification (`getToolTier`)
- Safety enforcement logic (`checkSafety`)
- Protected resource detection (`isProtectedResource`)
- Memory extraction patterns (`detectPreferences`)
- Message routing logic (`routeMessage`)

**What's Not Tested:**
- UI components (no React testing library)
- Socket.IO real-time handlers
- Database migrations
- External API integrations (mocked out)

## Future Testing Recommendations

**Based on codebase analysis:**

1. **Add frontend tests:**
   - Install Vitest + React Testing Library
   - Test critical components: `ChatPanel`, `ChatInput`, `ToolStatusCard`
   - Test Zustand stores (state mutations)

2. **Add integration tests:**
   - Test Socket.IO event flows (send message → receive response)
   - Test MCP tool execution with safety checks
   - Test database operations (using in-memory SQLite)

3. **Add E2E tests:**
   - Consider Playwright for critical user flows
   - Test authentication → chat → tool execution → voice playback

4. **Increase coverage:**
   - Current focus: safety and routing logic
   - Missing: TTS pipeline, memory recall, context management, monitoring

---

*Testing analysis: 2026-01-31*

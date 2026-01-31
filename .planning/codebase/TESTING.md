# Testing Patterns

**Analysis Date:** 2026-01-20

## Test Framework

### Python (jarvis-v3)

**Runner:**
- pytest >= 8.0.0
- pytest-asyncio >= 0.24.0 (for async test support)
- Config: No pytest.ini or setup.cfg; using pyproject.toml defaults
- Location: Tests referenced in `tests/` directory and `test_jarvis.py` root level

**Run Commands:**
```bash
pytest                    # Run all tests in tests/ and test_*.py
pytest tests/             # Run tests directory
pytest test_jarvis.py     # Run specific test file
pytest -v                 # Verbose output
pytest --asyncio-mode=auto  # For async tests (if needed)
```

**Assertion Library:**
- Built-in `assert` statements (standard pytest)
- Rich console output via Rich library for test status display

### TypeScript/Node.js (proxmox-ui/backend)

**Runner:**
- No test framework configured
- `package.json` scripts: `"test": "echo \"Error: no test specified\" && exit 1"`
- Status: **No automated tests implemented**

---

## Test File Organization

### Python (jarvis-v3)

**Location:**
- Co-located pattern preferred: test files in `tests/` directory
- Standalone test script: `test_jarvis.py` in project root
- Test data/fixtures: Not yet established (see TESTING gaps below)

**Naming:**
- Test file: `test_jarvis.py` (single main test file)
- Test discovery: pytest auto-discovers `test_*.py` and `*_test.py` patterns
- Module under test path: `src/jarvis/...` (separate from tests)

**Structure:**
```
jarvis-v3/
├── src/
│   └── jarvis/
│       ├── core.py
│       ├── cli.py
│       └── ...
├── tests/
│   └── (empty - needs implementation)
├── test_jarvis.py      # Main integration test script
└── requirements.txt
```

### TypeScript (proxmox-ui)

**Test Setup:**
- No tests directory present
- No test framework installed
- No test files found (`*.test.ts`, `*.spec.ts`)
- Status: **Tests not implemented**

---

## Test Structure

### Python (jarvis-v3) - Integration Tests

**Suite Organization:**

From `test_jarvis.py`:
```python
# Module-level setup
import asyncio
import sys
sys.path.insert(0, "src")

from rich.console import Console
console = Console()

# Test functions using async/await
async def test_ollama():
    """Test Ollama connection and chat."""
    console.print("\n[bold cyan]Testing Ollama LLM...[/]")
    # Setup
    client = OllamaClient(model="mistral:7b-instruct-q4_0")
    # Execute
    success = await client.initialize()
    # Assert
    if not success:
        console.print("[red]✗ Ollama initialization failed[/]")
        return False
    # Teardown (implicit)
    await client.close()
    return True

# Main test coordinator
async def main():
    panel = Panel.fit("[bold]JARVIS v3.0 Test Suite[/]", border_style="cyan")
    console.print(panel)

    await test_ollama()
    await test_skills()
    console.print("\n[bold green]All tests completed![/]")
```

**Patterns:**

1. **Setup:** Instantiate service/client with config
2. **Execute:** Call async methods, capture output
3. **Assert:** Check return values, log status with Rich colors
4. **Teardown:** Call cleanup methods (`await client.close()`)
5. **Reporting:** Rich console output with success/failure indicators

### TypeScript (proxmox-ui) - No Tests Yet

**Status:**
- Route handlers lack unit tests
- Services (`proxmox.ts`) lack integration tests
- WebSocket handlers untested
- Authentication middleware untested
- No test infrastructure in place

---

## Async Testing

### Python (jarvis-v3)

**Pattern:**
```python
async def test_ollama():
    """Test Ollama connection and chat."""
    client = OllamaClient(model="mistral:7b-instruct-q4_0")
    success = await client.initialize()

    if not success:
        return False

    # Test chat
    response = await client.chat("Hello, introduce yourself briefly.")
    console.print(f"[dim]Response:[/] {response[:200]}...")

    await client.close()
    return True

# Main runner
async def main():
    await test_ollama()
    await test_skills()

if __name__ == "__main__":
    asyncio.run(main())
```

**Key Points:**
- All test functions are `async def`
- Await each async call: `await client.initialize()`, `await client.chat()`
- pytest-asyncio handles event loop automatically
- Tests can be run with `pytest --asyncio-mode=auto` or via `asyncio.run()`

### TypeScript (proxmox-ui) - Not Applicable

No async tests established. Route handlers use async/await pattern:
```typescript
router.get('/', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const nodes = await proxmox.getNodes();
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch nodes' });
  }
});
```

---

## Mocking

### Python (jarvis-v3)

**Framework:**
- Standard library `unittest.mock` available but not used in current tests
- No mock library imported in test file or project dependencies
- Tests use real service initialization (not mocked)

**Current Approach (No Mocking):**
```python
# Test uses real Ollama client - requires actual service running
async def test_ollama():
    client = OllamaClient(model="mistral:7b-instruct-q4_0")
    success = await client.initialize()  # Real HTTP call to localhost:11434
    # ...
```

**What to Mock (Recommended):**
- External HTTP calls: Ollama API, Proxmox API
- File system operations: YAML config loading
- Audio capture: sounddevice (use mock input in tests)
- LLM responses: hardcode expected outputs

**What NOT to Mock:**
- Core business logic: OllamaClient message handling
- Skill pattern matching: real regex evaluation
- Component initialization: use test fixtures instead

### TypeScript (proxmox-ui) - No Tests

No mocking framework in place. Recommendations:
- Use `jest` or `vitest` for mocking
- Mock `child_process.exec` for Proxmox commands
- Mock `ws` (WebSocket) for terminal tests
- Fixture data in `test/fixtures/` directory

---

## Fixtures and Test Data

### Python (jarvis-v3)

**Current Status:**
- No fixture files found
- No test data directory
- Tests use real service initialization

**Recommended Structure:**
```
tests/
├── fixtures/
│   ├── config/
│   │   └── test_jarvis.yaml    # Test config with test Ollama model
│   ├── audio/
│   │   └── sample_command.wav  # Sample audio for STT testing
│   └── responses/
│       └── ollama_responses.json  # Canned LLM responses
├── conftest.py                 # Pytest fixtures
└── unit/
    ├── test_ollama_client.py
    ├── test_skills.py
    └── test_stt.py
```

**Fixture Pattern (Recommended):**
```python
# conftest.py
import pytest
from pathlib import Path

@pytest.fixture
def test_config_path():
    return Path(__file__).parent / "fixtures" / "config" / "test_jarvis.yaml"

@pytest.fixture
async def ollama_client(test_config_path):
    client = OllamaClient(model="mistral:7b-instruct-q4_0")
    yield client
    await client.close()
```

### TypeScript (proxmox-ui) - Not Applicable

No test fixtures established.

---

## Coverage

### Python (jarvis-v3)

**Requirements:**
- Not enforced via configuration
- `pytest-cov` not listed in dependencies
- No coverage thresholds set

**View Coverage (Setup Needed):**
```bash
pip install pytest-cov
pytest --cov=src/jarvis --cov-report=html
# Results in htmlcov/index.html
```

**Current Status:**
- `src/jarvis/` has basic smoke tests only
- `test_jarvis.py` validates initialization and skill loading
- Many modules untested: voice components, individual skills, CLI

### TypeScript (proxmox-ui) - Not Applicable

No coverage tooling; no tests exist.

---

## Test Types

### Python (jarvis-v3)

**Unit Tests:**
- Scope: Individual skill execution, pattern matching
- Approach: Mock LLM for isolated skill testing
- Location: `tests/unit/test_skills.py` (to be implemented)
- Example (recommended):
```python
@pytest.mark.asyncio
async def test_time_skill_pattern_match():
    llm = OllamaClient()
    skill = TimeDateSkill(llm)
    assert skill.matches("What time is it?")
    assert skill.matches("Tell me the time")
    assert not skill.matches("What's the weather?")
```

**Integration Tests:**
- Scope: Full orchestration (Jarvis core, skills + LLM)
- Approach: Real service dependencies (Ollama running locally)
- Location: `test_jarvis.py` (current)
- Current tests:
  - `test_ollama()` - LLM initialization and chat
  - `test_skills()` - Skill loading and pattern matching
  - `interactive_mode()` - Full conversational flow

**E2E Tests:**
- Framework: Not used
- Status: Not implemented
- Would test: Voice input → STT → Skill execution → TTS output

### TypeScript (proxmox-ui)

**Unit Tests:**
- Not implemented
- Would cover: Auth middleware, token generation/verification
- Example (recommended):
```typescript
describe('authMiddleware', () => {
  it('should reject missing Authorization header', () => {
    // ...
  });

  it('should reject invalid JWT token', () => {
    // ...
  });

  it('should extract username from valid token', () => {
    // ...
  });
});
```

**Integration Tests:**
- Not implemented
- Would cover: Routes with mocked Proxmox service
- Example (recommended):
```typescript
describe('GET /api/nodes', () => {
  it('should return nodes list with auth', async () => {
    const token = generateToken('test-user');
    const response = await request(app)
      .get('/api/nodes')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Array);
  });
});
```

**E2E Tests:**
- Not implemented
- Would cover: Full user flows (login → view nodes → start VM)
- Tool recommendation: Playwright, Cypress

---

## Common Testing Patterns

### Python - Async Testing

**Pattern:**
```python
import pytest
from jarvis.llm.ollama_client import OllamaClient

@pytest.mark.asyncio
async def test_chat_with_history():
    """Test that conversation history is maintained."""
    client = OllamaClient(model="mistral:7b-instruct-q4_0")
    await client.initialize()

    # First message
    response1 = await client.chat("What is Python?")
    assert len(response1) > 0

    # Second message (should have context)
    response2 = await client.chat("Is it a snake?")
    assert len(response2) > 0

    # Verify history
    assert len(client._conversation_history) > 2

    await client.close()
```

**Decorators:**
- `@pytest.mark.asyncio` - Enables async test function
- `async def test_name()` - Async test function definition
- `await` for all async calls
- Fixtures with `async def` and `yield` for setup/teardown

### Python - Error Testing

**Pattern:**
```python
import pytest
from jarvis.skills import SkillRegistry

@pytest.mark.asyncio
async def test_skill_error_handling():
    """Test that skill errors are caught gracefully."""
    registry = SkillRegistry(llm=None)

    # Test non-existent skill
    response = await registry.try_handle("completely unknown command")
    assert response is None

    # Test skill error (if implemented)
    with pytest.raises(Exception):
        # Trigger skill that doesn't have required LLM
        pass
```

**Error Assertions:**
- `with pytest.raises(ExceptionType):` - Assert exception thrown
- Check error messages: `assert "expected text" in str(exc_info.value)`
- Graceful failure patterns: return `None` or empty string

### TypeScript - HTTP Route Testing (Recommended)

**Pattern (Not Yet Implemented):**
```typescript
import request from 'supertest';
import app from '../src/index';

describe('POST /api/auth/login', () => {
  it('should return 400 if username missing', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ password: 'test' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('required');
  });

  it('should return 401 if invalid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'invalid', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.error).toContain('Invalid');
  });
});
```

---

## Test Coverage Gaps

### Python (jarvis-v3)

**Untested Areas:**

| Component | What's Not Tested | Risk | Priority |
|-----------|------------------|------|----------|
| STT (Speech-to-Text) | Audio recording, silence detection, Whisper integration | High - core feature | High |
| TTS (Text-to-Speech) | Piper TTS integration, audio output | High - core feature | High |
| Wake Word Detection | Porcupine integration, callback triggering | High - core feature | High |
| Server Control Skill | Cluster commands, SSH exec, response parsing | High - critical skill | High |
| CLI Entry Point | Argument parsing, signal handling, shutdown | Medium - user interaction | Medium |
| Configuration Loading | YAML parsing, defaults fallback, path resolution | Medium - initialization | Medium |
| Skills Registry | Skill registration, pattern compilation, error recovery | Low - framework | Low |

### TypeScript (proxmox-ui/backend)

**All areas untested:**

| Component | Gap | Priority |
|-----------|-----|----------|
| Auth Middleware | No tests for token validation, expiration | High |
| Auth Routes | No tests for login/logout/me endpoints | High |
| Nodes Routes | No tests for GET/POST node operations | High |
| WebSocket Terminal | No tests for connection, resize, input handling | High |
| Proxmox Service | No tests for pvesh, SSH exec, error handling | High |

---

## Testing Recommendations

### Python (jarvis-v3)

1. **Immediate (High Priority):**
   - Add `pytest-cov` to dev dependencies
   - Create `tests/conftest.py` with base fixtures
   - Add unit tests for skills pattern matching
   - Test Skill base class and SkillRegistry

2. **Next Phase:**
   - Mock Ollama responses for skill tests
   - Add STT mock input fixture
   - Test error handling in core.py

3. **Long Term:**
   - E2E test suite using real Ollama instance
   - Coverage threshold enforcement (>80%)
   - CI/CD pipeline integration

### TypeScript (proxmox-ui/backend)

1. **Immediate:**
   - Install test framework: `npm install --save-dev jest @types/jest ts-jest`
   - Create `jest.config.js` for TypeScript support
   - Add auth middleware tests

2. **Next:**
   - Route handler tests with mock Proxmox service
   - WebSocket terminal tests

3. **Long Term:**
   - E2E tests with test Proxmox instance
   - Frontend integration tests

---

*Testing analysis: 2026-01-20*

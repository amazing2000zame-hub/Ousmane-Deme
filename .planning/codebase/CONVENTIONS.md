# Coding Conventions

**Analysis Date:** 2026-01-20

## Project Scope

This analysis covers two major codebases:
1. **jarvis-v3** - Python voice assistant with async/LLM integration
2. **proxmox-ui** - TypeScript/Node.js backend + React frontend for Proxmox cluster management

---

## Naming Patterns

### Python (jarvis-v3)

**Files:**
- Module files: lowercase with underscores - `stt.py`, `ollama_client.py`, `server_control.py`
- Package directories: lowercase - `voice/`, `skills/`, `llm/`
- All files in `src/jarvis/` hierarchy

**Functions:**
- lowercase_with_underscores for all functions - `_load_config()`, `listen_and_transcribe()`, `_record_audio()`
- Private helper functions prefixed with underscore: `_initialize_model()`, `_has_word()`, `_trim_history()`
- Async functions use `async def` consistently: `async def initialize()`, `async def chat()`

**Classes:**
- PascalCase - `Jarvis`, `OllamaClient`, `SpeechToText`, `Skill`, `SkillRegistry`
- Class attributes use lowercase_with_underscores: `self._client`, `self._skills`, `self.model_name`
- Private attributes prefixed with underscore: `self._model`, `self._on_wake`, `self._conversation_history`

**Variables:**
- lowercase_with_underscores for local variables - `model_names`, `silent_frames`, `audio_path`
- Boolean prefixes: `_has_word()` pattern for boolean checks

### TypeScript/JavaScript (proxmox-ui)

**Files:**
- Backend routes: lowercase with extension - `auth.ts`, `nodes.ts`, `cluster.ts`
- Services and utilities: camelCase - `proxmox.ts`, `ollama_client.ts` (inherited pattern)
- Middleware: `auth.ts`
- WebSocket modules: `terminal.ts`

**Functions:**
- camelCase for all functions - `getNodes()`, `startVM()`, `authMiddleware()`, `setupTerminalServer()`
- Private handlers use descriptive names with callbacks: `onData()`, `onExit()`, `on('message')`
- Async functions labeled explicitly: `async function`, `async (...) =>`

**Interfaces/Types:**
- PascalCase for interfaces - `Node`, `Resource`, `StorageInfo`, `AuthRequest`, `TerminalSession`
- Interface properties use camelCase - `maxcpu`, `maxmem`, `vmid`
- Exported interfaces are documented at module top

**Variables:**
- camelCase for local variables - `username`, `password`, `shell`, `pty`
- Constants in UPPER_SNAKE_CASE - `JWT_SECRET`, `sessions`
- Map/object keys reflect API structure: `parsed.type`, `parsed.cols`

---

## Code Style

### Python (jarvis-v3)

**Formatting:**
- Tool: None explicitly configured (relying on ruff linter)
- Line length: 100 characters (configured in `pyproject.toml`)
- Indentation: 4 spaces (PEP 8 standard)
- String quotes: double quotes preferred (standard Python style)

**Linting:**
- Tool: ruff >= 0.8.0 (configured in `pyproject.toml`)
- Target version: Python 3.11+
- Type hints used selectively - present in function signatures with `-> ReturnType` annotations
- Union types use pipe operator: `Model | None`, `Path | str`

**Examples:**
```python
# Type hints in function signatures
async def listen_and_transcribe(
    self,
    timeout: float = 5.0,
    silence_threshold: float = 0.01,
) -> str | None:

# Return type annotations
def _default_system_prompt(self) -> str:
```

### TypeScript (proxmox-ui)

**Formatting:**
- No explicit formatter configured (project uses eslint without prettier)
- TypeScript strict mode enabled: `"strict": true`
- Target: ES2022

**Linting:**
- Tool: ESLint 9.39.1 with flat config (`eslint.config.js`)
- Includes: `@typescript-eslint`, `react-hooks`, `react-refresh`
- Configuration: `eslint.config.js` in flat format
- Enforces: unused locals, unused parameters, no fallthrough cases

**Examples:**
```typescript
// Strict typing with interfaces
interface AuthRequest extends Request {
  user?: {
    username: string;
  };
}

// Async/await with try/catch
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

## Import Organization

### Python (jarvis-v3)

**Order:**
1. Standard library imports - `asyncio`, `logging`, `pathlib`, `typing`
2. Third-party imports - `yaml`, `rich`, `ollama`, `numpy`, `pydantic`
3. Local application imports - `from jarvis.xxx import`
4. Relative imports within modules - rarely used

**Examples:**
```python
# From core.py
import asyncio
import logging
from pathlib import Path
from typing import Callable

import yaml

from jarvis.voice.wake_word import WakeWordDetector
from jarvis.voice.stt import SpeechToText
from jarvis.llm.ollama_client import OllamaClient
from jarvis.skills import SkillRegistry
```

### TypeScript (proxmox-ui)

**Order:**
1. Framework/library imports - `express`, `ws`, `cors`
2. Type/interface imports - separate explicit imports
3. Local service/route imports - with `.js` extension (ES modules)
4. Middleware imports

**Path Aliases:**
- No aliases configured in `tsconfig.app.json` or `eslint.config.js`
- Uses relative imports from root: `.js` extensions required for ES modules
- Middleware and services imported as `.../services/proxmox.js`

**Examples:**
```typescript
// From index.ts
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import authRoutes from './routes/auth.js';
import nodesRoutes from './routes/nodes.js';
import clusterRoutes from './routes/cluster.js';
import { setupTerminalServer } from './websocket/terminal.js';
```

---

## Error Handling

### Python (jarvis-v3)

**Patterns:**
- Try/except with specific logging: `logger.error(f"message: {e}")`
- Graceful degradation with fallbacks
- Empty exception handlers with comments: `except ImportError: logger.warning(...)`
- Optional component initialization: check for `if self._model is not None`
- Return `None` or empty values on failure rather than raising

**Examples:**
```python
# Lazy initialization with fallback
try:
    self._model = WhisperModel(...)
    logger.info("Whisper model loaded")
except Exception as e:
    logger.error(f"Failed to load Whisper model: {e}")
    try:
        logger.info("Trying CPU fallback...")
        self._model = WhisperModel(..., device="cpu", compute_type="int8")
    except Exception as e2:
        logger.error(f"CPU fallback also failed: {e2}")
        self._model = None

# Chat error handling
except Exception as e:
    logger.error(f"Chat error: {e}")
    self._conversation_history.pop()
    return "I encountered an error processing your request."
```

### TypeScript (proxmox-ui)

**Patterns:**
- Try/catch in route handlers with generic error responses
- Error responses use HTTP status codes (401, 500)
- WebSocket errors handled with close codes (1008=Unauthorized, 1011=Server Error)
- Validation errors return 400 status
- Catch-all error messages without exposing internals

**Examples:**
```typescript
// Route handler error handling
try {
  const nodes = await proxmox.getNodes();
  res.json(nodes);
} catch (err) {
  res.status(500).json({ error: 'Failed to fetch nodes' });
}

// Auth middleware error
if (!authHeader?.startsWith('Bearer ')) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}

// WebSocket error handling
ws.on('error', (err) => {
  console.error('WebSocket error:', err);
  const session = sessions.get(ws);
  if (session) {
    session.pty.kill();
    sessions.delete(ws);
  }
});
```

---

## Logging

### Python (jarvis-v3)

**Framework:** `logging` standard library

**Initialization:**
- CLI setup via `setup_logging()` function with `RichHandler` for console output
- Rich formatting with colors and proper tracebacks
- Level configurable: `logging.DEBUG` if verbose else `logging.INFO`
- Configuration in `src/jarvis/cli.py`: `RichHandler(console=console, rich_tracebacks=True)`

**Patterns:**
- Module-level logger: `logger = logging.getLogger(__name__)`
- Descriptive messages: `logger.info(f"Processing command: {command}")`
- Error context: `logger.error(f"Chat error: {e}")`
- State transitions: `logger.info("Jarvis initialized successfully")`
- Component status: `logger.info(f"Loaded {len(registry._skills)} skills")`

**Examples:**
```python
# From ollama_client.py
logger = logging.getLogger(__name__)

# Initialization logging
logger.info(f"Ollama client initialized with model: {self.model}")

# Failure logging
logger.error(f"Failed to initialize Ollama: {e}")
logger.warning(f"Model {self.model} not found. Available: {model_names}")
```

### TypeScript (proxmox-ui)

**Framework:** `console` global object

**Patterns:**
- Simple `console.log()`, `console.error()` at service/module level
- Error logging in catch blocks: `console.error('WebSocket error:', err)`
- No centralized logger - logging is local to each module
- Limited context - no structured logging framework

**Examples:**
```typescript
// From services/proxmox.ts
console.error(`pvesh error for ${path}:`, error.message);

// From websocket/terminal.ts
console.error('WebSocket error:', err);
console.error('Failed to spawn terminal:', err);
```

---

## Comments

### When to Comment

**Python:**
- Module-level docstrings: one-liner + detailed description
- Class docstrings: role and behavior
- Method docstrings: Args/Returns/Yields sections (not strict Sphinx format)
- Inline comments for non-obvious logic: `# Keep system prompt and last N messages`
- No comment clutter; code clarity preferred

**TypeScript:**
- Function-level comments sparse
- Interfaces documented with comments: no examples found in codebase
- Inline comments for tricky logic: `// Verify auth`, `// Spawn shell`
- Error messages act as comments: descriptive error JSON payloads

### JSDoc/TSDoc

**Python:**
- Docstring format: triple quotes with Args/Returns sections
- Example from `stt.py`:
```python
"""Listen for speech and transcribe it.

Args:
    timeout: Maximum recording time in seconds
    silence_threshold: RMS threshold for silence detection
    silence_duration: Duration of silence to end recording

Returns:
    Transcribed text or None if failed
"""
```

**TypeScript:**
- No formal JSDoc observed; basic comments sufficient
- Type annotations serve as documentation

---

## Function Design

### Size Guidelines

**Python:**
- Range: 20-80 lines per function (core.py has functions up to 60 lines)
- Helper methods for complex operations: `_record_audio()`, `_transcribe_audio()`
- Async functions may be longer due to wait points
- Private helpers extracted from public methods

**TypeScript:**
- Route handlers: 8-15 lines (try/catch + service call + response)
- Service functions: 20-40 lines (cmd execution + parsing)
- Middleware: 12-18 lines
- WebSocket handlers: longer (40-50 lines) for full connection lifecycle

### Parameters

**Python:**
- Keyword-only parameters for configuration: `timeout: float = 5.0`
- Self parameter always present in methods
- Type hints required in signatures
- Defaults provided for optional parameters

**TypeScript:**
- Parameters typed with interfaces/primitives
- Callback parameters explicit: `(req: AuthRequest, res: Response)`
- Optional parameters use `?` in interfaces: `user?: { username: string }`
- Destructuring used in route handlers: `req.params.name`, `req.body`

### Return Values

**Python:**
- Union types with `None`: `-> str | None`, `-> np.ndarray | None`
- Async functions return awaitable values
- Collections returned as-is, not wrapped: `list[dict]`, `np.ndarray`
- Empty/failure returns: `None`, `[]`, `{}`

**TypeScript:**
- HTTP responses: `res.json()`, `res.status(n).json()`
- Service functions: throw on error, caller handles try/catch
- Callbacks: `void` for side-effect functions
- JSON payloads: `{ success: true }`, `{ error: 'message' }`

---

## Module Design

### Exports

**Python:**
- Explicit `__all__` at module end: `__all__ = ["Skill", "SkillRegistry"]`
- Classes exported directly
- Private functions/variables prefixed with `_` (not in `__all__`)
- Main entry point in `cli.py` via `main()` function

**TypeScript:**
- Default exports for route modules: `export default router`
- Named exports for utilities: `export interface AuthRequest`, `export function generateToken`
- All functions exported at top level
- No barrel files (no index.ts re-exports)

### Barrel Files

**Python:**
- Package `__init__.py` files import select classes: `from jarvis.skills import Skill, SkillRegistry`
- Minimal re-exports; prefer direct imports from modules

**TypeScript:**
- Not used in this codebase
- Each service imported from its source file

---

## Cross-Cutting Patterns

### Async/Await

**Python (jarvis-v3):**
- Consistently used with `async def` and `await` keywords
- Event loops managed: `asyncio.get_event_loop()`, `asyncio.run()`
- Blocking calls wrapped: `run_in_executor(None, input)`, `run_in_executor(None, _record)`
- Graceful shutdown with `asyncio.CancelledError` handling

**TypeScript (proxmox-ui):**
- Route handlers are async: `async (req, res) => { await proxmox.getNodes() }`
- Promises implicit in callbacks (no explicit Promise types)
- Service functions wrapped with `promisify`: `const execAsync = promisify(exec)`

### Configuration Management

**Python:**
- YAML-based: `config/jarvis.yaml`
- Loaded via `_load_config()` with Path checking
- Fallback defaults in `_default_config()` method
- Environment variables not used

**TypeScript:**
- Environment variables: `process.env.PORT`, `process.env.JWT_SECRET`
- Defaults at module level: `const PORT = process.env.PORT || 3001`
- JSON config file (`prd.json`) not actively used in code

### Dependency Injection

**Python:**
- LLM passed to skills: `SkillRegistry(llm)`, `ServerControlSkill(self.llm)`
- Configuration injected at init: `Jarvis(config_path=...)`
- Lazy initialization: components created on `initialize()` call

**TypeScript:**
- Routes mounted on app: `app.use('/api/auth', authRoutes)`
- Services stateless: functions take parameters directly
- Middleware function-based: `authMiddleware` called in route handlers

---

## Tier-Specific Conventions

### Voice/Audio (Python)

**Pattern:**
- Lazy model loading with fallback to CPU
- Optional feature: graceful degradation when libraries unavailable
- Sample-based processing: frame callbacks, RMS calculation

### API/Backend (TypeScript)

**Pattern:**
- Express middleware chain for auth
- Service layer for business logic (proxmox commands)
- Error responses consistent: `{ error: 'message' }`
- JSON request/response bodies with typed interfaces

### Skills System (Python)

**Pattern:**
- Regex pattern matching: `self._compiled_patterns = [re.compile(p, re.IGNORECASE) for p in self.patterns]`
- Registry pattern for extensibility: `SkillRegistry.register(skill)`
- Skill inheritance: all inherit from `Skill` base class
- Async execution required: `async def execute(self, command: str) -> str`

---

*Convention analysis: 2026-01-20*

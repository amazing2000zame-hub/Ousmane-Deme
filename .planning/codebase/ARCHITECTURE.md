# Architecture

**Analysis Date:** 2026-01-20

## Pattern Overview

**Overall:** Multi-project monorepo with three independent but complementary applications:

1. **Proxmox UI** - Full-stack web application (React + Express + WebSocket)
2. **Jarvis v3** - Voice-activated AI assistant (Python asyncio-based)
3. **Supporting utilities** - Cluster management, monitoring, and automation

**Key Characteristics:**
- Asynchronous I/O throughout (JavaScript async/await, Python asyncio)
- Modular layered architecture (routes → services → infrastructure)
- Configuration-driven behavior (YAML for Jarvis, environment variables for Proxmox UI)
- Local-first architecture with fallback patterns (SSH tunneling, network resilience)
- Event-driven state management (callbacks and WebSocket for UI, state transitions in voice assistant)

---

## Layers

### Presentation Layer

**Purpose:** User-facing interfaces and client communication

**Locations:**
- `proxmox-ui/frontend/src/` - React SPA (Vite bundled)
- Jarvis CLI via `jarvis/cli.py` with Rich console output

**Contains:**
- React components (minimal in current state, placeholder app)
- Terminal emulation via xterm.js (frontend receives WebSocket data)
- CLI state callbacks (on_wake, on_listening, on_thinking, on_speaking)

**Depends on:**
- API layer (REST endpoints, WebSocket connections)
- State management (React hooks, Jarvis callback registration)

**Used by:**
- End users and administrators
- Local voice commands (speech recognition)

### API/Routing Layer

**Purpose:** HTTP endpoint definitions and request routing

**Locations:**
- `proxmox-ui/backend/src/routes/` - Express routers (auth, nodes, cluster)
  - `auth.ts` - Authentication endpoints
  - `nodes.ts` - Node and VM/CT management
  - `cluster.ts` - Cluster-wide resource queries

**Contains:**
- RESTful route definitions
- Request/response validation (basic)
- Middleware chain assembly

**Depends on:**
- Middleware layer (auth verification)
- Service layer (proxmox operations)
- Error handling patterns

**Used by:**
- Frontend (HTTP/REST calls)
- WebSocket terminal connections

### Middleware Layer

**Purpose:** Cross-cutting concerns and request preprocessing

**Locations:**
- `proxmox-ui/backend/src/middleware/auth.ts` - JWT authentication
- `proxmox-ui/backend/src/websocket/terminal.ts` - WebSocket setup and lifecycle

**Contains:**
- JWT token generation and verification
- Bearer token extraction from headers
- WebSocket session management
- PTY (pseudo-terminal) spawning

**Depends on:**
- jsonwebtoken library
- node-pty library
- Proxmox service layer (for PAM authentication)

**Used by:**
- All protected routes
- WebSocket connections

### Service Layer

**Purpose:** Business logic and Proxmox cluster integration

**Locations:**
- `proxmox-ui/backend/src/services/proxmox.ts` - Proxmox API wrapper
- `jarvis-v3/src/jarvis/llm/ollama_client.py` - LLM conversation management
- `jarvis-v3/src/jarvis/skills/__init__.py` - Skill registry and dispatch

**Contains:**

**Proxmox Service (`proxmox.ts`):**
- `pvesh()` / `pveshPost()` - Execute pvesh commands for Proxmox API calls
- Node queries: `getNodes()`, `getNodeStorage()`, `getNodeTemperature()`
- VM/CT lifecycle: `startVM()`, `stopVM()`, `shutdownVM()`, `startCT()`, `stopCT()`, `shutdownCT()`
- Update checks: `getNodeUpdates()`
- Authentication: `authenticatePAM()` - Validates PAM credentials

**Ollama LLM Client (`ollama_client.py`):**
- Conversation history management (rolling window of last 20 messages)
- Chat interface: `chat()` and `chat_stream()`
- Model verification and auto-pull
- System prompt configuration
- Context injection capabilities

**Skill Registry (`skills/__init__.py`):**
- Skill base class with pattern matching (regex)
- Registry pattern for skill registration
- Default skills loader (ServerControlSkill, SystemInfoSkill, TimeDateSkill)
- Command dispatch via `try_handle()` - first match wins

**Depends on:**
- exec/child_process (shell command execution)
- External services (Proxmox, Ollama, SSH)
- Configuration (environment variables, YAML)

**Used by:**
- Routes (request handlers)
- Core orchestrator (Jarvis class)

### Voice Layer

**Purpose:** Speech input/output processing

**Locations:**
- `jarvis-v3/src/jarvis/voice/stt.py` - Speech-to-text (Faster Whisper)
- `jarvis-v3/src/jarvis/voice/tts.py` - Text-to-speech (Piper TTS)
- `jarvis-v3/src/jarvis/voice/wake_word.py` - Wake word detection (Porcupine)

**Contains:**
- Audio recording from local device (sounddevice library)
- Whisper model loading and inference (lazy initialization)
- Piper TTS inference
- Wake word detection
- Silence detection for recording end
- CPU fallback when GPU unavailable

**Depends on:**
- Audio drivers (sounddevice, numpy)
- ML models (Whisper, Piper, Porcupine)
- Device availability

**Used by:**
- Core Jarvis orchestrator

### Orchestration Layer

**Purpose:** Coordinate components and manage application lifecycle

**Locations:**
- `proxmox-ui/backend/src/index.ts` - Express app setup and server initialization
- `jarvis-v3/src/jarvis/core.py` - Jarvis main orchestrator
- `jarvis-v3/src/jarvis/cli.py` - CLI entry point and signal handling

**Contains:**

**Backend Entry (`index.ts`):**
- Express app creation
- CORS setup
- Route mounting
- HTTP server creation
- WebSocket server initialization

**Jarvis Orchestrator (`core.py`):**
- Component initialization sequence
- Main event loop (wake → listen → think → speak)
- State callbacks for UI feedback
- Graceful shutdown handling
- Configuration loading and defaults

**Depends on:**
- All lower layers

**Used by:**
- Process entry points (main.tsx, cli.py)

---

## Data Flow

### Proxmox UI - Authentication Flow

1. User submits login form
2. `POST /api/auth/login` → auth route
3. Route calls `authenticatePAM(username, password)`
4. Service executes: `pvesh create /access/ticket -username 'user@pam' -password 'pass'`
5. Proxmox returns ticket JSON
6. Auth service generates JWT: `jwt.sign({username}, JWT_SECRET, {expiresIn: '8h'})`
7. Token returned to frontend
8. Frontend stores token (client-side storage, not persisted)
9. All subsequent requests include: `Authorization: Bearer <token>`
10. Auth middleware verifies JWT on each request

### Proxmox UI - Terminal Session Flow

1. Frontend opens WebSocket to `/ws/terminal?token=<jwt>&node=<nodename>`
2. Middleware verifies token before accepting connection
3. Backend spawns PTY: `spawn('/usr/bin/ssh', ['-o', 'StrictHostKeyChecking=no', node])`
4. WebSocket handles two message types:
   - `{type: 'resize', cols: N, rows: M}` → PTY resize
   - `{type: 'input', data: '...'}` → PTY stdin write
5. PTY output streamed back to WebSocket as raw text
6. User exits shell → PTY closes → WebSocket closes
7. Session cleaned up in `sessions` Map

### Jarvis v3 - Main Event Loop

1. Jarvis.initialize():
   - Load YAML config or use defaults
   - Create OllamaClient and verify model availability
   - Create SkillRegistry and load default skills
   - Initialize voice components (lazy-load ML models)

2. Jarvis.run() main loop:
   ```
   while running:
       await _wait_for_wake_word()         # Audio listener blocks
       invoke on_wake callbacks
       await _speak("Yes?")                 # TTS

       await _listen_for_command()          # Whisper STT
       invoke on_listening callbacks

       await _process_command(text):        # Skills or LLM
           skill_response = await skills.try_handle(command)
           if not skill_response:
               response = await llm.chat(command)
       invoke on_thinking callbacks

       await _speak(response)               # TTS
       invoke on_speaking callbacks
   ```

3. Signal handling:
   - SIGINT/SIGTERM → calls shutdown()
   - Shutdown kills all components and PTYs

### Jarvis v3 - Skill Execution

1. Command received: `"what time is it"`
2. SkillRegistry iterates registered skills
3. Each skill checks: `skill.matches(command)` - regex pattern match
4. First matching skill executes: `await skill.execute(command)`
5. If no skill matches → falls back to LLM.chat()
6. LLM response added to conversation history
7. History trimmed if exceeds max length (20 messages + system prompt)

### Jarvis v3 - LLM Conversation with History

1. System prompt injected as first message: `[{"role": "system", "content": "You are JARVIS..."}]`
2. User message added: `{"role": "user", "content": "your command"}`
3. Full conversation sent to Ollama: `ollama.chat(model=model, messages=[...])`
4. Assistant response received and added to history
5. If history > 21 messages:
   - Keep system prompt (index 0)
   - Keep last 20 messages
   - Discard middle messages
6. This provides context for multi-turn conversations with memory constraints

**State Management:**
- Proxmox: Stateless API (JWT tokens expire in 8 hours)
- Jarvis: In-memory conversation history, component initialization state, running flag
- WebSocket terminals: PTY processes stored in Map<WebSocket, {pty, ws}>

---

## Key Abstractions

### Proxmox Service Abstraction

**Purpose:** Hide shell command execution behind typed functions

**Examples:**
- `pvesh(path: string)` → `execAsync("pvesh get ${path} --output-format json")`
- `getNodes()` → calls `pvesh('/nodes')` → parses JSON → returns `Node[]`
- `startVM(node, vmid)` → calls `pveshPost('/nodes/${node}/qemu/${vmid}/status/start')`

**Pattern:** Command-line tool wrapping with JSON output parsing

### Skill Pattern

**Purpose:** Pluggable command handlers with regex matching

**Base Class:** `Skill`
- `name: str` - Identifier
- `description: str` - Help text
- `patterns: list[str]` - Regex patterns to match
- `execute(command: str) -> str` - Async handler

**Implementations:**
- `ServerControlSkill` - VM/node control commands
- `SystemInfoSkill` - System information queries
- `TimeDateSkill` - Time and date responses

**Pattern:** Visitor/handler pattern with regex dispatch

### LLM Conversation History

**Purpose:** Maintain stateful multi-turn conversations with memory bounds

**Pattern:** Rolling window - keep system prompt + last N user/assistant pairs

```python
_conversation_history = [
    {"role": "system", "content": "You are JARVIS..."},
    {"role": "user", "content": "first message"},
    {"role": "assistant", "content": "response"},
    ...
    {"role": "user", "content": "20th message"},
]
```

### Middleware Chain

**Purpose:** Compose authentication and logging across routes

**Pattern:** Express middleware - function(req, res, next) that either:
1. Allows request (calls next())
2. Rejects request (sends response)
3. Modifies request and allows (sets req.user)

---

## Entry Points

### Proxmox UI Backend

**Location:** `proxmox-ui/backend/src/index.ts`

**Triggers:**
- `npm run dev` (tsx watch mode)
- `npm run build && node dist/index.js` (production)
- Process: Starts Express + WebSocket server on port 3001

**Responsibilities:**
- Create Express app
- Mount CORS middleware
- Mount route handlers
- Create HTTP server
- Initialize WebSocket server
- Listen for connections

### Proxmox UI Frontend

**Location:** `proxmox-ui/frontend/src/main.tsx`

**Triggers:**
- `npm run dev` (Vite dev server)
- `npm run build` (Vite bundling to dist/)
- Process: Mounts React app to #root DOM element

**Responsibilities:**
- Create React root
- Mount App component
- Initialize hot module reloading (Vite)

### Jarvis Voice Assistant

**Location:** `jarvis-v3/src/jarvis/cli.py`

**Triggers:**
- `jarvis` (installed command from pyproject.toml)
- `python -m jarvis.cli`
- `jarvis -c config/jarvis.yaml -v` (with custom config and verbose logging)

**Responsibilities:**
- Parse CLI arguments (--config, --text, --verbose)
- Setup logging with Rich console
- Create Jarvis instance
- Call initialize()
- Call run() or run_text_mode()
- Handle SIGINT/SIGTERM signals
- Call shutdown()

---

## Error Handling

**Strategy:** Fail gracefully with logging and user-facing messages

**Patterns:**

1. **Service Errors (Proxmox):**
   ```typescript
   try {
     const { stdout } = await execAsync(...)
     return JSON.parse(stdout)
   } catch (err) {
     console.error(`pvesh error for ${path}:`, err.message)
     throw err  // Let caller handle
   }
   ```
   - Logs to console
   - Re-throws to route handler
   - Route handler returns 500 response

2. **Route Errors:**
   ```typescript
   try {
     const resources = await proxmox.getClusterResources()
     res.json(resources)
   } catch (err) {
     res.status(500).json({ error: 'Failed to fetch cluster resources' })
   }
   ```
   - Generic error message to client
   - Detailed error logged on server

3. **Skill Execution Errors:**
   ```python
   try:
       return await skill.execute(command)
   except Exception as e:
       logger.error(f"Skill '{skill.name}' error: {e}")
       return f"I encountered an error with {skill.name}: {e}"
   ```
   - Logs error
   - Returns user-friendly message
   - Continues event loop

4. **Voice Component Fallbacks:**
   - STT: If sounddevice unavailable → input() mock mode
   - TTS: If Piper fails → print to console
   - Wake word: If unavailable → wait for input
   - LLM: If Ollama fails → generic error response

5. **SSH/Network Timeouts:**
   ```typescript
   const { stdout } = await execAsync(..., { timeout: 10000 })
   ```
   - All SSH commands have 5-15 second timeouts
   - Timeout throws error → caught by service → caught by route

---

## Cross-Cutting Concerns

**Logging:**
- **Proxmox UI:** console.log/console.error (implicitly collected by stdout/stderr)
- **Jarvis:** Python logging module with Rich handler
  - Log levels: DEBUG (verbose), INFO (normal), WARNING (issues), ERROR (failures)
  - Logs include timestamps and context

**Validation:**
- **Proxmox UI:** Minimal validation - relies on Proxmox API validation
  - Routes check for required params (username, password)
  - Types checked via TypeScript
- **Jarvis:** YAML parsing validates configuration structure
  - Missing config keys use defaults

**Authentication:**
- **Proxmox UI:** JWT tokens, 8-hour expiry
  - Validated on every protected route
- **Jarvis:** No authentication - assumes trusted environment (local network)

**Resource Cleanup:**
- **WebSocket:** Sessions Map tracks all active PTYs, kills on disconnect
- **Jarvis:** shutdown() method explicitly closes LLM client and stops components
- **Child processes:** All exec() calls timeout to prevent zombie processes

---

*Architecture analysis: 2026-01-20*

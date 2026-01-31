# Codebase Structure

**Analysis Date:** 2026-01-20

## Directory Layout

```
/root/
├── proxmox-ui/                 # Full-stack web UI for cluster management
│   ├── backend/                # Express.js API server
│   │   ├── src/
│   │   │   ├── index.ts        # Server entry point
│   │   │   ├── routes/         # API endpoint handlers
│   │   │   ├── middleware/     # Auth, logging, etc.
│   │   │   ├── services/       # Business logic (Proxmox integration)
│   │   │   └── websocket/      # Terminal emulation over WebSocket
│   │   ├── dist/               # Compiled output (post-build)
│   │   ├── package.json        # Node dependencies
│   │   └── tsconfig.json       # TypeScript config
│   └── frontend/               # React SPA (Vite)
│       ├── src/
│       │   ├── main.tsx        # React entry point
│       │   ├── App.tsx         # Root component
│       │   └── assets/         # Static assets
│       ├── public/             # Public static files
│       ├── dist/               # Built output (post-build)
│       ├── package.json        # Node dependencies
│       └── tsconfig.json       # TypeScript config
├── jarvis-v3/                  # Voice-activated AI assistant
│   ├── src/
│   │   └── jarvis/             # Main package
│   │       ├── core.py         # Main orchestrator
│   │       ├── cli.py          # CLI entry point
│   │       ├── llm/            # LLM integration
│   │       │   └── ollama_client.py  # Ollama API wrapper
│   │       ├── voice/          # Voice processing
│   │       │   ├── stt.py      # Speech-to-text (Whisper)
│   │       │   ├── tts.py      # Text-to-speech (Piper)
│   │       │   └── wake_word.py # Wake word detection (Porcupine)
│   │       ├── skills/         # Command handlers
│   │       │   ├── __init__.py # Skill base class and registry
│   │       │   ├── server_control.py
│   │       │   ├── system_info.py
│   │       │   └── time_date.py
│   │       └── utils/          # Shared utilities
│   ├── config/
│   │   └── jarvis.yaml         # Runtime configuration
│   ├── scripts/                # Deployment/automation scripts (empty)
│   ├── tests/                  # Unit tests (placeholder)
│   ├── venv/                   # Python virtual environment
│   ├── pyproject.toml          # Python package config
│   └── README.md               # Documentation
├── documentation/              # Cluster and system documentation
│   ├── home-monitoring-project/
│   ├── security-monitor-setup/
│   ├── MANAGEMENT_VM_SETUP.md
│   └── NETWORK_STORAGE_SETUP.txt
├── cluster-plans/              # Deployment plans
├── telegram-uploads/           # Media uploads from Telegram bot
└── .planning/                  # GSD mapping documents
    └── codebase/               # Architecture and code analysis
        ├── ARCHITECTURE.md
        └── STRUCTURE.md
```

---

## Directory Purposes

### `/root/proxmox-ui/backend/src/`

**Purpose:** Express.js API server code

**Contains:**
- HTTP route handlers
- Business logic for cluster operations
- WebSocket terminal server
- Authentication and authorization
- Proxmox API integration

**Key files:**
- `index.ts` - Server initialization
- `routes/` - API endpoints
- `services/proxmox.ts` - Proxmox operations
- `middleware/auth.ts` - JWT verification
- `websocket/terminal.ts` - PTY management

### `/root/proxmox-ui/frontend/src/`

**Purpose:** React application source code

**Contains:**
- React components (currently minimal - placeholder Vite app)
- Styles (CSS, Tailwind)
- TypeScript type definitions

**Key files:**
- `main.tsx` - React root
- `App.tsx` - Root component
- `index.css` - Global styles
- `assets/` - SVGs and static images

### `/root/jarvis-v3/src/jarvis/`

**Purpose:** Main Python package for Jarvis assistant

**Contains:**
- Core orchestration logic
- Voice processing pipeline
- LLM conversation management
- Skill system and plugins
- CLI interface

**Key subdirectories:**
- `llm/` - Ollama client and LLM integration
- `voice/` - Audio input/output (STT, TTS, wake word)
- `skills/` - Command handlers with pattern matching
- `utils/` - Shared utilities (logging, config)

### `/root/jarvis-v3/config/`

**Purpose:** Configuration files for Jarvis

**Contains:**
- `jarvis.yaml` - Main configuration (models, audio, cluster nodes)

### `/root/documentation/`

**Purpose:** System and cluster documentation

**Contains:**
- Homelab architecture diagrams (if any)
- Setup guides for specific services
- Network configuration documentation
- VM/container setup procedures

---

## Key File Locations

### Entry Points

| File | Purpose | Trigger |
|------|---------|---------|
| `proxmox-ui/backend/src/index.ts` | Express server startup | `npm run dev` |
| `proxmox-ui/frontend/src/main.tsx` | React app mount | `npm run dev` or browser |
| `jarvis-v3/src/jarvis/cli.py` | CLI interface | `jarvis` command |
| `jarvis-v3/src/jarvis/core.py` | Main event loop | Jarvis.run() |

### Configuration

| File | Purpose | Format |
|------|---------|--------|
| `proxmox-ui/backend/package.json` | Node deps + scripts | JSON |
| `proxmox-ui/frontend/package.json` | Node deps + scripts | JSON |
| `jarvis-v3/pyproject.toml` | Python package config | TOML |
| `jarvis-v3/config/jarvis.yaml` | Runtime configuration | YAML |
| `proxmox-ui/backend/tsconfig.json` | TypeScript compiler options | JSON |
| `proxmox-ui/frontend/tsconfig.json` | TypeScript compiler options | JSON |

### Core Logic

| File | Responsibility |
|------|-----------------|
| `proxmox-ui/backend/src/services/proxmox.ts` | Proxmox CLI wrapper (pvesh commands) |
| `jarvis-v3/src/jarvis/llm/ollama_client.py` | LLM API client and conversation history |
| `jarvis-v3/src/jarvis/skills/__init__.py` | Skill registry and pattern matching |
| `jarvis-v3/src/jarvis/voice/stt.py` | Audio capture and transcription |
| `jarvis-v3/src/jarvis/voice/tts.py` | Text-to-speech synthesis |

### Testing

| Directory | Type | Runner |
|-----------|------|--------|
| `jarvis-v3/tests/` | Python unit tests | pytest |
| None (proxmox-ui) | No tests yet | N/A |

---

## Naming Conventions

### Files

**Backend (TypeScript/JavaScript):**
- `camelCase.ts` for files with single export
- `routes/` subdirectory files use lowercase: `auth.ts`, `nodes.ts`
- Service files: `proxmox.ts` (exported functions use camelCase)
- Example: `middleware/auth.ts` exports `authMiddleware()`, `generateToken()`

**Frontend (React/TypeScript):**
- `.tsx` for React components
- `.ts` for non-component modules
- `.css` for component styles
- Example: `App.tsx`, `index.css`

**Python (Jarvis):**
- `snake_case.py` for modules
- `SnakeCase` or `snake_case` per Python convention (no enforcement found)
- `__init__.py` in packages
- Example: `ollama_client.py`, `server_control.py`

**Configuration:**
- `snake_case.yaml` or `snake_case.toml`
- Example: `jarvis.yaml`, `pyproject.toml`

### Directories

**Backend structure:**
- `routes/` - Express route handlers (by domain)
- `middleware/` - Express middleware functions
- `services/` - Business logic and external integrations
- `websocket/` - WebSocket-specific handlers

**Frontend structure:**
- `src/` - Source code
- `public/` - Static files (served as-is)
- `dist/` - Build output
- `assets/` - SVGs and images

**Python structure:**
- `src/jarvis/` - Main package
- `config/` - Configuration files
- `scripts/` - Utility scripts
- `tests/` - Test suites
- `venv/` - Virtual environment

---

## Where to Add New Code

### New Feature in Proxmox UI Backend

**Primary code:**
- Route handler: `proxmox-ui/backend/src/routes/{domain}.ts`
  - Example: `storage.ts` for storage operations
  - Pattern: `router.get/post/put/delete(path, authMiddleware, handler)`

**Secondary files:**
- Service functions: `proxmox-ui/backend/src/services/proxmox.ts`
  - Add new function following existing patterns
  - Wrap shell commands or API calls
  - Return typed data
- Middleware: `proxmox-ui/backend/src/middleware/` if adding auth/validation
- Mount in: `proxmox-ui/backend/src/index.ts`
  - Add `app.use('/api/storage', storageRoutes)`

**Test location:** Create `proxmox-ui/backend/src/routes/storage.test.ts` (not yet established)

### New Component in Proxmox UI Frontend

**Primary code:**
- Component: `proxmox-ui/frontend/src/` or organized subdirectory
- Pattern: Named export, `.tsx` file, React hooks for state

**Styles:**
- Co-located `.css` file or Tailwind classes inline

**Reference in:**
- `App.tsx` or parent component

**Build system:**
- Vite auto-discovers and bundles
- No explicit imports needed in config

### New Skill in Jarvis

**Primary code:**
- Skill class: `jarvis-v3/src/jarvis/skills/{skill_name}.py`
  - Extend `Skill` base class
  - Define `name`, `description`, `patterns`
  - Implement `execute(command: str) -> str` async method
- Example:
  ```python
  class MediaControlSkill(Skill):
      name = "media_control"
      description = "Control media playback"
      patterns = [r"play", r"pause", r"next", r"previous"]

      async def execute(self, command: str) -> str:
          # Implementation
  ```

**Registration:**
- Update `jarvis-v3/src/jarvis/skills/__init__.py`
- Import new skill class
- Add to `SkillRegistry.load_default_skills()`

**Configuration:**
- Add entry in `jarvis-v3/config/jarvis.yaml`
- Example:
  ```yaml
  skills:
    media_control:
      enabled: true
  ```

**Testing:**
- Create: `jarvis-v3/tests/test_media_control.py`
- Pattern: `test_*.py` files in `tests/`

### New Voice Component in Jarvis

**If adding wake word detector variant:**
- Create: `jarvis-v3/src/jarvis/voice/{detector_type}.py`
- Implement same interface as existing
- Update: `jarvis-v3/src/jarvis/core.py` initialization

**If adding TTS provider:**
- Create: `jarvis-v3/src/jarvis/voice/tts_{provider}.py`
- Implement `speak()` async method
- Update: `core.py` initialization

**Configuration:**
- Add config section in `jarvis.yaml`
- Reference in `core._load_config()`

### Utilities

**Shared helpers:**
- Location: `jarvis-v3/src/jarvis/utils/`
- Example: `jarvis-v3/src/jarvis/utils/__init__.py`

**Cross-project utilities:**
- Proxmox UI: Not established, add to `services/` if cluster-related
- Jarvis: Keep in `utils/` subdirectory

---

## Special Directories

### `/root/.planning/codebase/`

**Purpose:** GSD codebase analysis documents

**Generated:** Mapping documents written by Claude analysis
**Committed:** Yes, part of documentation
**Contents:**
- ARCHITECTURE.md - System design patterns
- STRUCTURE.md - Directory and file organization
- CONVENTIONS.md - Code style guidelines
- TESTING.md - Test patterns and frameworks
- STACK.md - Technology dependencies
- INTEGRATIONS.md - External services and APIs
- CONCERNS.md - Technical debt and issues

### `/root/proxmox-ui/backend/dist/`

**Purpose:** Compiled TypeScript output

**Generated:** Yes (`npm run build`)
**Committed:** No
**Created from:** `src/` via TypeScript compiler

### `/root/proxmox-ui/frontend/dist/`

**Purpose:** Built frontend bundle

**Generated:** Yes (`npm run build`)
**Committed:** No
**Created from:** `src/` via Vite bundler

### `/root/jarvis-v3/venv/`

**Purpose:** Python virtual environment

**Generated:** Yes (`python -m venv venv`)
**Committed:** No
**Contains:** Installed packages from `pyproject.toml`

### `/root/proxmox-ui/backend/node_modules/` and `frontend/node_modules/`

**Purpose:** Node.js dependencies

**Generated:** Yes (`npm install`)
**Committed:** No
**Managed by:** `package-lock.json` or `package.json`

### `/root/jarvis-v3/tests/`

**Purpose:** Test suite (Python)

**Location for new tests:** `test_{module}.py` pattern
**Runner:** `pytest`
**Coverage:** Not yet established

---

## Build and Deployment Locations

### Proxmox UI Backend

```
Development:    npm run dev         → tsx watch src/index.ts
Production:     npm run build       → tsc (outputs to dist/)
                node dist/index.js  → Start server
Env required:   JWT_SECRET, PORT (default 3001)
```

### Proxmox UI Frontend

```
Development:    npm run dev         → Vite dev server + HMR
Production:     npm run build       → Vite bundle to dist/
                npm run preview     → Preview built output
Served from:    dist/ directory
```

### Jarvis v3

```
Development:    jarvis -c config/jarvis.yaml -v
                python -m jarvis.cli -c config/jarvis.yaml
Production:     jarvis -c /etc/jarvis/config.yaml
Entry:          src/jarvis/cli.py main()
Env required:   CUDA_VISIBLE_DEVICES (optional), HOME
```

---

## Import Path Patterns

### Proxmox UI Backend

```typescript
// Routes importing services
import * as proxmox from '../services/proxmox.js'

// Routes importing middleware
import { authMiddleware } from '../middleware/auth.js'

// Services using built-ins
import { exec } from 'child_process'
import jwt from 'jsonwebtoken'
```

**Path format:** Relative paths with `.js` extensions (ES modules)

### Jarvis v3

```python
# CLI importing core
from jarvis.core import Jarvis

# Core importing submodules
from jarvis.voice.stt import SpeechToText
from jarvis.llm.ollama_client import OllamaClient
from jarvis.skills import SkillRegistry

# Skills importing base
from jarvis.skills import Skill
```

**Path format:** Absolute imports from package root

---

*Structure analysis: 2026-01-20*

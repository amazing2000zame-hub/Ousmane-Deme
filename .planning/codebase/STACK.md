# Technology Stack

**Analysis Date:** 2026-01-20

## Languages

**Primary:**
- TypeScript 5.9.3 - Backend API (`/root/proxmox-ui/backend/`) and frontend (`/root/proxmox-ui/frontend/`)
- Python 3.11+ - Voice assistant and automation (`/root/jarvis-v3/`)

**Secondary:**
- JavaScript (CommonJS/ESM) - Runtime execution for TypeScript

## Runtime

**Environment:**
- Node.js (version not pinned, must support ES2022)
- Python 3.11+

**Package Manager:**
- npm (Node.js projects use `package.json`)
- pip/hatch (Python project uses `pyproject.toml`)

**Lockfiles:**
- `package-lock.json` present for `/root/proxmox-ui/backend/`
- `pyproject.toml` with pinned versions for `/root/jarvis-v3/`
- No lockfile for `/root/proxmox-ui/frontend/` (check if needed)

## Frameworks

**Core (JavaScript/TypeScript):**
- Express 5.2.1 - REST API backend (`/root/proxmox-ui/backend/`)
- React 19.2.0 - Frontend UI (`/root/proxmox-ui/frontend/`)
- Vite 7.2.4 - Build tool and dev server (`/root/proxmox-ui/frontend/`)

**Voice & AI (Python):**
- Ollama 0.4.0 - Local LLM inference client (`/root/jarvis-v3/`)
- faster-whisper 1.0.0 - Speech-to-text (`/root/jarvis-v3/src/jarvis/voice/stt.py`)
- piper-tts 1.2.0 - Text-to-speech (`/root/jarvis-v3/src/jarvis/voice/tts.py`)
- pvporcupine 3.0.0 - Wake word detection (`/root/jarvis-v3/src/jarvis/voice/wake_word.py`)

**Testing:**
- pytest 8.0.0 - Python test runner
- pytest-asyncio 0.24.0 - Async test support

**Build/Dev:**
- tsx 4.21.0 - TypeScript execution and watch mode
- TypeScript 5.9.3 - Type checking and compilation

## Key Dependencies

**Critical:**
- `express` 5.2.1 - Required for API server; handles all HTTP requests
- `ws` 8.19.0 - WebSocket library; used for terminal streaming (`/root/proxmox-ui/backend/src/websocket/terminal.ts`)
- `node-pty` 1.1.0 - Pseudo-terminal spawning; enables interactive shell over WebSocket
- `jsonwebtoken` 9.0.3 - JWT authentication; issues and verifies auth tokens
- `cors` 2.8.5 - CORS middleware for cross-origin requests
- `ollama` 0.4.0 - Required for LLM operations in Jarvis

**Infrastructure:**
- `react-router-dom` 7.12.0 - Frontend routing
- `@tanstack/react-query` 5.90.18 - Frontend data fetching and caching
- `lucide-react` 0.562.0 - Icon library
- `xterm` 5.3.0 - Terminal emulator for web
- `@xterm/addon-fit` 0.11.0 - XTerm auto-sizing
- `@xterm/addon-web-links` 0.12.0 - XTerm hyperlink support
- `httpx` 0.27.0 - Async HTTP client for Proxmox API calls (Jarvis)
- `pyyaml` 6.0 - Configuration file parsing (Jarvis)
- `rich` 13.0.0 - Terminal output formatting (Jarvis)
- `sounddevice` 0.5.0 - Audio device access (Jarvis)
- `numpy` 1.26.0 - Numerical computing for audio (Jarvis)

## Configuration

**Environment:**
- No `.env` file detected in codebase (relies on inline defaults)
- Express backend defaults to `PORT=3001` if unset
- JWT authentication uses default secret `proxmox-ui-secret-change-in-production` (see `JWT_SECRET` in `/root/proxmox-ui/backend/src/middleware/auth.ts`)
- Vite dev server configured to proxy API calls to `http://localhost:3001`
- Ollama defaults to `http://localhost:11434` (see `/root/jarvis-v3/config/jarvis.yaml`)

**Build:**
- TypeScript: `tsconfig.json` targets `ES2022`, `module: NodeNext`, strict mode enabled
  - Backend: `/root/proxmox-ui/backend/tsconfig.json` - compiled to `dist/` directory
  - Frontend: `/root/proxmox-ui/frontend/tsconfig.json` - references `tsconfig.app.json` and `tsconfig.node.json`
- Vite: `/root/proxmox-ui/frontend/vite.config.ts` - React + Tailwind CSS plugins
- Python: `pyproject.toml` specifies `hatchling` build backend

## Platform Requirements

**Development:**
- Node.js (ES2022 capable)
- Python 3.11+
- CUDA support optional for Whisper (`device: cuda` in config)
- Audio hardware (for Jarvis voice features)
- SSH access to Proxmox cluster nodes (for remote commands)

**Production:**
- Deployment target: Proxmox VE 9.1.4+ (runs on Home node 192.168.1.50)
- Direct `pvesh` CLI access required (backend must run on Proxmox host)
- WebSocket support required (terminal streaming)
- Network access to Proxmox cluster nodes for SSH/remote execution
- Ollama service available at configured `base_url` (local or remote)

---

*Stack analysis: 2026-01-20*

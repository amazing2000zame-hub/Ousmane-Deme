# Technology Stack

**Analysis Date:** 2026-01-31

## Languages

**Primary:**
- TypeScript 5.9.3 (backend), 5.6.2 (frontend) - All application code
- JavaScript ES2022 (runtime target)

**Secondary:**
- Python 3 - TTS service (XTTS v2), Whisper STT, Piper TTS
- Shell (Bash) - Cluster SSH operations

## Runtime

**Environment:**
- Node.js 22.22.0

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json` in both `jarvis-backend/` and `jarvis-ui/`)

## Frameworks

**Core:**
- Express 5.2.1 - Backend HTTP server
- React 19.0.0 - Frontend UI framework
- Vite 6.0.5 - Frontend build tool and dev server

**Real-Time Communication:**
- Socket.IO 4.8.3 (server and client) - WebSocket communication for chat, voice, terminal, events, cluster status

**Database:**
- Drizzle ORM 0.45.1 - SQL query builder and schema management
- better-sqlite3 12.6.2 - Embedded SQLite database

**AI/ML:**
- @anthropic-ai/sdk 0.71.2 - Claude API client for agentic tool-use LLM
- openai 6.16.0 - OpenAI-compatible client for local Qwen LLM and fallback TTS
- @modelcontextprotocol/sdk 1.25.3 - MCP server for tool registration and execution

**Testing:**
- Vitest 4.0.18 - Unit test framework (backend only)

**Build/Dev:**
- tsx 4.21.0 - TypeScript execution for development
- TypeScript Compiler (tsc) - Production builds
- ESLint 9.17.0 - Code linting (frontend)
- Tailwind CSS 4.1.18 - UI styling framework

## Key Dependencies

**Critical:**
- socket.io 4.8.3 - Real-time bidirectional communication between frontend and backend
- @anthropic-ai/sdk 0.71.2 - Claude Sonnet 4 integration for cluster management
- drizzle-orm 0.45.1 - Database layer for events, conversations, memory, preferences
- node-ssh 13.2.1 - SSH client for executing commands on cluster nodes
- undici 7.3.0 - HTTP client for Proxmox API calls (replaces node-fetch)

**Infrastructure:**
- jsonwebtoken 9.0.3 - JWT authentication for API and WebSocket connections
- cors 2.8.6 - Cross-origin resource sharing for frontend
- zod 4.3.6 - Runtime schema validation for MCP tool inputs
- mqtt 5.11.1 - Real-time alerts from Frigate NVR via MQTT broker
- dotenv 17.2.3 - Environment variable configuration

**UI:**
- zustand 5.0.10 - State management
- motion 12.29.0 - Animation library
- sonner 2.0.7 - Toast notifications
- @xterm/xterm 6.0.0 - Terminal emulator for SSH sessions
- react-hotkeys-hook 5.2.3 - Keyboard shortcuts

## Configuration

**Environment:**
- Configuration via `.env` file in `jarvis-backend/`
- Critical environment variables:
  - `ANTHROPIC_API_KEY` - Claude API access
  - `PVE_TOKEN_ID`, `PVE_TOKEN_SECRET` - Proxmox API authentication
  - `JWT_SECRET` - Session token signing
  - `JARVIS_PASSWORD` - Login password
  - `HOME_ASSISTANT_TOKEN` - Smart home integration
  - `LOCAL_LLM_ENDPOINT` - Qwen inference server (http://192.168.1.50:8080)
  - `LOCAL_TTS_ENDPOINT` - XTTS v2 voice synthesis service
  - `WHISPER_ENDPOINT` - Faster-Whisper STT service
  - `FRIGATE_URL` - NVR camera events API
  - `MQTT_BROKER_URL` - Real-time event streaming

**Build:**
- `tsconfig.json` - TypeScript compiler options (both projects)
- `drizzle.config.ts` - Database schema location and connection
- `vitest.config.ts` - Test configuration (backend)
- `vite.config.ts` - Frontend build and dev server configuration
- `.env.example` - Template for required environment variables

**Docker:**
- `docker-compose.yml` - Multi-service deployment orchestration
- `Dockerfile` (backend) - Node.js 22-slim with ffmpeg for Opus encoding
- `Dockerfile` (frontend) - nginx:alpine serving pre-built React app
- Pre-built on host due to AppArmor restrictions in Proxmox kernel

## Platform Requirements

**Development:**
- Node.js 22.x
- npm or compatible package manager
- SQLite support
- SSH key for cluster access (`~/.ssh/id_ed25519`)

**Production:**
- Docker with Docker Compose
- Proxmox VE cluster (API token required)
- SSH key-based authentication to cluster nodes
- Volumes: `jarvis-data` (SQLite, TTS cache), `piper-voices`, `searxng-data`, `whisper-models`
- Optional: NVIDIA GPU for XTTS TTS (falls back to Piper CPU-based TTS)
- Network access to: Proxmox API (8006), LLM server (8080), Home Assistant (8123), Frigate (5000), MQTT (1883)

**External Services:**
- Anthropic Claude API (claude-sonnet-4-20250514)
- Local LLM server (llama-server with Qwen 2.5 7B Instruct Q4_K_M)
- Optional: OpenAI API (TTS fallback), ElevenLabs API (TTS fallback)

---

*Stack analysis: 2026-01-31*

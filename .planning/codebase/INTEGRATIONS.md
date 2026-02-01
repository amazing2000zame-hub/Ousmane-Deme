# External Integrations

**Analysis Date:** 2026-01-31

## APIs & External Services

**AI & Language Models:**
- Anthropic Claude API - Agentic LLM with tool-use capabilities
  - SDK/Client: `@anthropic-ai/sdk` 0.71.2
  - Model: claude-sonnet-4-20250514
  - Auth: `ANTHROPIC_API_KEY` (env var)
  - Purpose: Cluster management, tool execution, autonomous operations
  - Context: 200K tokens
  - Cost tracking: Daily limit enforced via `DAILY_COST_LIMIT`

- Local LLM (Qwen 2.5 7B Instruct) - OpenAI-compatible endpoint
  - Client: `openai` 6.16.0
  - Endpoint: `LOCAL_LLM_ENDPOINT` (default: http://192.168.1.50:8080)
  - Model: qwen2.5-7b-instruct-q4_k_m.gguf
  - Purpose: Zero-cost fallback for basic queries, chat-only mode
  - Context: 8192 tokens (configurable via `QWEN_CONTEXT_WINDOW`)
  - Implementation: llama-server (llama.cpp) running on Home node

**Text-to-Speech:**
- Local XTTS v2 (preferred) - Custom JARVIS voice clone
  - Endpoint: `LOCAL_TTS_ENDPOINT` (default: http://jarvis-tts:5050)
  - Technology: Coqui XTTS v2 zero-shot voice cloning
  - Voice: Custom fine-tuned JARVIS voice from reference audio
  - Format: WAV PCM (optionally encoded to Opus)
  - Disk cache: `/data/tts-cache` (500 entries max, configurable)
  - Fallback behavior: Auto-switches to Piper on timeout/failure

- Piper TTS (CPU fallback) - Fast neural TTS
  - Endpoint: `PIPER_TTS_ENDPOINT` (default: http://jarvis-piper:5000)
  - Technology: Piper ONNX neural TTS (hfc_male medium model)
  - Purpose: Fast fallback when XTTS is slow or unavailable (<200ms latency)
  - Container: artibex/piper-http:latest

- OpenAI TTS (tertiary fallback) - Cloud-based TTS
  - Client: `openai` 6.16.0
  - Auth: `OPENAI_API_KEY`
  - Model: tts-1 (configurable via `TTS_MODEL`)
  - Voice: onyx (configurable via `TTS_VOICE`)
  - Speed: 1.0 (configurable via `TTS_SPEED`)

- ElevenLabs (tertiary fallback) - Premium voice synthesis
  - Auth: `ELEVENLABS_API_KEY`
  - Voice ID: onwK4e9ZLuTAKqWW03F9 ("Daniel" — deep British male)
  - Model: eleven_multilingual_v2
  - Settings: stability 0.5, similarity 0.75, style 0.4

**Speech-to-Text:**
- Whisper (Faster-Whisper) - Server-side voice transcription
  - Endpoint: `WHISPER_ENDPOINT` (default: http://jarvis-whisper:5051)
  - Model: medium.en (OpenAI Whisper)
  - Compute: int8 quantization, 4 CPU threads
  - Purpose: Voice input transcription for chat and voice modes
  - Implementation: Custom Python service with faster-whisper

**Proxmox VE API:**
- Proxmox REST API - Cluster management
  - Client: Custom `ProxmoxClient` class using `undici` 7.3.0
  - Endpoint: https://{node}:8006/api2/json
  - Auth: API token (`PVE_TOKEN_ID` + `PVE_TOKEN_SECRET`)
  - TLS: Self-signed certificates accepted via custom undici Agent
  - Purpose: VM/CT lifecycle, cluster status, resource monitoring, node management
  - Nodes: Home (192.168.1.50), pve (192.168.1.74), agent1 (192.168.1.61), agent (192.168.1.62)
  - Implementation: `jarvis-backend/src/clients/proxmox.ts`

**Smart Home:**
- Home Assistant REST API - Device control and automation
  - Client: Custom HTTP client using `fetch`
  - Endpoint: `HOME_ASSISTANT_URL` (default: http://192.168.1.54:8123)
  - Auth: Long-lived access token (`HOME_ASSISTANT_TOKEN`)
  - Purpose: Lights, climate (Ecobee), door locks, presence detection
  - Implementation: `jarvis-backend/src/clients/homeassistant.ts`

- Frigate NVR API - Security camera AI object detection
  - Client: Custom HTTP client using `fetch`
  - Endpoint: `FRIGATE_URL` (default: http://192.168.1.61:5000)
  - Auth: None (LAN-only access)
  - Purpose: Camera events, snapshots, recordings, face recognition
  - Features: Person detection, zone filtering, sub-label face matching
  - Implementation: `jarvis-backend/src/clients/frigate.ts`

**Web Search:**
- SearXNG - Privacy-focused metasearch engine
  - Endpoint: `SEARXNG_URL` (default: http://jarvis-searxng:8080)
  - Auth: None (internal Docker network)
  - Purpose: Web search for AI tool-use (search_web MCP tool)
  - Container: searxng/searxng:latest

**Model Context Protocol:**
- MCP SDK - Tool registration and execution framework
  - SDK: `@modelcontextprotocol/sdk` 1.25.3
  - Purpose: Schema validation, tool routing, safety checks
  - Tools: 32 total across 8 categories (cluster, lifecycle, system, files, transfer, projects, voice, smarthome, web)
  - Implementation: `jarvis-backend/src/mcp/server.ts`

## Data Storage

**Databases:**
- SQLite (embedded) - Primary data store
  - Connection: `DB_PATH` (default: /data/jarvis.db in Docker)
  - Client: Drizzle ORM with better-sqlite3 driver
  - Schema: Events, conversations, cluster snapshots, preferences, memories (episodic, semantic, preferences)
  - Schema file: `jarvis-backend/src/db/schema.ts`
  - Migrations: Drizzle Kit (`npm run db:generate`, `npm run db:push`)

**File Storage:**
- Local filesystem (Docker volumes)
  - TTS cache: `/data/tts-cache` (persistent WAV files, 500 entry limit)
  - XTTS models: `/models` (voice cloning weights, mounted from `/opt/jarvis-tts/models`)
  - XTTS voices: `/voices` (reference audio clips, mounted from `/opt/jarvis-tts/voices`)
  - Piper voices: `piper-voices` volume
  - Whisper models: `whisper-models` volume
  - SearXNG config: `searxng-data` volume

**Caching:**
- In-memory caches:
  - Proxmox cluster status (60s TTL)
  - Proxmox cluster resources (15s TTL)
  - XTTS health check (60s TTL)
  - Whisper health check (60s TTL)
- Disk cache:
  - TTS audio (persistent, hash-keyed WAV files)

## Authentication & Identity

**Auth Provider:**
- Custom JWT authentication
  - Implementation: `jsonwebtoken` 9.0.3
  - Login: Password-based (`JARVIS_PASSWORD`)
  - Session: JWT token with secret (`JWT_SECRET`)
  - Endpoints: `/api/auth/login`
  - WebSocket: Token passed in Socket.IO `auth` field

**Cluster Access:**
- SSH key-based authentication
  - Client: `node-ssh` 13.2.1
  - Key path: `SSH_KEY_PATH` (default: /app/.ssh/id_ed25519)
  - Mounted from host: `/root/.ssh/id_ed25519` → `/app/.ssh/id_ed25519` (read-only)
  - Known hosts: Mounted from `/root/.ssh/known_hosts`
  - Purpose: Execute commands on cluster nodes (Home, pve, agent1, agent)

## Monitoring & Observability

**Error Tracking:**
- None (logs to stdout/stderr)

**Logs:**
- Docker JSON file driver
  - Backend: 10MB max, 3 files
  - Frontend: 5MB max, 3 files
  - TTS: 10MB max, 3 files
  - Piper: 5MB max, 3 files
  - Whisper: 10MB max, 3 files

**Metrics:**
- Custom event logging to SQLite `events` table
  - Types: alert, action, status, metric
  - Severity: info, warning, error, critical
  - Source: monitor, user, jarvis, system
  - Schema: `jarvis-backend/src/db/schema.ts`

**Health Checks:**
- Backend: `GET /api/health?liveness` (30s interval)
- Frontend: nginx root health endpoint (30s interval)
- TTS: `GET /health` (30s interval, 5 min start period)
- Piper: HTTP POST to root with test data (30s interval, 60s start period)
- Whisper: `GET /health` (30s interval, 2 min start period)

## CI/CD & Deployment

**Hosting:**
- Docker Compose on Proxmox Home node (192.168.1.50)
  - Backend: Port 4000
  - Frontend: Port 3004 (nginx reverse proxy)
  - Piper TTS: Port 5000
  - Whisper STT: Port 5051

**CI Pipeline:**
- None (manual deployment)

**Deployment Process:**
- Build on host: `npm ci && npm run build` (both projects)
- Reason: AppArmor blocks `child_process.spawn` in Docker builds on Proxmox kernel
- Deploy: `docker compose up -d --build` from `/root/`

## Environment Configuration

**Required env vars:**
- `JWT_SECRET` - Session token signing (production only)
- `JARVIS_PASSWORD` - Login password
- `PVE_TOKEN_ID` - Proxmox API token (default: root@pam!jarvis)
- `PVE_TOKEN_SECRET` - Proxmox API secret

**Optional but recommended:**
- `ANTHROPIC_API_KEY` - Claude API access (required for tool-use mode)
- `HOME_ASSISTANT_TOKEN` - Smart home control
- `JARVIS_OVERRIDE_KEY` - Emergency override passphrase
- `JARVIS_APPROVAL_KEYWORD` - ORANGE tier operation approval keyword (default: JARVIS-EXECUTE)

**Secrets location:**
- `.env` file in `jarvis-backend/` (Docker Compose reads from this)
- Mounted SSH key: `/root/.ssh/id_ed25519` (read-only)

## Webhooks & Callbacks

**Incoming:**
- None (polling-based integrations)

**Outgoing:**
- None

## Message Queues & Real-Time

**MQTT:**
- Broker: Frigate MQTT broker
  - URL: `MQTT_BROKER_URL` (default: mqtt://192.168.1.61:1883)
  - Client: `mqtt` 5.11.1
  - Client ID: jarvis-backend (configurable via `MQTT_CLIENT_ID`)
  - Topics: `frigate/events`, `frigate/+/person/snapshot` (person detection)
  - Purpose: Real-time camera alerts (person detected, entry cameras)
  - Implementation: `jarvis-backend/src/services/mqtt-alert-service.ts`
  - Enabled by default (disable via `MQTT_ENABLED=false`)

**WebSocket (Socket.IO):**
- Namespaces:
  - `/cluster` - Cluster status, resource updates
  - `/events` - Alert events, action logs
  - `/terminal` - Interactive SSH terminals
  - `/chat` - Text chat with LLM
  - `/voice` - Voice chat with STT/TTS
- Auth: JWT token in connection `auth` field
- Reconnection: Automatic with exponential backoff (1s-5s)

## Smart Home Presence Detection

**Implementation:**
- ARP scan via `arp -a` on cluster nodes
  - Purpose: Detect known devices on LAN (iPhones, laptops)
  - Configuration: `PRESENCE_DEVICES` JSON array (MAC, name, owner, IP)
  - States: present, away, just_left, just_arrived
  - Cooldown: 2 minutes for state transitions
  - Implementation: `jarvis-backend/src/presence/tracker.ts`

---

*Integration audit: 2026-01-31*

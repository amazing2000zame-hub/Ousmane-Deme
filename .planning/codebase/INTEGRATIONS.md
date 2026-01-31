# External Integrations

**Analysis Date:** 2026-01-20

## APIs & External Services

**Proxmox VE Cluster Management:**
- Proxmox API (`pvesh` CLI) - Core cluster control
  - SDK/Client: Command-line interface via Node.js `child_process.exec()`
  - Integration: `backend/src/services/proxmox.ts` - Wraps `pvesh` commands
  - Authentication: PAM (Linux system auth) via `/access/ticket` endpoint
  - Endpoints used:
    - `/nodes` - List all cluster nodes
    - `/cluster/resources` - List all VMs/containers across cluster
    - `/nodes/{node}/storage` - Get storage info
    - `/nodes/{node}/qemu/{vmid}/status/{action}` - Start/stop/shutdown VMs
    - `/nodes/{node}/lxc/{vmid}/status/{action}` - Start/stop/shutdown containers
    - `/access/ticket` - Authenticate and get session ticket

**Ollama Local LLM Service:**
- Local LLM inference via Ollama
  - SDK/Client: `ollama` Python package (AsyncClient)
  - Service: Runs at `http://localhost:11434` (configurable in `jarvis.yaml`)
  - Integration: `jarvis/llm/ollama_client.py` - Async LLM conversation client
  - Models: Pulled on demand (default `mistral:7b-instruct-q4_0`)
  - Features: Chat with conversation history, model listing

**Speech-to-Text (Whisper):**
- faster-whisper model inference
  - SDK/Client: `faster-whisper` Python package
  - Models: `base.en`, `tiny.en`, `small.en`, `medium.en` (configurable)
  - Device: CPU or CUDA (configured in `jarvis.yaml`, default CUDA)
  - Integration: `jarvis/voice/stt.py` - Audio transcription
  - Compute type: `float16` (default) or `int8` for CPU

**Text-to-Speech (Piper TTS):**
- Local voice synthesis
  - SDK/Client: `piper-tts` Python package
  - Model: `en_US-ryan-high` (JARVIS-like voice, default)
  - Integration: `jarvis/voice/tts.py` - Speech synthesis
  - Speaker ID: Configurable (default 0)
  - Features: Can load custom trained voice models from ONNX files

**Wake Word Detection (Porcupine):**
- Local wake word detection
  - SDK/Client: `pvporcupine` Python package
  - Access key: Requires Picovoice API key (get from https://picovoice.ai/)
  - Keyword: `jarvis` (configurable)
  - Sensitivity: 0.5 (configurable, 0-1)
  - Integration: `jarvis/voice/wake_word.py`

**SSH Remote Access:**
- Remote command execution on cluster nodes
  - Integration: `backend/src/services/proxmox.ts` and `jarvis/skills/server_control.py`
  - Uses: `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5/10`
  - For: Temperature reads, package updates, node reboot commands
  - Targets: All cluster nodes by IP (192.168.1.50, 192.168.1.74, 192.168.1.61, 192.168.1.62)

## Data Storage

**Databases:**
- None detected - fully stateless API

**File Storage:**
- Local filesystem only
- Configuration: `/root/jarvis-v3/config/jarvis.yaml` (YAML format)
- Voice models: Cached in system directory (managed by `faster-whisper` and `piper-tts`)
- No persistent data store

**Caching:**
- In-memory conversation history (Ollama client)
  - Location: `OllamaClient._conversation_history` in `jarvis/llm/ollama_client.py`
  - Trimmed to last 20 messages automatically
- Node.js WebSocket session cache
  - Location: `sessions` Map in `backend/src/websocket/terminal.ts`
  - Holds active PTY connections per WebSocket

## Authentication & Identity

**Auth Provider:**
- Proxmox PAM (custom integration)
  - Implementation: `backend/src/services/proxmox.ts::authenticatePAM()`
  - Method: Direct authentication via `pvesh create /access/ticket`
  - User format: `username@pam` (Proxmox system users)
  - Cred verification: Username + password against Proxmox PAM module

**JWT Token Management:**
- Custom implementation in `backend/src/middleware/auth.ts`
  - Secret: `JWT_SECRET` env var (defaults to `proxmox-ui-secret-change-in-production`)
  - Expiration: 8 hours
  - Token format: Bearer token in Authorization header
  - Verification: All protected routes use `authMiddleware`
  - Routes protected: All `/api/nodes/*`, `/api/cluster/*`, WebSocket terminal at `/ws/terminal`

## Monitoring & Observability

**Error Tracking:**
- None detected - basic console logging only

**Logs:**
- Node.js: Console output via `console.log()` and `console.error()`
- Python: `logging` module with default logger in each module
- No log aggregation or centralized logging

**Temperature Monitoring:**
- Hardware: Reads from `/sys/class/thermal/thermal_zone*/temp`
- Remote nodes: Via SSH fallback if direct read fails
- Integration: `backend/src/services/proxmox.ts::getNodeTemperature()`

**System Updates:**
- APT package manager queries via SSH or local
- Command: `apt list --upgradable`
- Integration: `backend/src/services/proxmox.ts::getNodeUpdates()`

## CI/CD & Deployment

**Hosting:**
- Proxmox VE cluster (192.168.1.50 - Home node)
- Deployment: Manual (no CI/CD pipeline detected)

**CI Pipeline:**
- None detected - no GitHub Actions, GitLab CI, or other automation

## Environment Configuration

**Required env vars:**
- `PORT` - Express server port (defaults to 3001)
- `JWT_SECRET` - For JWT signing (defaults to insecure placeholder)
- `OLLAMA_HOST` - Ollama service URL (defaults to `http://localhost:11434`)

**Secrets location:**
- None configured - defaults used inline
- Should be moved to `.env` or system environment variables before production use
- Critical: Change `JWT_SECRET` from default value

## Webhooks & Callbacks

**Incoming:**
- None detected - no webhook receivers

**Outgoing:**
- None detected - no external callbacks or notifications

## Network Topology

**Frontend to Backend:**
- Frontend: `http://localhost:3000` (Vite dev server)
- Backend: `http://localhost:3001` (Express API)
- API proxy: Vite config in `frontend/vite.config.ts` proxies `/api` and `/ws` to backend
- Terminal WebSocket: `ws://localhost:3001/ws/terminal`

**Backend to Proxmox:**
- Local `pvesh` commands on Home node (192.168.1.50)
- SSH to remote nodes for:
  - Temperature: `ssh root@{node_ip} 'cat /sys/class/thermal...'`
  - Updates: `ssh root@{node_ip} 'apt list --upgradable'`
  - Reboot: `ssh root@{node_ip} 'reboot'`

**Jarvis to Services:**
- Ollama: HTTP to `http://localhost:11434` (configurable)
- Audio devices: Direct hardware access
- Proxmox cluster: Via subprocess calls to `pvesh`, `ping`, `ssh`

---

*Integration audit: 2026-01-20*

# Codebase Concerns

**Analysis Date:** 2026-01-20

## Security Considerations

**Hardcoded JWT Secret:**
- Risk: Default JWT_SECRET in production exposes sessions to compromise
- Files: `proxmox-ui/backend/src/middleware/auth.ts` (line 4)
- Current mitigation: Environment variable fallback available but not enforced
- Recommendations: Require JWT_SECRET env var, fail startup if not set. Rotate secrets regularly. Add token expiration enforcement in validation.

**Command Injection in Shell Execution:**
- Risk: SSH commands and Proxmox API calls use string interpolation without proper escaping
- Files: `proxmox-ui/backend/src/services/proxmox.ts` (lines 55-56, 86, 113-114), `jarvis-v3/src/jarvis/skills/server_control.py` (lines 89-90)
- Current mitigation: pvesh/SSH StrictHostKeyChecking=no set, but user input sanitization missing
- Recommendations: Use array-based exec calls instead of shell interpolation. Validate/whitelist node names and VMID inputs. Never pass raw user input to shell.

**Password Authentication Over Plaintext:**
- Risk: PAM authentication passes credentials via command-line arguments, visible in process list
- Files: `proxmox-ui/backend/src/services/proxmox.ts` (line 157)
- Current mitigation: Only used internally, but still risky
- Recommendations: Use Proxmox API token auth instead. Store credentials in secure secrets manager. Mask command-line arguments in logging.

**WebSocket Terminal Access Without Rate Limiting:**
- Risk: No rate limiting on terminal commands; attacker could execute rapid destructive commands
- Files: `proxmox-ui/backend/src/websocket/terminal.ts`
- Current mitigation: Token verification present, but no command throttling or audit logging
- Recommendations: Add rate limiting per session. Log all terminal commands to audit trail. Implement command whitelisting for critical operations.

**Unsafe SSH Key Configuration:**
- Risk: StrictHostKeyChecking=no disables host key verification, vulnerable to MITM attacks
- Files: `proxmox-ui/backend/src/services/proxmox.ts` (lines 86, 113), `proxmox-ui/backend/src/websocket/terminal.ts` (line 34), `jarvis-v3/src/jarvis/skills/server_control.py` (line 89)
- Current mitigation: Only used on internal network
- Recommendations: Use known_hosts file. Add host key fingerprint validation. Set StrictHostKeyChecking=accept-new instead of no.

## Test Coverage Gaps

**Jarvis Core - No Unit Tests:**
- What's not tested: All core orchestration logic (`core.py`), LLM integration, skill dispatch
- Files: `jarvis-v3/src/jarvis/core.py`, `jarvis-v3/src/jarvis/llm/ollama_client.py`, `jarvis-v3/src/jarvis/skills/__init__.py`
- Risk: Refactoring or dependency updates could break core flows undetected
- Priority: High

**Jarvis Skills - Limited Error Paths:**
- What's not tested: Exception handling in skill execution, timeout behavior, malformed responses
- Files: `jarvis-v3/src/jarvis/skills/server_control.py` (skill execution), `jarvis-v3/src/jarvis/skills/system_info.py`, `jarvis-v3/src/jarvis/skills/time_date.py`
- Risk: Server control skill could fail silently during cluster operations
- Priority: High

**Proxmox UI Backend - No Tests:**
- What's not tested: API endpoints, error scenarios, authentication flows
- Files: `proxmox-ui/backend/src/routes/nodes.ts`, `proxmox-ui/backend/src/routes/cluster.ts`, `proxmox-ui/backend/src/services/proxmox.ts`
- Risk: Breaking changes to Proxmox API communication undetected
- Priority: Medium

**Proxmox UI Frontend - Placeholder Code:**
- What's not tested: All UI components, state management, API integration
- Files: `proxmox-ui/frontend/src/App.tsx` (default Vite template, not implemented)
- Risk: Frontend is essentially non-functional scaffold
- Priority: Medium

**Voice Components - Partial Testing:**
- What's not tested: Wake word detection accuracy, audio streaming edge cases, TTS streaming failures
- Files: `jarvis-v3/src/jarvis/voice/wake_word.py`, `jarvis-v3/src/jarvis/voice/stt.py`, `jarvis-v3/src/jarvis/voice/tts.py`
- Risk: Silent failures in audio pipeline during production use
- Priority: Medium

## Error Handling Issues

**Swallowed Exceptions in Proxmox Services:**
- Problem: Error details hidden from client; all failures return generic "Failed to fetch X" messages
- Files: `proxmox-ui/backend/src/routes/nodes.ts` (lines 12-14, 22-24, 32-34, etc.), `proxmox-ui/backend/src/routes/cluster.ts`
- Impact: Debugging cluster issues impossible; users see unhelpful errors
- Fix approach: Log full error details server-side, return sanitized but informative client errors, implement structured error responses

**Silent Fallbacks Masking Failures:**
- Problem: SSH failures silently fall back to local execution; config errors hidden
- Files: `proxmox-ui/backend/src/services/proxmox.ts` (lines 84-109 getNodeTemperature, 111-127 getNodeUpdates)
- Impact: User may think command ran remotely when it actually ran locally
- Fix approach: Return error status indicating fallback occurred. Log which nodes failed. Require explicit configuration.

**Unhandled Promise Rejections:**
- Problem: Async operations in Jarvis don't always await; failures don't bubble up
- Files: `jarvis-v3/src/jarvis/core.py` (lines 125-146 callback execution without try-catch)
- Impact: UI callbacks failing could crash skill execution silently
- Fix approach: Wrap callback invocations in try-catch. Log callback errors separately. Continue processing on callback failure.

**Skill Execution Catches All Exceptions:**
- Problem: Broad exception catch hides actual cause of failure
- Files: `jarvis-v3/src/jarvis/skills/__init__.py` (lines 62-66)
- Impact: Different failure modes (timeout, permission denied, network) all treated identically
- Fix approach: Catch specific exceptions, log full traceback, return error type to user

## Tech Debt

**Jarvis Server Control Skill - Complex String Parsing:**
- Issue: Regex-based VMID extraction fragile; relies on hardcoded VM names
- Files: `jarvis-v3/src/jarvis/skills/server_control.py` (lines 188-206)
- Impact: Command matching unreliable for VMs with similar names; easy to accidentally control wrong VM
- Fix approach: Build VMID lookup table, validate against known VMs before executing, require explicit confirmation for destructive actions

**Proxmox Service - Mixing Concerns:**
- Issue: Shell execution, Proxmox API calls, SSH commands all in one service file
- Files: `proxmox-ui/backend/src/services/proxmox.ts` (165 lines)
- Impact: Testing individual operations difficult; changes to one API break others
- Fix approach: Split into ProxmoxClient (pvesh), SSHClient, and SystemClient classes. Each handles one concern.

**Conversation History Trimming - Off-by-One Risk:**
- Issue: History trimming logic uses max_history + system prompt, easy to exceed max
- Files: `jarvis-v3/src/jarvis/llm/ollama_client.py` (lines 155-162)
- Impact: Conversation context grows unbounded if max_history calculation wrong
- Fix approach: Enforce hard limit regardless of calculation. Add metrics for actual history size. Test with large conversations.

**Configuration Loading - Silent Defaults:**
- Issue: Missing config file silently loads defaults; typos in config.yaml not detected
- Files: `jarvis-v3/src/jarvis/core.py` (lines 39-46)
- Impact: User thinks system is configured for "mistral" but it's actually using "llama"
- Fix approach: Fail startup if config file expected but missing. Validate config schema. Log all loaded values.

**Wake Word Detection - Mixed Threading/Async:**
- Issue: Blocking sounddevice operations run in executor; asyncio.Event used alongside threading.Event
- Files: `jarvis-v3/src/jarvis/voice/wake_word.py` (lines 42, 81-98, 100-132)
- Impact: Race conditions between detection thread and async main loop; event cleanup incomplete
- Fix approach: Use asyncio-based audio library or wrapper. Single event model. Proper cleanup in finally blocks.

## Fragile Areas

**Jarvis Cluster Control Skill:**
- Files: `jarvis-v3/src/jarvis/skills/server_control.py`
- Why fragile: Hardcoded node IPs and names; will break if cluster topology changes. Pattern matching on user input could match unintended commands (e.g., "start twingate" matching "twingate" in any context).
- Safe modification: Add node registry pattern. Use exact word boundaries for matching. Require node names to be explicitly whitelisted. Add dry-run mode for destructive operations.
- Test coverage: Zero tests. Missing edge cases: non-existent node names, timeouts, permission errors, partial failures in multi-command sequences.

**Proxmox Backend Proxmox Service:**
- Files: `proxmox-ui/backend/src/services/proxmox.ts`
- Why fragile: Direct shell execution to pvesh; minimal input validation. Any Proxmox API change breaks all endpoints. SSH fallback masks failures.
- Safe modification: Validate inputs before shell execution. Use Proxmox REST API client library instead of shell. Add contract tests against real Proxmox API. Mock Proxmox responses for unit tests.
- Test coverage: Zero tests. Missing validation: VMID numeric checks, node name whitelist, command existence verification.

**Proxmox Terminal WebSocket:**
- Files: `proxmox-ui/backend/src/websocket/terminal.ts`
- Why fragile: Raw PTY spawning with SSH; no input sanitization; no command history/audit trail; session cleanup incomplete on network errors.
- Safe modification: Validate node parameter against known cluster nodes. Implement command whitelist (no arbitrary shell access). Add session logging. Use try-finally for cleanup.
- Test coverage: Zero tests. Missing: EOF handling, oversized input, rapid reconnects, cleanup after ungraceful close.

**Jar Management VM Initialization:**
- Files: `jarvis-v3/src/jarvis/core.py` (lines 80-112 async initialize)
- Why fragile: Component initialization order matters but not enforced. If LLM init fails, skills still initialized pointing to None. No health checks.
- Safe modification: Use initialization class that enforces order. Return health status. Add verify() method to check all components. Skip failed components gracefully.
- Test coverage: Zero tests. Missing: out-of-order initialization, missing dependencies, component timeouts.

## Performance Bottlenecks

**Conversation History Not Bounded at Runtime:**
- Problem: History can exceed _max_history if calculation wrong or many messages arrive rapidly
- Files: `jarvis-v3/src/jarvis/llm/ollama_client.py` (lines 154-162)
- Cause: Trimming happens after history append, not before. If user sends 10+ messages rapidly, all accumulate before trim.
- Improvement path: Trim before append. Use deque with maxlen. Add metrics for memory usage.

**Proxmox Shell Commands Timeout at 30 Seconds:**
- Problem: Slow cluster operations (rebuilding storage, large migrations) timeout
- Files: `proxmox-ui/backend/src/services/proxmox.ts` (line 43, 57, 115)
- Cause: Hard-coded 30s timeout across all operations; not operation-specific
- Improvement path: Use per-operation timeouts (10s for status, 60s for control actions, 300s for long operations). Return partial results. Implement polling for long operations.

**SSH Connection Reuse Missing:**
- Problem: Each SSH call spawns new connection; full handshake overhead
- Files: `proxmox-ui/backend/src/websocket/terminal.ts` (line 33), `proxmox-ui/backend/src/services/proxmox.ts` (lines 86, 113)
- Cause: exec() calls create new processes for each operation
- Improvement path: Connection pooling. SSH session reuse. Batch operations.

**Audio Processing Blocks Event Loop:**
- Problem: Whisper transcription and Porcupine processing run synchronously in executor; if slow, blocks other operations
- Files: `jarvis-v3/src/jarvis/voice/stt.py` (lines 161-184), `jarvis-v3/src/jarvis/voice/wake_word.py` (lines 100-132)
- Cause: No async audio libraries; using run_in_executor as workaround
- Improvement path: Use truly async audio library (e.g., soundio-async). Profile real latency. Add timeout monitoring.

## Dependencies at Risk

**Proxmox API Stability:**
- Risk: All cluster control depends on pvesh command-line tool; no formal API contract
- Impact: Proxmox version upgrade could break shell command format
- Migration plan: Implement Proxmox REST API client (official/maintained). Add API version detection. Version-specific command mapping.

**Ollama Model Availability:**
- Risk: Model name hardcoded as "mistral:7b-instruct-q4_0"; if model removed from registry, system fails silently
- Impact: User gets "model not found" error but fallback just pulls model (could be 7GB download)
- Migration plan: Validate model exists before initialization. Implement model fallback list. Add download progress tracking.

**Porcupine Access Key Requirement:**
- Risk: Wake word detection requires Picovoice access key; service dependency
- Impact: Without key, wake word detection in mock mode only; unreliable for production
- Migration plan: Support open-source wake word detection (openWakeWord). Make Porcupine optional. Document fallback behavior.

## Missing Critical Features

**No Persistent Storage for Conversation Context:**
- Problem: Conversation history lost when Jarvis restarts
- Blocks: Multi-turn context across sessions. Learning user preferences.

**No Cluster State Validation Before Destructive Operations:**
- Problem: Server control skill can blindly execute commands without checking preconditions
- Blocks: Safe automated cluster operations. Prevents accidental cascade failures (e.g., stopping primary node).

**No Audit Trail for Cluster Operations:**
- Problem: No logging of who executed which command and when
- Blocks: Compliance, troubleshooting, accountability. Can't trace if someone accidentally restarted wrong VM.

**No Input Validation in Shell Execution:**
- Problem: All shell commands pass through without sanitization
- Blocks: Secure terminal access. Prevents injection attacks.

**Frontend UI Not Implemented:**
- Problem: Proxmox UI frontend is default Vite template scaffold
- Blocks: Cluster management from web interface. Only backend API available.

---

*Concerns audit: 2026-01-20*

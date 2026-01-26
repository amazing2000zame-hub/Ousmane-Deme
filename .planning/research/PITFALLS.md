# Domain Pitfalls -- Milestone: Hybrid LLM, Memory, Docker, E2E Testing

**Domain:** Adding hybrid LLM routing, persistent memory, Docker deployment, and E2E testing to an existing infrastructure management tool (Jarvis 3.1)
**Researched:** 2026-01-26
**Confidence:** HIGH (verified against current codebase analysis, official docs, and multiple community sources)

**Scope:** This document focuses on pitfalls specific to ADDING these four capabilities to the EXISTING Jarvis 3.1 codebase. Foundation-level pitfalls (safety tiers, prompt injection, self-management paradox) were documented in the initial project research and are not repeated here.

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or major production incidents.

---

### Pitfall 1: Keyword-Based LLM Routing Misclassifies Messages (Cost and Quality Impact)

**What goes wrong:** The current routing in `chat.ts` (line 25-48) uses a 42-keyword list (`TOOL_KEYWORDS`) to decide between Claude and local LLM. This approach has two failure modes:
- **False positive:** "Tell me about the concept of cluster computing" routes to Claude because it contains "cluster" -- wastes API budget on a question the local LLM handles fine.
- **False negative:** "Are any machines down?" routes to local LLM because none of the keywords match -- misses a clear cluster query that needs tools.

**Why it happens:** Keyword matching is a brittle heuristic. The list was built for initial development, not for production cost optimization. Every new tool or capability requires manually adding keywords, and the list never shrinks.

**Consequences:**
- Claude API costs 10-50x higher than necessary per false-positive query (~$0.01-0.10 each)
- The system prompt alone (`buildClusterSummary` fetches live cluster data via `executeTool`) consumes ~800-1200 tokens of Claude context on every routed message, even when tools are not actually needed
- Users get degraded responses when cluster queries route to local LLM (4096-token context, no tools, ~6.5 tok/sec)
- No feedback loop: nobody knows which queries were misrouted

**Prevention:**
- Replace keyword matching with a two-tier classifier:
  1. Fast regex patterns for obvious cases (questions containing node names, VMIDs, explicit action verbs like "restart", "stop", "check status")
  2. For ambiguous messages, use a lightweight classification prompt to the local LLM (~50 tokens in/out, classifies in <2 seconds): "Does this message require cluster infrastructure tools? YES or NO"
- Implement a `force_provider` option in the chat payload so the UI can let users explicitly choose Claude when the router guesses wrong
- Add per-query cost logging to the `conversations` table (the `tokensUsed` field exists but is only populated for assistant messages, not for measuring routing efficiency)
- Track misrouting rate by logging router decisions and correlating with user follow-up patterns

**Detection:** Query the `conversations` table for Claude messages with <500 output tokens (likely misrouted) or local LLM messages where the user immediately re-asks the same question (routing miss). Monitor `tokensUsed` aggregates per day.

**Which phase should address it:** Phase 1 (Hybrid LLM Routing) -- this is the core problem the routing system must solve.

---

### Pitfall 2: Context Window Overflow on Local LLM Silently Degrades Responses

**What goes wrong:** The local Qwen 2.5 7B has only 4096 tokens of context. The system prompt from `buildSystemPrompt()` is approximately 1500-2000 tokens (identity block ~400 tokens, capability descriptions ~300 tokens, safety rules ~200 tokens, cluster knowledge ~200 tokens, override section ~150 tokens, plus `buildClusterSummary()` which fetches live data adding ~500-800 tokens). With `chatHistoryLimit: 20` messages (config.ts line 45), a conversation of even moderate length will exceed 4096 tokens. The local LLM silently truncates input and produces incoherent or hallucinated responses.

**Why it happens:** The `runLocalChat()` function in `local-llm.ts` sends all messages without any token counting or truncation logic. The `chatHistoryLimit` of 20 was designed for Claude's 200K context, not a 4096-token local model. Worse, the system prompt includes live cluster data via `buildClusterSummary()` even for the local LLM, which does not have tool access -- wasting precious context tokens on information the model cannot act on.

**Consequences:**
- After 3-5 conversational turns, local LLM responses become incoherent or repetitive
- Users blame "the AI" and switch to Claude for all queries, defeating the cost-saving purpose of hybrid routing
- Silent truncation means no error is raised -- the problem is invisible until users complain
- The system prompt wastes ~500-800 tokens on live cluster data that the local LLM cannot use (it has no tools to query or act on cluster state)

**Prevention:**
- Implement a separate, much shorter system prompt for local LLM (~200-300 tokens) that omits tool instructions, safety tier details, override passkey mechanics, and live cluster data. Keep only the JARVIS personality and basic cluster knowledge.
- Set a separate `localLlmHistoryLimit` config option, defaulting to 4-6 messages (not 20)
- Implement token estimation before sending to local LLM. Use a simple heuristic (1 token per ~3.5 characters for English) since Qwen uses a similar BPE tokenizer. Truncate oldest messages first when approaching budget.
- Reserve at least 1024 tokens for output (`max_tokens: 1024` is already set in `local-llm.ts` line 48). This means input must be capped at ~3000 tokens.
- Emit a `context_overflow` warning to the client when estimated tokens exceed 80% of the 4096-token window, so the UI can suggest starting a new session

**Detection:** Log estimated input token counts for every local LLM request. Alert when input exceeds 3000 tokens. Track average response length -- if it drops below 50 tokens for multi-turn conversations, context overflow is likely.

**Which phase should address it:** Phase 1 (Hybrid LLM Routing) -- context management is integral to routing design.

---

### Pitfall 3: SQLite WAL Files Lost or Corrupted in Docker Volume Mounts

**What goes wrong:** SQLite in WAL mode (enabled in `db/index.ts` line 15: `sqlite.pragma('journal_mode = WAL')`) creates three files: `.db`, `.db-wal`, and `.db-shm`. If the Docker volume mount separates the database file from its WAL/SHM files, or if the container is killed without graceful shutdown, the WAL file may contain uncommitted transactions that are lost. The current `DB_PATH` default is `./data/jarvis.db` -- a relative path that resolves differently in Docker vs dev.

**Why it happens:** Docker's default behavior on `docker stop` is to send SIGTERM, wait 10 seconds, then SIGKILL. The current codebase has NO SIGTERM handler anywhere -- no graceful shutdown for the HTTP server, Socket.IO, SSH connection pool, or SQLite database. When SIGKILL arrives, WAL data is lost. Additionally, SQLite's WAL mode creates the `.db-wal` and `.db-shm` files as peers to the `.db` file. If a Docker volume mount targets only the `.db` file (instead of the entire directory), the WAL/SHM files are created inside the container's ephemeral filesystem and are destroyed on restart.

**Consequences:**
- Conversation history, events, autonomy actions, and cluster snapshots silently lost on container restart
- WAL file corruption if container is force-killed during a write transaction
- "database is locked" (`SQLITE_BUSY`) errors if the `.db-wal` file has stale locks from a crashed container
- Data loss appears intermittent and is extremely difficult to reproduce or debug

**Prevention:**
- Mount the entire `/data` directory as a Docker named volume, never individual files:
  ```yaml
  volumes:
    - jarvis-data:/data
  ```
- Add explicit graceful shutdown handler that calls `sqlite.close()` before process exit:
  ```typescript
  process.on('SIGTERM', async () => {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.close();
    process.exit(0);
  });
  ```
- Set `PRAGMA wal_checkpoint(TRUNCATE)` on a periodic timer (every 60 seconds) to flush WAL to the main database file, reducing the data loss window on ungraceful shutdown
- Use absolute path for `DB_PATH` in Docker environment: `/data/jarvis.db`
- Set `stop_grace_period: 30s` in docker-compose.yml to give Node time to flush
- Consider `PRAGMA locking_mode=EXCLUSIVE` since only one process accesses the DB (eliminates SHM file, simplifies Docker persistence)

**Detection:** After container restart, compare `SELECT COUNT(*) FROM events WHERE timestamp > datetime('now', '-1 hour')` with expected count from monitoring frequency. If events are missing, WAL data was lost. Monitor `.db-wal` file size -- if it grows continuously without shrinking, checkpointing is not happening.

**Which phase should address it:** Phase 3 (Docker Deployment) -- must be solved before deploying to production containers.

---

### Pitfall 4: SSH Keys Baked into Docker Image or Leaked via Layer History

**What goes wrong:** The Dockerfile creates `/app/.ssh` (line 33) and the config defaults `SSH_KEY_PATH` to `/app/.ssh/id_ed25519`. The current Dockerfile correctly does NOT copy keys during build -- but there is no `.dockerignore` file, no documentation prohibiting it, and no safeguard. A future developer adding `COPY .ssh/ /app/.ssh/` or `COPY . .` would embed the SSH private key into the Docker image layer history, where it persists even if deleted in a subsequent layer.

**Why it happens:** The natural instinct when "the container can't find the key" is to COPY it in. The `.env` file (which contains `ANTHROPIC_API_KEY`, `PVE_TOKEN_SECRET`, and `JARVIS_OVERRIDE_KEY`) is also at risk. Without `.dockerignore`, `docker build` sends the entire directory as context, including `.env`, any `.ssh` directory, and `data/jarvis.db`.

**Consequences:**
- Complete cluster compromise: the SSH key provides root access to all 4 nodes (Home, pve, agent1, agent)
- Keys are shared cluster-wide via `/etc/pve/priv/authorized_keys`, so one leaked key compromises everything
- The `.env` file contains: Anthropic API key, Proxmox API token secret, JWT secret, and override passkey
- Docker images pushed to any registry (even private) become permanent attack vectors
- Layer history preserves secrets even if they are "deleted" in later Dockerfile steps

**Prevention:**
- Create `.dockerignore` immediately:
  ```
  node_modules
  .git
  .env
  .env.*
  data/
  dist/
  *.db
  *.db-wal
  *.db-shm
  .ssh/
  id_*
  *.pem
  *.key
  ```
- Mount SSH keys as read-only bind mounts at runtime, never during build:
  ```yaml
  volumes:
    - /root/.ssh/id_ed25519:/app/.ssh/id_ed25519:ro
  ```
- Pass secrets via Docker environment variables or secrets, not files in the build context
- Add a CI check that runs `docker history --no-trunc` and greps for sensitive patterns (COPY with .ssh, .env, id_, key)
- Document in the project README/CONTRIBUTING that SSH keys MUST be runtime-mounted

**Detection:** Run `docker history jarvis-backend --no-trunc` and search for COPY commands referencing sensitive paths. Use `dive` (Docker image analyzer) to inspect each layer for secret files.

**Which phase should address it:** Phase 3 (Docker Deployment) -- day-zero security requirement, must be the first thing configured.

---

### Pitfall 5: TLS Certificate Verification Globally Disabled

**What goes wrong:** The `.env` file sets `NODE_TLS_REJECT_UNAUTHORIZED=0`, which disables TLS certificate verification for ALL outgoing HTTPS connections -- not just Proxmox API calls. The `proxmox.ts` comment (line 8) acknowledges this: "set in Docker Compose environment, no per-request agent needed." This means the Anthropic API key is transmitted without verifying the server's identity.

**Why it happens:** Proxmox uses self-signed certificates, and the quick fix is to disable TLS verification globally. This worked fine in dev mode on the Home node. But in Docker on the management VM (which runs 16 other containers on a shared Docker network), container-to-container MITM is trivial for any compromised container.

**Consequences:**
- Claude API key (`ANTHROPIC_API_KEY`) could be intercepted by a MITM attack
- Proxmox API token could be intercepted (grants full cluster management access)
- Any future external API integrations (webhooks, email, monitoring) inherit the vulnerability
- In the Docker network, any container with network access can intercept HTTPS traffic from the Jarvis container

**Prevention:**
- Remove `NODE_TLS_REJECT_UNAUTHORIZED=0` from environment entirely
- For Proxmox connections, use a custom HTTPS agent with self-signed cert acceptance:
  ```typescript
  import https from 'node:https';
  const proxmoxAgent = new https.Agent({ rejectUnauthorized: false });
  // Pass to fetch: fetch(url, { ...options, agent: proxmoxAgent })
  ```
  Note: Node.js native `fetch` does not support the `agent` option directly. Use `undici.Agent` or the `node:https` module's request for Proxmox calls.
- Better yet, add the Proxmox CA certificate to the Node.js trust store via `NODE_EXTRA_CA_CERTS=/path/to/proxmox-ca.pem`
- The Anthropic SDK and all other HTTPS traffic should use normal TLS verification
- Test by removing the env var and confirming only Proxmox calls fail

**Detection:** Search the codebase and Docker environment for `NODE_TLS_REJECT_UNAUTHORIZED`. If set to `0` at the process level, ALL HTTPS is compromised. This is a single-line grep check.

**Which phase should address it:** Phase 3 (Docker Deployment) -- must be fixed before containerizing for production.

---

### Pitfall 6: E2E Tests Against Live Cluster Cause Unintended Side Effects

**What goes wrong:** E2E tests that exercise the full stack (UI -> Socket.IO -> Claude/LLM -> MCP tools -> SSH -> cluster nodes) execute real commands on real infrastructure. A test verifying "can stop and start a VM" actually stops a running VM. A test exercising `execute_ssh` runs real commands on production nodes. A test triggering the agentic loop consumes real Claude API tokens.

**Why it happens:** Jarvis's entire purpose is to manage live infrastructure. The MCP tools in `mcp/server.ts` directly call SSH and Proxmox APIs. The safety tier system (`safety/tiers.ts`) protects against accidental destruction but does not distinguish between "test" and "production" invocations. There is no mock layer between the tool handlers and the infrastructure.

**Consequences:**
- Tests accidentally stop critical services (management VM VMID 103, Twingate VPN, AdGuard DNS)
- Tests create real events and conversations in the database, polluting history
- Tests consume real Claude API tokens ($0.10-$2.00 per full agentic loop test)
- Tests leave the cluster in unexpected state, causing subsequent test failures (ordering dependencies)
- A test suite running on CI could take down the entire homelab if it hits RED/BLACK tier tools

**Prevention:**
- Create a `MockToolExecutor` that intercepts `executeTool()` when `NODE_ENV=test`:
  ```typescript
  // Returns canned responses matching real tool schemas
  // e.g., get_cluster_status returns a fixed healthy cluster snapshot
  // stop_vm returns success without touching any infrastructure
  ```
- For integration tests that MUST hit live infrastructure, restrict to GREEN-tier (read-only) tools only: `get_cluster_status`, `get_node_status`, `get_vms`, `get_containers`, `get_storage`
- Use a dedicated test session ID prefix (`test-*`) so test-generated data can be identified and cleaned up
- Never run YELLOW/RED/BLACK tier tools in automated tests. Test the confirmation flow with mocked tool execution only.
- For Claude API tests, use a separate API key with a hard spending limit, or mock the Anthropic SDK entirely
- Track test-originated API costs separately from production usage via session tagging

**Detection:** After test runs, query the events table for entries where the associated session matches the test prefix. If any YELLOW/RED/BLACK tier tool executions appear during test runs, test isolation is broken.

**Which phase should address it:** Phase 4 (E2E Testing) -- test architecture must be designed before writing the first test.

---

## Moderate Pitfalls

Mistakes that cause delays, increased costs, or technical debt.

---

### Pitfall 7: Claude API Cost Explosion from Unbounded Agentic Loops

**What goes wrong:** The `runAgenticLoop` in `loop.ts` can iterate up to `config.chatMaxLoopIterations` (default: 10) times. Each iteration re-sends the FULL conversation history plus ALL accumulated tool results to Claude. With 18 tools registered (each with a Zod schema), the tool definitions alone consume ~2000-3000 tokens per request. A 10-iteration loop with accumulating tool results can easily consume 50K-100K input tokens for a single user message.

**Why it happens:** The loop appends to `currentMessages` (line 208-216) without ever pruning. Each iteration adds an assistant message (tool_use block) and a user message (tool_result). By iteration 5, the message array contains 10+ messages of tool interaction plus the original conversation history, all re-sent to Claude. There is no token counting, no context pruning, and no cost estimation.

**Consequences:**
- A single complex query ("check all nodes, their temperatures, and restart any failing services") triggers 4-6 tool calls, consuming 30K-60K tokens total
- Claude Sonnet 4 charges $3/M input tokens, $15/M output tokens. A 10-iteration loop at 10K tokens/iteration = ~$0.30 input + $0.15 output = $0.45 per query
- 10 queries/day = $135/month just for chat. With monitoring loops, could reach $300-600/month
- No visibility into per-query costs until the monthly bill arrives

**Prevention:**
- Add per-query cost estimation: before each loop iteration, estimate total token count and emit a cost warning via the `onToolUse` callback if a threshold is exceeded
- Implement progressive context pruning: after iteration 3, summarize previous tool results instead of keeping full text (replace verbose JSON output with one-line summaries)
- Reduce `chatMaxLoopIterations` from 10 to 5 for normal queries; keep 10 only for override-active sessions
- Track cumulative daily/monthly spend in the `preferences` table (`setPreference('daily_claude_spend', ...)`) and implement a configurable hard cutoff
- Consider using Claude Haiku for routine tool-calling loops and Sonnet only for complex reasoning tasks
- Log per-session cost to the `conversations` table by extending `tokensUsed` tracking

**Detection:** The `onDone` callback (line 109) already reports `inputTokens` and `outputTokens`. These are passed to `chat:done` events but not aggregated. Build a daily cost dashboard query against the conversations table.

**Which phase should address it:** Phase 1 (Hybrid LLM Routing) -- cost management is a core routing concern.

---

### Pitfall 8: Memory Bloat from Unbounded Conversation and Event Tables

**What goes wrong:** The `conversations` and `events` tables in SQLite grow without bound. Every chat message, every tool execution, every cluster event is logged permanently. There is `cleanupOldActions()` for `autonomy_actions` (30-day retention, `memory.ts` line 204) but NO cleanup function for conversations, events, or cluster_snapshots.

**Why it happens:** The initial development focused on functionality over operations. In a homelab running 24/7 with monitoring pollers generating events every 30-60 seconds, the events table grows by 1,440-2,880 rows per day (~50K-100K per month). Conversations grow proportionally with usage.

**Consequences:**
- SQLite database grows several MB per day (events table with JSON `details` column is verbose)
- Docker volume fills up (management VM disk is finite)
- Full-table queries become slow as row count grows
- WAL file grows larger between checkpoints
- Conversation history loaded for chat (`getSessionMessages` returns ALL messages for a session) becomes a bottleneck for long-lived sessions

**Prevention:**
- Implement TTL-based cleanup for all tables, run on `setInterval` every hour:
  - `conversations`: 7-day retention (configurable via preferences)
  - `events`: 30 days for info/warning, 90 days for error/critical
  - `cluster_snapshots`: 7 days, with one-per-hour decimation after 24 hours
- Add `VACUUM` after bulk deletes monthly (not after every cleanup -- it rewrites the entire database and blocks writes)
- Add database file size as a health metric on the `/health` endpoint
- For conversations, implement session summarization: after 24 hours, replace full message history with a summary row to preserve context without storing every token

**Detection:** Monitor `jarvis.db` file size (easy to expose as a health metric). Track row counts per table via a periodic query. Alert when any table exceeds 100K rows or DB exceeds 100MB.

**Which phase should address it:** Phase 2 (Persistent Memory) -- retention policies are core to the memory system design.

---

### Pitfall 9: Docker Container Cannot Reach Cluster Nodes Due to Network Isolation

**What goes wrong:** The Docker container on the management VM (192.168.1.65) needs to reach all 4 cluster nodes via SSH (port 22) and Proxmox API (port 8006). Docker's default bridge network (172.17.0.0/16) requires packets to route through Docker's NAT, the VM's network stack, and potentially the PVE firewall. Any misconfiguration at any layer silently breaks connectivity. The system appears "online" (web UI loads) but cannot do anything useful.

**Why it happens:** The management VM already has PVE firewall rules (documented in CLAUDE.md) that allow specific inbound traffic. Docker's outbound NAT typically works, but the interaction between Docker iptables rules and PVE firewall is complex. The management VM already runs 16 Docker containers, and their combined iptables rules can create unexpected conflicts.

**Consequences:**
- All MCP tools fail (SSH timeout -> tool error -> Claude receives error and retries -> loop consumes tokens on retries)
- Proxmox API calls time out, making all monitoring non-functional
- The SSH connection pool in `ssh.ts` enters a reconnection loop, logging errors but never recovering
- Hard to debug because the failure manifests as tool-level errors, not network errors

**Prevention:**
- Use `network_mode: host` in docker-compose.yml for the Jarvis backend container. This gives the container direct access to the VM's network interfaces, eliminating Docker NAT complexity entirely. For a homelab management tool running on a private network, this is the pragmatic and correct choice.
- If bridge networking is required for isolation, add a startup connectivity check:
  ```typescript
  // On startup, test SSH to each node and PVE API to one node
  for (const node of config.clusterNodes) {
    await execOnNode(node.host, 'echo ok', 5000);
  }
  ```
- Add a `HEALTHCHECK` to the Dockerfile that tests cluster connectivity (currently missing):
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:4000/health || exit 1
  ```
- Implement a `/health` endpoint that returns unhealthy if cluster connectivity is lost

**Detection:** Monitor the health endpoint. If healthy but tools fail, the issue is tool-specific. If unhealthy, the issue is network connectivity. Currently there is no health endpoint or Docker healthcheck defined.

**Which phase should address it:** Phase 3 (Docker Deployment) -- network configuration must be validated early.

---

### Pitfall 10: better-sqlite3 Native Module Fails Silently in Docker Build

**What goes wrong:** `better-sqlite3` is a native Node.js module requiring C++ compilation. The current Dockerfile (line 8-11) uses `npm ci --ignore-scripts` then attempts `npx prebuild-install`. If prebuild-install fails (version mismatch, missing prebuild), the build continues due to the `|| echo "WARN"` fallback. The image builds successfully but crashes at runtime with `Error: Cannot find module`.

**Why it happens:** The `--ignore-scripts` flag is used to avoid seccomp issues on Proxmox (Dockerfile comment line 7). But it also prevents the normal postinstall compilation fallback. The `|| echo "WARN"` hides the failure. Node.js version bumps (22.x minor versions) may not have matching prebuilts immediately.

**Consequences:**
- Docker image builds successfully (no build error) but crashes on first database access
- The error only appears at runtime, not build time
- Debugging requires understanding the prebuild-install / N-API version matrix
- Each rebuild attempt takes minutes due to npm ci

**Prevention:**
- Remove the `|| echo "WARN"` fallback -- let the build fail loudly
- Add build tools to the builder stage as a fallback for source compilation:
  ```dockerfile
  RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
  RUN npm ci  # scripts enabled, will compile from source if prebuild unavailable
  ```
- Add a build-time verification step after install:
  ```dockerfile
  RUN node -e "require('better-sqlite3')"
  ```
- Pin Node.js to a specific minor version (`node:22.12-slim` not `node:22-slim`) for reproducible builds
- Never use Alpine-based images (`node:22-alpine`) for better-sqlite3 -- musl libc causes `fcntl64: symbol not found` errors

**Detection:** Add `node -e "require('better-sqlite3')"` to the Docker build and to CI pipeline. Any failure means the native module is broken.

**Which phase should address it:** Phase 3 (Docker Deployment) -- build reliability is a prerequisite.

---

### Pitfall 11: No Graceful Shutdown in Docker Causes Connection Leaks and Data Loss

**What goes wrong:** The current codebase has NO `SIGTERM` or `SIGINT` handler. When Docker sends SIGTERM (on `docker stop`, `docker-compose down`, or container replacement), the Node.js process has 10 seconds before Docker sends SIGKILL. Without a handler:
- Active Socket.IO connections are severed immediately (users see a disconnect with no notification)
- In-progress Claude API streaming responses are abandoned (wasted tokens, lost response)
- SSH connections in the pool (`ssh.ts` pool Map) remain as ghost connections on cluster nodes
- SQLite WAL file is not flushed (see Pitfall 3)
- The `closeAllConnections()` function in `ssh.ts` (line 150) is never called

**Why it happens:** The Dockerfile uses `CMD ["node", "dist/index.js"]` (correct -- not npm/yarn). But the application code does not register any signal handlers. This is the default Node.js behavior -- it exits immediately on uncaught signals.

**Consequences:**
- Users in active chat sessions see a sudden disconnect with no error message
- Ghost SSH connections accumulate on cluster nodes (each consumes a file descriptor and a shell)
- SQLite data loss on every container restart (every deploy, every crash recovery)
- Running `docker stop` takes the full 10-second timeout because Node ignores SIGTERM and Docker has to SIGKILL

**Prevention:**
- Add a comprehensive graceful shutdown handler in the main entry point:
  ```typescript
  async function shutdown(signal: string) {
    console.log(`${signal} received, shutting down gracefully...`);
    // 1. Stop accepting new Socket.IO connections
    io.close();
    // 2. Close HTTP server (waits for in-flight requests)
    httpServer.close();
    // 3. Close all pooled SSH connections
    closeAllConnections();
    // 4. Checkpoint and close SQLite
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.close();
    // 5. Exit cleanly
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  ```
- Set `stop_grace_period: 30s` in docker-compose.yml
- Use `docker run --init` or add `init: true` in docker-compose.yml for tini as PID 1 (handles zombie process reaping)
- Emit a `chat:disconnect` event to connected clients before closing Socket.IO, so the UI can show a "server restarting" message

**Detection:** If `docker stop` consistently takes exactly 10 seconds (the default timeout), SIGTERM is being ignored. Check SSH connection count on cluster nodes before/after container restart -- ghost connections indicate missing cleanup.

**Which phase should address it:** Phase 3 (Docker Deployment) -- required for reliable container lifecycle.

---

### Pitfall 12: Claude and Local LLM Have Incompatible Message Formats Leading to Broken Provider Switching

**What goes wrong:** The `runAgenticLoop` expects Anthropic `MessageParam[]` format (content blocks with `tool_use`, `tool_result` types), while `runLocalChat` expects simple `{role, content}` objects. The chat handler (`chat.ts` lines 128-133) converts by filtering to `user`/`assistant` roles and extracting `content` as string. This works for simple text but silently drops all tool interaction history.

**Why it happens:** Claude's native API uses content block arrays (`[{type: 'text', text: '...'}, {type: 'tool_use', ...}]`) while the OpenAI-compatible format used by llama-server uses flat `{role, content}` strings. The Anthropic OpenAI compatibility layer exists but is "not considered a long-term or production-ready solution" (per official Anthropic docs) and does not support streaming tool use.

**Consequences:**
- If a conversation starts on Claude (with tool interactions), then a subsequent message routes to local LLM, the conversation history loses all tool context. The local LLM sees unexplained gaps in the conversation.
- If the router escalates from local to Claude mid-conversation, Claude receives simple text messages and may not understand the conversation context
- No unified token counting is possible across providers (different tokenizers, different counting methods)
- Future features like "view full conversation history" must handle two different storage formats

**Prevention:**
- Define a canonical internal message format stored in the database (the current `conversations` table stores `content` as text and `toolCalls` as JSON -- use this as the canonical format)
- When switching providers mid-conversation, include a brief summary of prior tool interactions as text context rather than trying to reconstruct provider-specific message arrays
- Build a `MessageAdapter` layer that translates between the canonical format and each provider's native format
- Keep the Anthropic SDK as the canonical format for tool-using conversations and only use the simple format for text-only local LLM conversations
- Long-term: evaluate whether Claude's OpenAI compatibility endpoint (documented at docs.anthropic.com/en/api/openai-sdk) could simplify the adapter, but note its limitations (no streaming tool use, strict mode ignored, system messages hoisted)

**Detection:** Query the conversations table for sessions where `model` column alternates between 'claude' and 'local'. Test these conversations manually to verify context continuity.

**Which phase should address it:** Phase 1 (Hybrid LLM Routing) -- unified message format should be part of the router design.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

---

### Pitfall 13: E2E Test Flakiness from Async Timing Dependencies

**What goes wrong:** The system has multiple async layers with wildly variable latency: Socket.IO event propagation (1-10ms), Claude API streaming (500ms-30s), local LLM generation (6.5 tok/sec = 5-60 seconds for a full response), SSH command execution (100ms-30s depending on node responsiveness), and Proxmox API calls (200ms-15s when a node is unresponsive). E2E tests that assert on timing will fail intermittently.

**Why it happens:** Infrastructure management tools have inherently variable response times. A `get_cluster_status` call takes 200ms when all nodes are healthy but 15s+ when a node is offline (SSH connection timeout). The local LLM is consistently slow. Claude streaming adds unpredictable network latency.

**Consequences:**
- Tests pass locally but fail in CI (or vice versa)
- "Re-run until green" culture develops, undermining test suite value
- Developers mark flaky tests as `skip`, reducing coverage to zero over time
- CI pipeline becomes unreliable, blocking merges on false failures

**Prevention:**
- Use event-based assertions instead of timeouts: wait for specific Socket.IO events (`chat:done`, `chat:tool_result`) with generous maximum timeouts
- Set different timeout tiers: unit tests (5s), mocked integration tests (15s), live integration tests (120s)
- Mock the LLM layer entirely for UI E2E tests (Playwright/Vitest can intercept WebSocket events)
- Separate fast tests (unit, mocked integration) from slow tests (live infrastructure integration) with different CI stages
- For live integration tests, use retry patterns for network-dependent assertions (but never for logic assertions)
- Tag flaky tests explicitly (`@flaky`) and run them in a separate, non-blocking CI job

**Detection:** Track test execution time variance in CI. If a test's p50 is 2s but p95 is 45s, it has a timing dependency. Tests failing >5% of CI runs are flaky and should be quarantined.

**Which phase should address it:** Phase 4 (E2E Testing) -- test design principle from day one.

---

### Pitfall 14: Docker Container Timezone Mismatch Corrupts Event Timeline

**What goes wrong:** SQLite `datetime('now')` returns UTC. The JavaScript `Date` constructor returns UTC. But cluster nodes and the current dev environment may use local time (EST/EDT). Docker containers default to UTC. If event timestamps from different sources use different timezone conventions, the event timeline becomes inconsistent -- events appear out of order or "in the future."

**Why it happens:** The management VM's timezone, the cluster nodes' timezones, the Docker container's timezone, and the Proxmox API's timestamp format may all differ. The current schema uses `datetime('now')` (UTC) in some places and `new Date().toISOString()` (also UTC) in others, but Proxmox task timestamps and SSH command output use whatever timezone the node is configured with.

**Consequences:**
- Events appear out of order in the UI timeline
- "Events since X" queries miss events or include extras due to timezone offset
- Debug logs become confusing when container and node timestamps differ by hours
- TTL-based cleanup (from Pitfall 8) may delete events prematurely or retain them too long

**Prevention:**
- Set `TZ=UTC` in docker-compose.yml environment variables
- Verify all cluster nodes use UTC: `timedatectl set-timezone UTC` on each node (check first -- changing timezone on running systems can confuse log analysis)
- When parsing timestamps from Proxmox API responses or SSH output, explicitly handle timezone conversion
- Store all timestamps as ISO 8601 with timezone indicator (`Z` suffix) -- which the current schema already does via `datetime('now')` + `.toISOString()`
- Add a timezone assertion to the startup connectivity check

**Detection:** Compare `SELECT datetime('now')` from inside the container with `date -u` on the host. If they differ by more than a few seconds, timezone or clock synchronization is wrong.

**Which phase should address it:** Phase 3 (Docker Deployment) -- environment configuration task.

---

### Pitfall 15: Missing .dockerignore Causes Bloated Build Context and Secret Exposure Risk

**What goes wrong:** There is no `.dockerignore` file in the project. While the Dockerfile uses targeted COPY commands (`COPY package.json`, `COPY src/`), `docker build` still sends the entire directory as build context to the Docker daemon. This includes `node_modules/` (~200MB), `.git/` (~50MB), `.env` (with all secrets), and `data/jarvis.db`.

**Why it happens:** `.dockerignore` is easy to forget when Dockerfile COPY commands are already scoped. But any future change to the Dockerfile (like `COPY . .` for faster iteration) would include everything. The build context upload is also noticeably slow without it.

**Consequences:**
- Build context upload takes 30+ seconds instead of <1 second
- Risk of future COPY commands accidentally including `.env` with API keys and passwords
- `data/jarvis.db` could be included in the image (old production data in the image)
- Larger attack surface if the image is ever inspected or leaked

**Prevention:**
- Create `.dockerignore`:
  ```
  node_modules
  .git
  .env
  .env.*
  data/
  dist/
  *.db
  *.db-wal
  *.db-shm
  .ssh/
  id_*
  *.pem
  *.key
  .planning/
  jarvis-ui/
  jarvis-v3/
  ```
- Keep `.dockerignore` in sync with `.gitignore`

**Detection:** Run `docker build` and observe the "Sending build context to Docker daemon" message. If it reports >10MB, the context includes unnecessary files.

**Which phase should address it:** Phase 3 (Docker Deployment) -- 5-minute task, do it first.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Phase 1: Hybrid LLM Routing | Keyword routing misclassifies messages (#1) | Critical | Replace with intent classifier or regex patterns |
| Phase 1: Hybrid LLM Routing | Context overflow on local LLM (#2) | Critical | Separate system prompts, token counting, reduced history limit |
| Phase 1: Hybrid LLM Routing | Claude API cost spiral from agentic loops (#7) | Moderate | Per-query cost tracking, progressive context pruning |
| Phase 1: Hybrid LLM Routing | Incompatible message formats (#12) | Moderate | Canonical internal format, MessageAdapter layer |
| Phase 2: Persistent Memory | Unbounded table growth (#8) | Moderate | TTL-based cleanup for all tables, periodic VACUUM |
| Phase 3: Docker Deployment | SQLite WAL corruption/loss (#3) | Critical | Graceful shutdown, named volumes, periodic checkpointing |
| Phase 3: Docker Deployment | SSH keys leaked in image (#4) | Critical | .dockerignore, runtime volume mounts |
| Phase 3: Docker Deployment | TLS globally disabled (#5) | Critical | Per-connection TLS config for Proxmox only |
| Phase 3: Docker Deployment | Container cannot reach cluster (#9) | Moderate | host networking or connectivity health check |
| Phase 3: Docker Deployment | better-sqlite3 build fails silently (#10) | Moderate | Build tools fallback, runtime verification |
| Phase 3: Docker Deployment | No graceful shutdown (#11) | Moderate | SIGTERM handler for all resources |
| Phase 3: Docker Deployment | Missing .dockerignore (#15) | Minor | Create before first build |
| Phase 3: Docker Deployment | Timezone mismatch (#14) | Minor | TZ=UTC in environment |
| Phase 4: E2E Testing | Tests cause real cluster side effects (#6) | Critical | MockToolExecutor for non-read-only tests |
| Phase 4: E2E Testing | Flaky tests from timing (#13) | Minor | Event-based assertions, generous timeouts |

---

## Sources

### Hybrid LLM Routing
- [Multi-provider LLM orchestration: 2026 Guide](https://dev.to/ash_dubai/multi-provider-llm-orchestration-in-production-a-2026-guide-1g10) -- MEDIUM confidence (community article, aligns with patterns)
- [OpenAI SDK compatibility - Claude API Docs](https://docs.anthropic.com/en/api/openai-sdk) -- HIGH confidence (official Anthropic docs, confirms compatibility layer limitations)
- [Context Rot: How Input Tokens Impact LLM Performance](https://research.trychroma.com/context-rot) -- HIGH confidence (peer-reviewed research)
- [Context Window Management Strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) -- MEDIUM confidence
- [Top Techniques to Manage Context Length in LLMs](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms) -- MEDIUM confidence
- [The Context Window Problem: Scaling Agents Beyond Token Limits](https://factory.ai/news/context-window-problem) -- MEDIUM confidence

### SQLite + Docker Persistence
- [SQLite File Locking and Concurrency v3](https://sqlite.org/lockingv3.html) -- HIGH confidence (official SQLite docs)
- [SQLite Write-Ahead Logging](https://sqlite.org/wal.html) -- HIGH confidence (official SQLite docs)
- [Docker: Persist the DB](https://docs.docker.com/get-started/workshop/05_persisting_data/) -- HIGH confidence (official Docker docs)
- [better-sqlite3 database locked in Docker (Issue #1155)](https://github.com/WiseLibs/better-sqlite3/issues/1155) -- HIGH confidence (official repo)
- [better-sqlite3 Alpine Docker (Discussion #1270)](https://github.com/WiseLibs/better-sqlite3/discussions/1270) -- HIGH confidence (official repo)
- [SQLite WAL/SHM permissions in Docker Compose](https://sqlite.org/forum/info/87824f1ed837cdbb) -- HIGH confidence (official SQLite forum)

### Docker Security and SSH Keys
- [Docker Security Best Practices Cheat Sheet](https://blog.gitguardian.com/how-to-improve-your-docker-containers-security-cheat-sheet/) -- MEDIUM confidence
- [Securely Using SSH Keys in Docker](https://www.fastruby.io/blog/docker/docker-ssh-keys.html) -- MEDIUM confidence
- [9 Tips for Containerizing Node.js](https://www.docker.com/blog/9-tips-for-containerizing-your-node-js-application/) -- HIGH confidence (official Docker blog)
- [Docker Secrets Documentation](https://docs.docker.com/engine/swarm/secrets/) -- HIGH confidence (official Docker docs)

### Graceful Shutdown
- [Node.js Best Practices: Graceful Shutdown in Docker](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/docker/graceful-shutdown.md) -- HIGH confidence (20K+ stars repo)
- [Express: Health Checks and Graceful Shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html) -- HIGH confidence (official Express docs)
- [Don't Let Your Node.js App Die Ugly](https://dev.to/nse569h/dont-let-your-nodejs-app-die-ugly-a-guide-to-perfect-graceful-shutdowns-ing) -- MEDIUM confidence

### E2E Testing
- [Running E2E Tests in Multiple Environments](https://www.qawolf.com/blog/running-the-same-end-to-end-test-on-multiple-environments) -- MEDIUM confidence
- [Avoid Testing With Production Data](https://www.blazemeter.com/blog/production-data) -- MEDIUM confidence
- [E2E Testing: 2026 Guide](https://www.leapwork.com/blog/end-to-end-testing) -- MEDIUM confidence

### Claude API Tool Use
- [How to implement tool use - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) -- HIGH confidence (official Anthropic docs)
- [OpenAI API vs Anthropic API: Developer's Guide](https://www.eesel.ai/blog/openai-api-vs-anthropic-api) -- MEDIUM confidence

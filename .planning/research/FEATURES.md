# Feature Landscape: Milestone 2 -- Intelligence, Memory, Deployment, Testing

**Domain:** AI-powered infrastructure management dashboard (Proxmox homelab)
**Project:** Jarvis 3.1 -- Subsequent Milestone
**Researched:** 2026-01-26
**Focus:** Hybrid LLM routing, persistent memory, Docker deployment, E2E testing

---

## Existing Foundation (Already Built)

These features are live and inform what the new features build upon:

| Component | Status | Relevant to New Features |
|-----------|--------|--------------------------|
| Express 5 backend + 18 MCP tools | Working | Hybrid routing wraps existing chat handler |
| Claude API agentic loop with tool calling | Working | Routing must preserve tool-calling path |
| Local LLM (Qwen 2.5 7B) text-only fallback | Working | Routing upgrades this from fallback to intelligent peer |
| Keyword-based routing (`needsTools()`) | Working | Must be replaced by smarter routing logic |
| SQLite via better-sqlite3 + Drizzle ORM | Working | Memory tables extend existing schema |
| `conversations` table (session messages) | Working | Memory builds on this for cross-session recall |
| `events` table (alerts, actions, metrics) | Working | Memory draws from event history |
| `preferences` table (key-value upsert) | Working | User preferences stored here |
| `autonomy_actions` audit log | Working | Memory can reference past remediation actions |
| Dockerfiles (backend + frontend) | Working | Need compose unification + production hardening |
| Docker Compose (backend only, frontend commented out) | Partial | Must enable full-stack deployment |
| Socket.IO 4 namespaces (/chat, /events, /hud) | Working | E2E tests must exercise WebSocket flows |
| 4-tier safety framework (GREEN/YELLOW/RED/BLACK) | Working | Tests must validate safety enforcement |
| JARVIS personality system prompt | Working | Memory context injection extends system prompt |

---

## Feature Domain 1: Hybrid LLM Routing

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Intent-based routing (tools vs conversation) | Current keyword matching is brittle -- misroutes conversational messages about nodes. Must detect whether user needs cluster tools or just wants to chat. | Medium | Existing `needsTools()` function, both LLM backends |
| Automatic fallback when Claude unavailable | If API key missing, rate limited, or API down, Jarvis must degrade gracefully to local LLM. Must not crash or show raw errors. | Low | Already partially implemented (`claudeAvailable` check), needs timeout/error fallback |
| Provider indicator in UI | User must know whether Claude or Qwen is responding. Affects trust calibration -- tool results require Claude, conversational answers can come from either. | Low | Chat store, UI badge on messages |
| Token usage tracking per request | Every Claude API call costs money. Must log input/output tokens per message. Foundation for any cost management. | Low | Already tracking in `onDone` callback, needs DB persistence and API exposure |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Confidence-based cascade routing | Send to local LLM first; if response confidence is low or query is complex, escalate to Claude. Research shows 60-85% API cost reduction with <5% quality loss. This is the architecture that makes self-hosting a 7B model worthwhile. | High | Local LLM response evaluation, confidence scoring heuristic |
| Cost tracking dashboard panel | Running cost counter showing daily/weekly/monthly Claude API spend. "You've spent $2.14 this week on 47 Claude calls." Makes the hybrid routing value visible to the operator. | Medium | Token cost table (model -> cost per 1K tokens), aggregation queries |
| Session-level cost attribution | Track cost per chat session so operator sees which conversations were expensive. Enables "this deep diagnostic cost $0.38" transparency. | Low | Extend `conversations` table with cost column |
| Configurable routing rules | Let operator set routing preferences: "Always use Claude for SSH commands", "Use local for status queries", "Budget cap: $X/day". Stored in preferences table. | Medium | Preferences API, routing rule evaluation |
| Model quality A/B visibility | Show which model answered and let operator rate responses (thumbs up/down). Builds data for routing improvement over time. | Medium | Rating column in conversations, analytics query |
| Streaming parity between providers | Both Claude and Qwen already stream, but Qwen responses are text-only while Claude includes tool use events. Make the streaming UX consistent regardless of provider. | Low | Already implemented -- verify consistency |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| ML-trained router model | RouteLLM and NVIDIA use trained classifiers for routing. Overkill for a single-user homelab with ~50 queries/day. The training data collection alone would take months. | Use heuristic routing: keyword + message length + explicit user preference. Simple, predictable, debuggable. |
| Multiple cloud LLM providers | LiteLLM supports 100+ providers. Adding OpenAI, Gemini, etc. adds config complexity with no benefit when Claude + local Qwen cover all needs. | Stick to two providers: Claude (cloud, smart, tools) and Qwen (local, fast, free). Add a third only if a specific capability gap emerges. |
| Automatic model selection via LLM-as-judge | Using one LLM to evaluate whether another LLM's response was good enough is recursive and expensive. Doubles API calls in the worst case. | Use structural signals: did the response include tool calls? Did it complete without errors? Was it under the length threshold? These are free to evaluate. |
| Real-time cost optimization (mid-response switching) | Switching models mid-stream based on token count is fragile and confusing to the user. | Route once per message at the start. If the wrong choice was made, the next message can be re-routed. |

---

## Feature Domain 2: Persistent Memory

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Cross-session conversation recall | "What did we discuss yesterday about pve's disk?" -- Jarvis must retrieve relevant past conversations. Without this, every session starts from zero. The "goldfish memory problem." | Medium | Existing `conversations` table, search/retrieval logic, system prompt injection |
| Cluster state memory | Jarvis should remember "node agent was offline for 2 hours last Tuesday" and "we expanded root disk on Home to 112GB on Jan 25." Operational history is context. | Medium | Existing `events` table + `cluster_snapshots` table, summarization into system prompt |
| User preference persistence | "I prefer email alerts for critical issues" or "Don't restart VM 100 without asking me first." These must survive across sessions. | Low | Existing `preferences` table with key-value upsert. Already scaffolded. |
| Memory-aware system prompt | Inject relevant memories into the system prompt before each LLM call. Current `buildClusterSummary()` fetches live state -- must also include relevant historical context. | Medium | System prompt builder, memory retrieval, token budget management |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Tiered memory with TTL | **Short-term** (session, full verbatim, TTL: session lifetime). **Medium-term** (summarized conversations, TTL: 7 days). **Long-term** (extracted facts/preferences, TTL: indefinite). This mirrors how human memory works -- recent events in detail, older events as summaries, important facts forever. | High | New `memory_facts` table, summarization pipeline, TTL cleanup job |
| Context consolidation / summarization | When a conversation ends, extract key facts and decisions into compact memory entries. "On Jan 26, operator asked to check pve temperatures. Found 62C, within normal range." Reduces token cost of memory injection by 80-90%. | High | LLM-based summarization (can use local Qwen for this -- it is a text task, not a tool task), fact extraction prompts |
| Semantic memory search | When user asks about a topic, find relevant past memories by meaning, not just keyword. "Tell me about that storage issue" should find the conversation about pve disk expansion even if "storage" wasn't the exact word used. | High | Vector embeddings (sqlite-vss or in-memory cosine similarity on small corpus). May be overkill for single-user homelab -- keyword search could suffice initially. |
| Autonomy action recall | "What actions have you taken today?" -- Jarvis queries the `autonomy_actions` table and narrates: "I restarted the corosync service on pve at 2:14 PM after detecting a quorum warning. The issue resolved within 30 seconds." | Low | Existing `autonomy_actions` table, query + narration |
| Memory management UI | Dashboard panel showing what Jarvis remembers: facts, preferences, conversation summaries. Let operator edit/delete memories. Transparency and control over AI context. | Medium | REST API for memory CRUD, UI panel |
| Progressive context injection | Rather than dumping all memories into the system prompt (token expensive), retrieve only memories relevant to the current query. Budget: 500-800 tokens for memory context out of 4096 max. | Medium | Relevance scoring at query time, token counting |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Vector database (Pinecone, Weaviate, Chroma) | External vector DB is infrastructure overhead for a corpus of <10K memories from a single user. The operational complexity of running ChromaDB alongside SQLite adds a failure mode. | Use SQLite for storage + simple TF-IDF or keyword matching for retrieval. If semantic search becomes necessary later, use sqlite-vss extension (embedded, no extra service). |
| Unlimited context window usage | Even with Claude's 200K context, stuffing 50K tokens of history into every request is wasteful and degrades response quality (lost-in-the-middle effect). Research shows models struggle with information positioned centrally in long contexts. | Budget memory injection: ~500 tokens for facts, ~300 for recent events, ~200 for preferences. Total memory context under 1000 tokens. Use summarization to compress, not expansion to include everything. |
| Automatic preference extraction from conversation | "You always seem to prefer..." -- automatically inferring preferences from conversation patterns is error-prone and creepy. False positives erode trust. | Let preferences be explicit: user says "Remember that I prefer X", Jarvis stores it. Or extract from direct statements only, not behavioral patterns. |
| Memory sharing across users | Single-operator system. Multi-user memory with isolation, access control, and privacy is enterprise scope. | All memory belongs to the single operator. No user segmentation needed. |
| Real-time memory streaming | Updating memory during a conversation (rather than after) adds latency and complexity to the chat loop. | Extract and store memories after conversation completion. Batch processing, not inline. |

---

## Feature Domain 3: Docker Deployment

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Full-stack Docker Compose | `docker compose up` must bring up both backend and frontend, working end-to-end. Currently frontend is commented out in compose file. | Low | Existing Dockerfiles for both services, nginx.conf for frontend |
| Persistent data volume | SQLite database, conversation history, event logs, preferences must survive container restarts. Currently configured with `jarvis-data:/data` volume. | Low | Already configured, verify data directory mapping |
| SSH key mounting (read-only) | Backend container needs SSH access to cluster nodes. Current compose mounts `~/.ssh/id_ed25519:ro`. Must work with correct permissions. | Low | Already configured, validate file permissions inside container (chmod 600) |
| Environment variable configuration | All secrets (JWT_SECRET, PVE_TOKEN_SECRET, ANTHROPIC_API_KEY) via `.env` file or environment variables. No hardcoded secrets. | Low | Already structured in config.ts, needs `.env.example` template |
| Health checks | Both services must have health checks so Docker can detect and restart failed containers. Backend already has wget-based health check. | Low | Backend done, frontend needs NGINX health endpoint |
| Automatic restart on failure | `restart: unless-stopped` ensures services recover from crashes without manual intervention. | Low | Already configured for backend |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| One-command deployment to management VM | `ssh management 'cd /opt/jarvis && docker compose up -d'` -- single command deploys entire stack to the management VM (192.168.1.65). Operator doesn't need to SSH in and run multiple commands. | Low | Docker Compose file, deployment script/docs |
| Multi-architecture build support | Management VM may run on different architecture than build host. Multi-arch builds ensure portability within the cluster. | Medium | Docker buildx, platform specification in Dockerfile |
| Local LLM endpoint configuration | Container must be able to reach `http://192.168.1.50:8080` (llama-server on Home node) from the Docker network. Not localhost -- needs bridge/host network config. | Low | Environment variable for LLM endpoint, Docker network config (already using bridge) |
| Container log aggregation | Centralized log viewing: `docker compose logs -f` shows interleaved backend + frontend logs with timestamps. Structured JSON logging in backend. | Medium | Winston or pino logger, JSON log format |
| Build cache optimization | Multi-stage builds should cache `npm ci` layer separately from source code copy. Rebuilds after code changes should be fast (~30s not ~5min). | Low | Already using multi-stage builds, verify layer ordering |
| Resource limits | Set CPU and memory limits on containers to prevent runaway processes from starving the management VM (which runs other services). | Low | `deploy.resources.limits` in compose file |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Kubernetes / Docker Swarm | Container orchestration is massive overhead for a 2-container app on a single VM. No scaling needs, no multi-node deployment. | Docker Compose. Period. It handles everything needed for a homelab deployment. |
| Custom Docker registry | Pushing images to a registry adds infrastructure. Images are built and run on the same machine or cluster. | Build locally on the management VM or use `docker compose build` on deploy. If needed later, use GitHub Container Registry (free for personal). |
| Container-per-service microservices | Splitting the backend into separate containers for API, WebSocket, monitoring, etc. adds networking complexity and failure modes. | Single backend container handles all backend concerns. Single frontend container serves static files via NGINX. Two containers total. |
| Docker-in-Docker for SSH | Running SSH from inside a container that itself runs in Docker. Some suggest DinD for isolation -- it adds complexity and latency. | Mount SSH key as volume (already done). Direct SSH from backend container to cluster nodes. Simple and proven. |
| Automated CI/CD pipeline | GitHub Actions, Jenkins, etc. for automatic deployment on push. The cluster is behind a home network, not publicly accessible. Manual deploy is fine for a single operator. | Manual deploy via SSH + `docker compose up -d --build`. Add a convenience script if needed. |

---

## Feature Domain 4: E2E Testing

### Table Stakes

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| Backend unit tests with Vitest | Core business logic (safety tiers, command sanitization, routing decisions) must have unit test coverage. These are the highest-risk code paths. | Medium | Vitest, mocking for SSH/Proxmox API |
| API integration tests | HTTP endpoints (auth, health, REST API) tested with Supertest against a real Express instance. Validates request/response contracts. | Medium | Vitest + Supertest, test database (in-memory SQLite) |
| Safety framework tests | The 4-tier safety system (GREEN/YELLOW/RED/BLACK) is the most critical code. Every tier boundary must be tested: tool classification, confirmation flow, override passkey, protected resource blocking. | Medium | Vitest, mock tool execution |
| Command sanitization tests | Allowlist/blocklist enforcement for SSH commands. Must verify dangerous commands are blocked and safe commands pass through. | Low | Vitest, existing sanitize.ts |
| CI-compatible test runner | Tests must run without a real cluster, Proxmox API, or SSH access. All external dependencies mocked. `npm test` works in any environment. | Medium | Mock layers for SSH, Proxmox API, Claude API |

### Differentiators

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| WebSocket/Socket.IO chat flow tests | Test the full chat lifecycle: connect, send message, receive streaming tokens, receive done event. Validates the real-time pipeline that is core to the UX. | High | Playwright or socket.io-client test harness, test server instance |
| LLM routing decision tests | Verify that the router sends tool-requiring messages to Claude and conversational messages to the local LLM. Test edge cases: ambiguous messages, override passkey, Claude unavailable fallback. | Medium | Vitest, mock both LLM backends |
| Safety tier E2E tests | Full flow: user sends "stop VM 100" -> Claude calls stop_vm -> system returns confirmation_needed -> user confirms -> tool executes. Tests the entire RED-tier flow end-to-end. | High | Socket.IO test client, mock Claude responses, mock PVE API |
| Docker deployment smoke tests | After `docker compose up`, verify: backend health check passes, frontend serves HTML, WebSocket connects, auth flow works. Validates the deployment is functional. | Medium | Shell script or Playwright, Docker Compose test environment |
| Memory persistence tests | Verify messages are saved to SQLite, retrieved across sessions, and injected into system prompts correctly. | Medium | Vitest, test database |
| MCP tool execution tests | Each of the 18 MCP tools tested with mock SSH/API responses. Verify correct output format, error handling, and safety tier enforcement. | Medium | Vitest, mock SSH client, mock Proxmox API |
| Snapshot testing for system prompts | System prompt is complex (personality + cluster context + safety rules + override state). Snapshot tests catch unintended changes to the prompt. | Low | Vitest snapshot assertions |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Tests against real cluster | E2E tests that SSH into real nodes or call real Proxmox API are flaky (nodes may be offline), slow, and dangerous (could trigger real actions). | Mock all external systems. Use recorded responses for realistic test data. Test against real cluster manually during development only. |
| Visual regression testing | Screenshot comparison of the eDEX-UI dashboard is fragile due to animations, dynamic data, and theme variations. High maintenance, low value. | Test structure and behavior, not pixels. Verify elements exist and respond to events. Visual quality is assessed manually. |
| LLM response content testing | Asserting exact LLM output text is impossible -- responses vary. Even testing for "mentions the word status" is fragile with personality variations. | Test structural properties: response is non-empty, streaming events fire in correct order, tool calls have valid format, token counts are reported. Don't assert prose content. |
| 100% code coverage target | Chasing coverage on generated code, type definitions, and simple re-exports wastes time. Diminishing returns past ~70% on a project this size. | Focus coverage on critical paths: safety tiers, command sanitization, routing logic, memory operations. Accept lower coverage on boilerplate. |
| Browser compatibility matrix | Testing across Chrome, Firefox, Safari, Edge adds CI time. Single-operator homelab accessed from known devices. | Test on Chromium only (Playwright default). The operator knows their browser. |
| Performance/load testing | The system serves one user. Load testing WebSocket with 1000 concurrent connections is irrelevant. | Test single-user flows. Monitor real-world performance with simple timing logs. |

---

## Feature Dependencies (New Features on Existing Foundation)

```
Existing Foundation (already working):
  Express 5 + Socket.IO + MCP tools + Safety framework
  Claude API agentic loop + Local LLM text fallback
  SQLite (events, conversations, preferences, autonomy_actions)
  Dockerfiles (backend + frontend, compose partial)
    |
    v
Phase 1: Testing Foundation (enables safe changes):
  Vitest setup + unit tests for safety/sanitization
  Mock layers for SSH, Proxmox API, Claude API
  API integration tests with Supertest
  Socket.IO chat flow tests
    |
    v
Phase 2: Hybrid LLM Routing (requires tests for safe refactoring):
  Replace keyword-based needsTools() with intent classifier
  Confidence-based cascade (Qwen first, Claude escalation)
  Token cost tracking + DB persistence
  Cost dashboard panel in UI
  Fallback handling (Claude timeout/error -> Qwen)
  Provider indicator in chat UI
    |
    v
Phase 3: Persistent Memory (requires routing to work):
  Memory facts table + schema migration
  Post-conversation fact extraction (via local LLM)
  Tiered TTL (session / 7-day / permanent)
  Memory retrieval + system prompt injection
  Memory management API + UI panel
  Autonomy action recall
    |
    v
Phase 4: Docker Deployment (requires all features stable):
  Enable frontend in Docker Compose
  .env.example template
  Resource limits + logging
  Deployment script for management VM
  Smoke tests for containerized deployment
```

### Critical Path Dependencies

| New Feature | Hard Dependencies | Soft Dependencies |
|-------------|-------------------|-------------------|
| Hybrid LLM routing | Both LLM backends working, existing chat handler | Cost tracking DB table |
| Confidence scoring | Local LLM streaming response, evaluation heuristic | Rating data from operator |
| Token cost tracking | Conversations table extension, pricing lookup | Cost dashboard UI |
| Cross-session memory | Conversations table (exists), memory retrieval | Summarization pipeline |
| Memory fact extraction | Working LLM (local preferred for cost), fact schema | Session completion hook |
| Tiered TTL | Memory tables, cleanup cron/interval | None |
| Context injection | Memory retrieval, system prompt builder | Token budget logic |
| Docker full-stack | Working Dockerfiles (exist), compose config | NGINX frontend config |
| E2E safety tests | Vitest, mock layers, safety framework (exists) | None |
| Socket.IO tests | Test server instance, socket.io-client | Mock LLM responses |
| Deployment smoke tests | Docker Compose, health endpoints | CI environment |

---

## Routing Strategy Recommendation

Based on research into RouteLLM, LiteLLM, FrugalGPT, and hybrid cloud-edge architectures, here is the recommended routing strategy for Jarvis 3.1:

### Routing Decision Tree

```
User message arrives
  |
  +--> Contains override passkey? --> Claude (always, needs tool authority)
  |
  +--> Explicitly requests cluster action? --> Claude (needs MCP tools)
  |     (start, stop, restart, reboot, execute, run command)
  |
  +--> References cluster entities? --> Claude (likely needs context + tools)
  |     (node names, VMIDs, service names, storage names)
  |
  +--> Is follow-up to a tool-using conversation? --> Claude (maintain context)
  |
  +--> Claude unavailable (no key, API down, budget exceeded)? --> Qwen
  |
  +--> Default: Qwen (conversational, fast, free)
```

### Why Not Confidence-Based Cascade Initially

Research shows confidence-based routing (Qwen first, evaluate, escalate to Claude) saves 60-85% on API costs. However, for Jarvis 3.1 this introduces two problems:

1. **Latency doubling on escalated requests**: Qwen generates a response (~3-5 seconds at 6.5 tok/s), then we evaluate it, then Claude generates another (~2-3 seconds). Tool-requiring messages would always escalate, adding 3-5s latency to every cluster action.

2. **Tool-calling gap**: Qwen (via llama-server OpenAI-compatible endpoint) does not support tool calling. Any message needing MCP tools must go to Claude regardless. The cascade only helps for messages that could be answered by either model.

**Recommendation**: Start with intent-based routing (improved keyword matching), track routing decisions and costs, then evaluate whether confidence-based cascade is worth adding for the conversational tier. The data from cost tracking will inform this decision.

---

## Memory Architecture Recommendation

Based on research into Mem0, MemGPT, Microsoft Foundry Agent Memory, and the "Memory in the Age of AI Agents" survey:

### Three-Tier Memory Model for Jarvis

| Tier | Content | Storage | TTL | Token Budget |
|------|---------|---------|-----|-------------|
| **Working** | Current conversation messages | In-memory (conversation array) | Session lifetime | 2000 tokens (last 20 messages per config) |
| **Episodic** | Summarized past conversations, key events | SQLite `memory_episodes` table | 30 days | 300 tokens (top 3 relevant episodes) |
| **Semantic** | Extracted facts, preferences, cluster knowledge | SQLite `memory_facts` table | Indefinite | 500 tokens (all relevant facts) |

### Memory Pipeline

```
Conversation ends
  |
  +--> Extract facts: "pve disk expanded to 112GB on Jan 25"
  |    (use local Qwen -- this is a text task, saves Claude API costs)
  |
  +--> Generate episode summary: "Operator asked about disk space on pve.
  |    Diagnosed 73% usage. Cleaned 11GB of old backups and expanded
  |    root partition from 96GB to 112GB."
  |
  +--> Store with metadata: timestamp, entities mentioned, topic tags
  |
  +--> Cleanup: delete episodes older than 30 days,
       keep facts indefinitely
```

### Why SQLite Over Vector DB

For a single-user homelab assistant generating ~10-50 messages/day, the total memory corpus after a year is ~5000-15000 entries. At this scale:

- SQLite FTS5 (full-text search) handles keyword retrieval in <1ms
- No external service to run, monitor, or restart
- Already using SQLite for everything else (events, conversations, preferences)
- If semantic search becomes necessary, sqlite-vss adds vector similarity without a new service

---

## Testing Strategy Recommendation

Based on research into Vitest, Playwright, Node.js testing best practices (goldbergyoni/nodejs-testing-best-practices), and WebSocket testing patterns:

### Test Pyramid for Jarvis 3.1

```
                    /\
                   /  \       E2E (Playwright)
                  / 5  \      - Full chat flow with mock LLM
                 /------\     - Docker deployment smoke test
                /        \
               / 15-20    \   Integration
              /            \  - Socket.IO chat lifecycle
             / Supertest +  \ - MCP tool execution
            /    mock SSH    \- Memory persistence
           /------------------\
          /                    \
         /     30-40 unit       \  Unit (Vitest)
        /                        \ - Safety tiers
       / vi.mock for SSH, PVE,    \- Command sanitization
      /  Claude, Qwen              \- Routing decisions
     /------------------------------\- Memory operations
```

### Critical Test Scenarios

| Scenario | Type | Priority |
|----------|------|----------|
| GREEN tool auto-executes | Unit | P0 |
| RED tool requires confirmation | Unit | P0 |
| BLACK tool always blocked | Unit | P0 |
| Override passkey elevates RED/BLACK | Unit | P0 |
| Protected resource (VMID 103) always blocked | Unit | P0 |
| Dangerous SSH commands rejected | Unit | P0 |
| Safe SSH commands allowed | Unit | P0 |
| Message routed to Claude when tools needed | Unit | P1 |
| Message routed to Qwen for conversation | Unit | P1 |
| Claude unavailable falls back to Qwen | Unit | P1 |
| Chat message saved to conversations table | Integration | P1 |
| Session messages retrieved in order | Integration | P1 |
| Token usage persisted with cost | Integration | P1 |
| WebSocket chat:send -> chat:token -> chat:done | Integration | P1 |
| RED-tier confirmation flow via Socket.IO | Integration | P2 |
| Memory facts extracted after conversation | Integration | P2 |
| Memory injected into system prompt | Integration | P2 |
| Docker compose up -> health check passes | E2E | P2 |
| Full chat flow in browser (Playwright) | E2E | P3 |

---

## Sources

### Hybrid LLM Routing
- [Hybrid Cloud Architecture for LLM Deployment](https://journal-isi.org/index.php/isi/article/download/1170/595) -- Confidence-based routing, 60% API cost reduction
- [RouteLLM](https://github.com/lm-sys/RouteLLM) -- Framework for LLM routing, 85% cost reduction with 95% GPT-4 quality
- [vLLM Semantic Router v0.1 Iris](https://blog.vllm.ai/2026/01/05/vllm-sr-iris.html) -- Production semantic routing (Jan 2026)
- [LiteLLM Cost Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) -- Token cost tracking across providers
- [NVIDIA LLM Router Blueprint](https://github.com/NVIDIA-AI-Blueprints/llm-router) -- Intent-based and auto-routing patterns
- [Implementing LLM Model Routing with Ollama and LiteLLM](https://medium.com/@michael.hannecke/implementing-llm-model-routing-a-practical-guide-with-ollama-and-litellm-b62c1562f50f) -- Practical routing guide
- [Learning to Route LLMs with Confidence Tokens](https://arxiv.org/html/2410.13284v2) -- Self-REF confidence scoring
- [Helicone LLM Cost Monitoring](https://www.helicone.ai/blog/monitor-and-optimize-llm-costs) -- Cost monitoring best practices
- [Langfuse Token and Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) -- Open-source cost tracking

### Persistent Memory
- [Memory in the Age of AI Agents Survey](https://github.com/Shichun-Liu/Agent-Memory-Paper-List) -- Comprehensive memory taxonomy (HF Daily Paper #1, Dec 2025)
- [Mem0: Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413) -- 90% token cost reduction via memory
- [Building Persistent Memory via MCP](https://medium.com/@linvald/building-persistent-memory-for-ai-assistants-a-model-context-protocol-implementation-80b6e6398d40) -- MCP-based memory implementation
- [Context Window Management Strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) -- Summarization, pruning, chunking
- [LLM Chat History Summarization Guide](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) -- Compression techniques
- [MemGPT Adaptive Retention](https://informationmatters.org/2025/10/memgpt-engineering-semantic-memory-through-adaptive-retention-and-context-summarization/) -- Cognitive triage, 89-95% compression
- [Microsoft Foundry Agent Long-Term Memory](https://www.infoq.com/news/2025/12/foundry-agent-memory-preview/) -- Production memory patterns
- [OpenAI Agents SDK Session Memory](https://cookbook.openai.com/examples/agents_sdk/session_memory) -- Short-term memory management
- [Architecting Short-Term Memory for Agentic AI](https://www.jit.io/resources/ai-security/its-not-magic-its-memory-how-to-architect-short-term-memory-for-agentic-ai) -- TTL patterns, checkpoint cleanup

### Docker Deployment
- [Docker Official: Containerize Node.js](https://docs.docker.com/guides/nodejs/containerize/) -- Official Node.js Docker guide
- [Docker Official: Containerize React.js](https://docs.docker.com/guides/reactjs/containerize/) -- Official React Docker guide
- [9 Tips for Containerizing Node.js](https://www.docker.com/blog/9-tips-for-containerizing-your-node-js-application/) -- Docker best practices
- [10 Best Practices for Node.js Docker](https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/) -- Security-focused containerization
- [SSH Keys in Docker Volume Mount](https://nickjanetakis.com/blog/docker-tip-56-volume-mounting-ssh-keys-into-a-docker-container) -- SSH key mounting patterns
- [Docker Compose SSH Key Security](https://betterstack.com/community/questions/how-to-use-ssh-key-inside-docker-container/) -- Secure SSH key handling

### E2E Testing
- [Playwright WebSocket Testing](https://dzone.com/articles/playwright-for-real-time-applications-testing-webs) -- WebSocket and live data stream testing
- [Playwright WebSocket Class](https://playwright.dev/docs/api/class-websocket) -- Official WebSocket API
- [WebSocket Testing with MSW](https://egghead.io/lessons/test-web-sockets-in-playwright-with-msw~rdsus) -- Mock Service Worker for WebSocket
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking) -- Module mocking for SSH, API clients
- [Node.js Testing Best Practices](https://github.com/goldbergyoni/nodejs-testing-best-practices) -- Comprehensive testing patterns (April 2025)
- [vitest-mock-express](https://github.com/eagleera/vitest-mock-express) -- Express mocking for Vitest
- [API Testing with Vitest](https://adequatica.medium.com/api-testing-with-vitest-391697942527) -- Vitest vs Jest performance comparison

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Hybrid LLM routing patterns | HIGH | Multiple research papers and production frameworks (RouteLLM, LiteLLM, FrugalGPT) agree on patterns. Confidence-based cascade and intent-based routing are well-documented. |
| Token cost tracking | HIGH | Langfuse, LiteLLM, Helicone all provide proven approaches. Simple token * price arithmetic. |
| Persistent memory architecture | MEDIUM | Rapidly evolving field (Mem0, MemGPT, Microsoft Foundry all different). Three-tier model is a reasonable synthesis but hasn't been validated at Jarvis's specific scale. Fact extraction quality depends heavily on prompt engineering. |
| Memory TTL and cleanup | MEDIUM | TTL patterns documented but specific durations (7 days for episodes, indefinite for facts) are educated guesses. Will need tuning based on actual usage patterns. |
| Docker deployment | HIGH | Existing Dockerfiles work. Compose patterns are well-established. Main work is enabling frontend and hardening config. |
| E2E testing strategy | HIGH | Vitest for unit/integration, Playwright for E2E is industry standard for TypeScript projects. WebSocket testing support in Playwright since v1.48 is well-documented. |
| SSH mocking in tests | MEDIUM | vi.mock for ssh2/node-ssh is straightforward in theory but no specific Jarvis-shaped examples found. Will need custom mock implementations for the existing SSH client. |
| Semantic memory search | LOW | sqlite-vss exists but maturity unclear for production use. Simple keyword search may suffice and is much simpler to implement. Flagging for deeper research if needed. |

---

*Feature landscape research (Milestone 2): 2026-01-26*

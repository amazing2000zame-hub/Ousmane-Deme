---
phase: 21-quick-wins-baseline
plan: 01
status: complete
started: 2026-01-27T22:10:55Z
completed: 2026-01-27T22:12:57Z
commits:
  - ac40c5e: "feat(21): SQLite performance PRAGMAs and sentence threshold reduction"
  - f57f196: "feat(21): TTS cache expansion, engine-specific keys, health check, and container auto-restart"
  - dd068c7: "feat(21): component-level health endpoint with TTS, LLM, DB, Proxmox checks"
---

## Summary

Implemented three quick-win performance and observability improvements for the Jarvis backend: SQLite performance PRAGMAs (synchronous=NORMAL, 64MB cache, memory temp store, 256MB mmap) with reduced sentence boundary threshold from 20 to 4 chars for faster TTS dispatch of short responses; expanded TTS sentence cache from 50 to 200 entries with engine-specific cache keys and added automatic TTS container restart via Docker socket API on health check failure with 5-minute cooldown; and rewrote the health endpoint to return component-level status for TTS, LLM, database, and Proxmox API with parallel Promise.allSettled checks and a fast ?liveness path for Docker healthchecks.

## Changes

### Task 1: SQLite PRAGMAs + Sentence Threshold
- `jarvis-backend/src/db/index.ts`: Added 4 performance PRAGMAs after WAL (synchronous=NORMAL, cache_size=64MB, temp_store=MEMORY, mmap_size=256MB)
- `jarvis-backend/src/ai/sentence-stream.ts`: MIN_SENTENCE_LEN reduced from 20 to 4, enabling short responses like "Yes." and "Done." to be dispatched immediately to TTS

### Task 2: TTS Cache + Health + Auto-Restart
- `jarvis-backend/src/ai/tts.ts`: SENTENCE_CACHE_MAX increased from 50 to 200; cache functions now accept engine parameter with default 'xtts' for multi-engine isolation; added exported `checkTTSHealth()` returning timing and status; added exported `restartTTSContainer()` using Docker socket HTTP API with 5-minute cooldown
- `docker-compose.yml`: Added `/var/run/docker.sock:/var/run/docker.sock` bind mount for backend container

### Task 3: Component Health Endpoint
- `jarvis-backend/src/api/health.ts`: Full rewrite with Promise.allSettled checking TTS (via checkTTSHealth), LLM (/health endpoint), SQLite (SELECT 1), and Proxmox API (/api2/json/version) in parallel; returns 200 healthy or 503 degraded with per-component status and response times; ?liveness query param for fast Docker healthcheck bypass
- `docker-compose.yml`: Healthcheck URL updated to `?liveness` to avoid slow component checks on every 30s probe

## Verification

- TypeScript compilation: PASS (zero errors with `npx tsc --noEmit`)
- Docker Compose config validation: PASS (`docker compose config --quiet`)

## Deviations from Plan

None - plan executed exactly as written.

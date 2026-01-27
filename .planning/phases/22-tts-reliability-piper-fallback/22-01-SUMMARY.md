---
phase: 22-tts-reliability-piper-fallback
plan: 01
subsystem: infra
tags: [docker, piper, tts, wyoming-piper, fallback]

# Dependency graph
requires:
  - phase: 21-quick-wins-baseline
    provides: "TTS health endpoint and restart logic that Piper will integrate with"
provides:
  - "jarvis-piper Docker container running rhasspy/wyoming-piper with en_US-hfc_male-medium"
  - "piperTtsEndpoint in backend config for fallback routing"
  - "piper-voices Docker volume for persistent model storage"
  - "PIPER_TTS_ENDPOINT environment variable"
affects: [22-02-PLAN (fallback routing logic), phase-23 (parallel pipeline)]

# Tech tracking
tech-stack:
  added: [rhasspy/wyoming-piper Docker image]
  patterns: [fallback TTS engine as optional Docker service without depends_on]

key-files:
  created: []
  modified:
    - /root/docker-compose.yml
    - /root/.env
    - /root/jarvis-backend/src/config.ts

key-decisions:
  - "Piper is optional fallback -- no depends_on from backend, backend starts even if Piper is down"
  - "Resource limits: 4 CPU / 512M memory to prevent starvation of LLM and XTTS"
  - "en_US-hfc_male-medium voice model selected for male voice consistency with XTTS"
  - "Healthcheck uses curl to HTTP endpoint (wyoming-piper exposes HTTP on port 5000)"

patterns-established:
  - "Fallback services added without depends_on to preserve startup independence"
  - "Environment variable pattern: SERVICE_ENDPOINT with Docker DNS default"

# Metrics
duration: 2min
completed: 2026-01-27
---

# Phase 22 Plan 01: Piper TTS Container Deployment Summary

**Piper TTS deployed as Docker container (rhasspy/wyoming-piper) with en_US-hfc_male-medium voice, wired into backend config as piperTtsEndpoint for fallback routing**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-27T22:40:53Z
- **Completed:** 2026-01-27T22:42:15Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- jarvis-piper service added to docker-compose.yml with resource limits (4 CPU/512M), healthcheck, and persistent piper-voices volume
- PIPER_TTS_ENDPOINT environment variable added to both .env and jarvis-backend container
- piperTtsEndpoint config field added to config.ts following existing localTtsEndpoint pattern
- Docker Compose config and TypeScript compilation both validate clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Piper TTS Docker service and volume** - `546489d` (feat)
2. **Task 2: Add Piper endpoint to .env and config.ts** - `d44a88b` (feat)

## Files Created/Modified
- `/root/docker-compose.yml` - Added jarvis-piper service definition, piper-voices volume, PIPER_TTS_ENDPOINT env var to backend
- `/root/.env` - Added PIPER_TTS_ENDPOINT=http://jarvis-piper:5000
- `/root/jarvis-backend/src/config.ts` - Added piperTtsEndpoint config field with env var override

## Decisions Made
- None - followed plan as specified

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required. Container will auto-download the voice model on first start.

## Next Phase Readiness
- Piper TTS infrastructure is ready for Plan 02 to implement the fallback routing logic
- Backend config exposes piperTtsEndpoint for the routing module to use
- Container is on jarvis-net and reachable by DNS name from jarvis-backend
- No blockers for Plan 02 execution

---
*Phase: 22-tts-reliability-piper-fallback*
*Completed: 2026-01-27*

# Requirements: Jarvis 3.1 -- v1.3 File Operations & Project Intelligence

**Defined:** 2026-01-26
**Core Value:** The dashboard shows everything and Jarvis can act on it -- if you can see a problem on screen, Jarvis can fix it without you touching anything.

## v1.3 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### File Operations

- [x] **FILE-01**: JARVIS can download a file from a URL to a specified server directory
- [x] **FILE-02**: JARVIS can import/copy files between directories on the server
- [x] **FILE-03**: JARVIS can import/copy files between cluster nodes via SSH
- [x] **FILE-04**: JARVIS can list directory contents on any cluster node
- [x] **FILE-05**: File downloads have SSRF protection (block internal/private IPs, validate URLs)
- [x] **FILE-06**: All file paths are sanitized against path traversal attacks (no ../, symlink resolution)
- [x] **FILE-07**: File operations have disk space checks before writing

### Project Intelligence

- [x] **PROJ-01**: JARVIS can browse project directory structure on any cluster node
- [x] **PROJ-02**: JARVIS can read source files from any project on the cluster
- [x] **PROJ-03**: JARVIS can search/grep across project files for patterns
- [x] **PROJ-04**: JARVIS can analyze project code and suggest improvements via chat
- [x] **PROJ-05**: Project browsing integrates with existing project registry (24 indexed projects on agent1)
- [x] **PROJ-06**: Sensitive files (.env, private keys, credentials, .git/config) are blocked from read access
- [x] **PROJ-07**: Project analysis provides architecture overview, code quality notes, and actionable improvement suggestions

### Voice Retraining

- [ ] **VOICE-13**: Extract clean audio segments from user-provided JARVIS video files using ffmpeg
- [ ] **VOICE-14**: Build training dataset from extracted audio (LJSpeech format: metadata.csv + wavs/)
- [ ] **VOICE-15**: Retrain XTTS v2 GPT decoder with new dataset for improved voice quality
- [ ] **VOICE-16**: Update TTS server to use new fine-tuned model weights and clear old cache

## Future Requirements

Deferred to later milestones.

### File Operations (v2)

- **FILE-08**: File delete capability with RED-tier confirmation
- **FILE-09**: File upload from user's browser to server
- **FILE-10**: Batch file operations (multi-file download/import)

### Project Intelligence (v2)

- **PROJ-08**: Git operations (pull, status, log) on projects
- **PROJ-09**: Automated code review on git diffs
- **PROJ-10**: Project dependency audit (outdated packages, vulnerabilities)

## Out of Scope

| Feature | Reason |
|---------|--------|
| File editing/writing by JARVIS | Too dangerous for v1.3 -- read-only project access first |
| Git push/commit operations | Write operations deferred, safety implications too high |
| Real-time file watching | Complexity for little value in homelab context |
| IDE integration | Out of scope -- JARVIS is a chat assistant, not an IDE |
| Arbitrary command execution for analysis | Already have execute_ssh -- project tools should be purpose-built |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILE-01 | Phase 12 | Complete |
| FILE-02 | Phase 12 | Complete |
| FILE-03 | Phase 12 | Complete |
| FILE-04 | Phase 12 | Complete |
| FILE-05 | Phase 12 | Complete |
| FILE-06 | Phase 12 | Complete |
| FILE-07 | Phase 12 | Complete |
| PROJ-01 | Phase 13 | Complete |
| PROJ-02 | Phase 13 | Complete |
| PROJ-03 | Phase 13 | Complete |
| PROJ-04 | Phase 14 | Complete |
| PROJ-05 | Phase 13 | Complete |
| PROJ-06 | Phase 13 | Complete |
| PROJ-07 | Phase 14 | Complete |
| VOICE-13 | Phase 15 | Pending |
| VOICE-14 | Phase 15 | Pending |
| VOICE-15 | Phase 15 | Pending |
| VOICE-16 | Phase 15 | Pending |

**Coverage:**
- v1.3 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-01-26*
*Last updated: 2026-01-27 after Phase 14 completion (all PROJ requirements complete)*

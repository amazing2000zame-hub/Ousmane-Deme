# Quick Task 001: Move LLM to agent1 CPU Summary

**Completed:** 2026-01-30
**Duration:** ~6 minutes
**Tasks:** 3/3 complete

---

## One-liner

Moved LLM inference to agent1 CPU, freeing RTX 4050 GPU for XTTS voice synthesis with finetuned JARVIS voice.

---

## What Was Done

### Task 1: Stop LLM on Home and update backend config
- Stopped and disabled `jarvis-api` systemd service on Home node
- Added `LOCAL_LLM_ENDPOINT=http://192.168.1.61:8080` to `/root/.env`
- Added firewall rule on agent1 to allow port 8080 from Home node
- **Commit:** bc93902

### Task 2: Restart Docker stack and verify XTTS GPU
- Rebuilt and restarted all Docker containers
- Verified XTTS loaded with finetuned model on CUDA
- Tested synthesis: 68KB wav file generated successfully
- GPU memory: 2847 MiB in use by XTTS

### Task 3: End-to-end voice test
- Verified backend health shows `engine: "xtts"` (not piper fallback)
- Verified LLM endpoint set to agent1 in container environment
- Confirmed synthesis logs show "mode=finetuned"
- No CUDA OOM errors in any logs

---

## Key Changes

| Change | Before | After |
|--------|--------|-------|
| LLM location | Home node (192.168.1.50:8080) | agent1 (192.168.1.61:8080) |
| LLM service on Home | enabled, active | disabled, inactive |
| GPU VRAM for XTTS | ~0 MiB (OOM crashes) | 2847 MiB (stable) |
| TTS engine | Piper fallback (OOM) | XTTS finetuned |
| Voice quality | Generic Piper male voice | Trained JARVIS voice |

---

## Verification Results

| Check | Result |
|-------|--------|
| `systemctl is-active jarvis-api` on Home | inactive |
| `curl http://192.168.1.61:8080/health` | {"status":"ok"} |
| Docker containers healthy | 4/4 (backend, frontend, tts, piper) |
| nvidia-smi GPU memory | 2847 MiB / 6141 MiB |
| XTTS logs | No OOM errors, finetuned mode active |
| Backend health TTS engine | "xtts" |

---

## Infrastructure Changes

### Firewall Rules Added
- **agent1:** Port 8080 from 192.168.1.50 (LLM API access for Home node)

### Services Modified
- **Home:** `jarvis-api.service` disabled (was running llama-server locally)
- **agent1:** `llama-server.service` remains active (already created earlier in session)

---

## Files Modified

| File | Change |
|------|--------|
| `/root/.env` | Added LOCAL_LLM_ENDPOINT=http://192.168.1.61:8080 |

---

## Performance Impact

| Metric | Value |
|--------|-------|
| LLM inference location | agent1 CPU (12 threads, ~5GB RAM) |
| LLM latency | ~5ms health check (network hop) |
| XTTS synthesis time | 5.7s for 294 chars (GPU accelerated) |
| GPU memory available | 2847 MiB dedicated to XTTS |

---

## Next Steps

- Test voice quality via Jarvis UI at http://192.168.1.50:3004
- Monitor agent1 CPU usage during LLM inference
- Consider enrolling faces in Frigate for presence detection (Phase 26 ready)

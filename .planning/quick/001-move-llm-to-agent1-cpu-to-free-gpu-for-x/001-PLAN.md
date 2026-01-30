---
type: quick
plan: 001
name: move-llm-to-agent1-cpu-to-free-gpu-for-xtts
autonomous: true
files_modified:
  - /root/docker-compose.yml
  - /root/.env
---

<objective>
Redirect Jarvis backend to use LLM on agent1 (CPU) instead of Home node, freeing the RTX 4050 GPU for XTTS voice synthesis.

Purpose: User is hearing Piper fallback voice instead of trained JARVIS voice because XTTS keeps crashing with CUDA OOM - the GPU is consumed by LLM inference.

Output: XTTS running on GPU with trained voice, LLM running on agent1 CPU, user hears proper JARVIS voice.
</objective>

<context>
Current state (verified):
- LLM (llama-server) already running on agent1:8080 with Qwen 7B (4.8GB RAM, 12 threads)
- jarvis-api service on Home node still running (competing for GPU or wasting resources)
- docker-compose.yml has LOCAL_LLM_ENDPOINT defaulting to 192.168.1.50:8080 (Home)
- XTTS container configured to use GPU but OOM crashes due to LLM

Target state:
- jarvis-api on Home STOPPED and DISABLED
- LOCAL_LLM_ENDPOINT points to 192.168.1.61:8080 (agent1)
- XTTS container healthy on GPU
- User hears trained JARVIS voice
</context>

<tasks>

<task type="auto">
  <name>Task 1: Stop LLM on Home and update backend config</name>
  <files>/root/docker-compose.yml, /root/.env</files>
  <action>
1. Stop and disable jarvis-api service on Home node:
   ```bash
   systemctl stop jarvis-api
   systemctl disable jarvis-api
   ```

2. Update .env file to set LOCAL_LLM_ENDPOINT to agent1:
   ```bash
   # In /root/.env, ensure this line exists:
   LOCAL_LLM_ENDPOINT=http://192.168.1.61:8080
   ```
   If .env doesn't exist, create it with the required variable.

3. Verify docker-compose.yml already references the env var (it does: `${LOCAL_LLM_ENDPOINT:-http://192.168.1.50:8080}`)
  </action>
  <verify>
  - `systemctl is-enabled jarvis-api` returns "disabled"
  - `grep LOCAL_LLM_ENDPOINT /root/.env` shows agent1 IP
  - `curl -s http://192.168.1.61:8080/health` returns OK
  </verify>
  <done>jarvis-api stopped on Home, LLM endpoint configured for agent1</done>
</task>

<task type="auto">
  <name>Task 2: Restart Docker stack and verify XTTS GPU</name>
  <files>N/A (container operations)</files>
  <action>
1. Restart the entire Jarvis Docker stack to pick up new env:
   ```bash
   cd /root && docker compose down && docker compose up -d --build
   ```

2. Wait for containers to become healthy (XTTS takes up to 5 min to load model)

3. Verify XTTS is using GPU (not crashing):
   ```bash
   docker logs jarvis-tts 2>&1 | tail -30
   nvidia-smi
   ```

4. Test LLM connectivity from backend:
   ```bash
   curl -s http://192.168.1.61:8080/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"qwen2.5-7b-instruct-q4_k_m.gguf","messages":[{"role":"user","content":"Say hello"}],"max_tokens":20}' | jq -r '.choices[0].message.content'
   ```

5. Test XTTS voice synthesis:
   ```bash
   curl -s -X POST http://localhost:5050/synthesize \
     -H "Content-Type: application/json" \
     -d '{"text":"Hello, I am JARVIS.","voice":"jarvis"}' \
     --output /tmp/test-voice.wav && file /tmp/test-voice.wav
   ```
  </action>
  <verify>
  - `docker ps` shows all 4 containers healthy (backend, frontend, tts, piper)
  - `nvidia-smi` shows XTTS using GPU memory (not 0MB)
  - `/tmp/test-voice.wav` is a valid RIFF audio file
  - `docker logs jarvis-tts` shows no CUDA OOM errors
  </verify>
  <done>XTTS running on GPU, LLM on agent1 CPU, full stack healthy</done>
</task>

<task type="auto">
  <name>Task 3: End-to-end voice test via API</name>
  <files>N/A</files>
  <action>
1. Get auth token:
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"password":"jarvis"}' | jq -r '.token')
   ```

2. Send a chat message that triggers voice response:
   ```bash
   curl -s -X POST http://localhost:4000/api/chat \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"message":"What time is it?","voice":true}' | jq
   ```

3. Check that response includes audio data (base64 wav or audio URL)

4. Verify logs show XTTS was used (not Piper fallback):
   ```bash
   docker logs jarvis-backend 2>&1 | tail -20 | grep -i tts
   ```
  </action>
  <verify>
  - Chat API returns 200 with response text
  - Response includes audio data
  - Backend logs show "XTTS" or "local TTS" (not "Piper fallback")
  </verify>
  <done>Full voice pipeline working: agent1 LLM -> Home backend -> GPU XTTS -> trained JARVIS voice</done>
</task>

</tasks>

<verification>
After all tasks:
1. `systemctl is-active jarvis-api` returns "inactive" on Home
2. `curl http://192.168.1.61:8080/health` returns OK (LLM on agent1)
3. `docker compose ps` shows all containers healthy
4. `nvidia-smi` shows GPU memory used by XTTS (not LLM)
5. Voice responses use trained JARVIS voice (not Piper fallback)
</verification>

<success_criteria>
- LLM inference happens on agent1 CPU (verified via agent1 llama-server logs during chat)
- XTTS container is healthy and using GPU (verified via nvidia-smi)
- Voice responses work end-to-end with trained JARVIS voice
- No CUDA OOM errors in logs
</success_criteria>

<output>
Update STATE.md with:
- Quick task 001 completed
- LLM moved to agent1 CPU (12 threads, 4.8GB RAM)
- XTTS now has dedicated GPU access
- Trained JARVIS voice working
</output>

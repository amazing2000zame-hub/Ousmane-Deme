/**
 * 4 voice retraining pipeline tools.
 *
 * extract_voice_audio  -- YELLOW: ffmpeg extraction + speech segmentation
 * prepare_voice_dataset -- YELLOW: faster-whisper transcription + LJSpeech metadata
 * retrain_voice_model  -- YELLOW: XTTS v2 GPT fine-tuning inside Docker container
 * deploy_voice_model   -- RED: restart TTS container with new weights + clear cache
 *
 * All processing runs on the Home node where the TTS infrastructure lives.
 * Extraction and transcription use host-side tools (ffmpeg, faster-whisper).
 * Fine-tuning runs inside the jarvis-tts Docker container (Coqui TTS libs).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TTS_BASE = '/opt/jarvis-tts';
const SOURCES_DIR = `${TTS_BASE}/sources`;
const DATASET_DIR = `${TTS_BASE}/training/dataset`;
const WAVS_DIR = `${DATASET_DIR}/wavs`;
const TRAINING_OUTPUT = `${TTS_BASE}/training/output`;
const VOICES_DIR = `${TTS_BASE}/voices/jarvis`;
const CACHE_DIR = `${TTS_BASE}/cache`;

/** Max execution time for extraction (5 minutes) */
const EXTRACT_TIMEOUT_MS = 300_000;

/** Max execution time for transcription (10 minutes) */
const TRANSCRIBE_TIMEOUT_MS = 600_000;

/** Max execution time for training (60 minutes) */
const TRAIN_TIMEOUT_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function countWavFiles(dir: string): Promise<number> {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.wav')).length;
  } catch {
    return 0;
  }
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

function errorResult(s: string) {
  return { content: [{ type: 'text' as const, text: s }], isError: true };
}

// ---------------------------------------------------------------------------
// Tool 1: extract_voice_audio
// ---------------------------------------------------------------------------

async function handleExtractVoiceAudio(args: Record<string, unknown>) {
  const sourcePath = args.sourcePath as string;
  const minDuration = (args.minDuration as number) ?? 4;
  const maxDuration = (args.maxDuration as number) ?? 16;

  // Validate source exists
  if (!await fileExists(sourcePath)) {
    return errorResult(`Source file not found: ${sourcePath}`);
  }

  // Ensure output directories exist
  await fs.mkdir(WAVS_DIR, { recursive: true });
  await fs.mkdir(SOURCES_DIR, { recursive: true });

  // Count existing clips to avoid overwriting
  const existingCount = await countWavFiles(WAVS_DIR);

  try {
    // Step 1: Convert source to 22050Hz mono WAV
    const tempWav = path.join(SOURCES_DIR, `temp_${Date.now()}.wav`);
    await execAsync(
      `ffmpeg -y -i "${sourcePath}" -vn -acodec pcm_s16le -ar 22050 -ac 1 "${tempWav}"`,
      { timeout: EXTRACT_TIMEOUT_MS },
    );

    // Step 2: Get duration
    const probeResult = await execAsync(
      `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tempWav}"`,
    );
    const totalDuration = parseFloat(probeResult.stdout.trim());

    // Step 3: Detect speech segments using silencedetect
    const silenceResult = await execAsync(
      `ffmpeg -i "${tempWav}" -af "silencedetect=noise=-35dB:d=0.4" -f null - 2>&1`,
      { timeout: EXTRACT_TIMEOUT_MS },
    );

    // Parse silence boundaries
    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];
    for (const line of silenceResult.stdout.split('\n')) {
      const startMatch = line.match(/silence_start:\s*([\d.]+)/);
      if (startMatch) silenceStarts.push(parseFloat(startMatch[1]));
      const endMatch = line.match(/silence_end:\s*([\d.]+)/);
      if (endMatch) silenceEnds.push(parseFloat(endMatch[1]));
    }

    // Build speech segments from silence gaps
    const rawSegments: { start: number; end: number }[] = [];
    let speechStart = 0;
    for (let i = 0; i < silenceStarts.length; i++) {
      if (silenceStarts[i] > speechStart + 0.5) {
        rawSegments.push({ start: speechStart, end: silenceStarts[i] });
      }
      if (i < silenceEnds.length) speechStart = silenceEnds[i];
    }
    if (speechStart < totalDuration - 0.5) {
      rawSegments.push({ start: speechStart, end: totalDuration });
    }

    // Step 4: Merge short / split long segments
    const segments: { start: number; end: number; duration: number }[] = [];
    let current = rawSegments[0] ? { ...rawSegments[0] } : null;

    for (let i = 1; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      if (!current) { current = { ...seg }; continue; }
      const gap = seg.start - current.end;
      const combined = seg.end - current.start;
      if (combined <= maxDuration && gap < 1.5) {
        current.end = seg.end;
      } else {
        const dur = current.end - current.start;
        if (dur >= minDuration) segments.push({ ...current, duration: dur });
        current = { ...seg };
      }
    }
    if (current) {
      const dur = current.end - current.start;
      if (dur >= minDuration) segments.push({ ...current, duration: dur });
    }

    // Split oversized segments
    const finalSegments: typeof segments = [];
    for (const seg of segments) {
      if (seg.duration <= maxDuration) {
        finalSegments.push(seg);
      } else {
        const mid = (seg.start + seg.end) / 2;
        finalSegments.push({ start: seg.start, end: mid, duration: mid - seg.start });
        finalSegments.push({ start: mid, end: seg.end, duration: seg.end - mid });
      }
    }

    // Step 5: Extract each segment
    let extracted = 0;
    for (const seg of finalSegments) {
      const idx = existingCount + extracted + 1;
      const clipName = `jarvis-${String(idx).padStart(4, '0')}.wav`;
      const clipPath = path.join(WAVS_DIR, clipName);
      await execAsync(
        `ffmpeg -y -i "${tempWav}" -ss ${seg.start} -t ${seg.duration} -acodec pcm_s16le -ar 22050 -ac 1 "${clipPath}"`,
      );
      extracted++;
    }

    // Cleanup temp file
    await fs.unlink(tempWav).catch(() => {});

    const totalClips = existingCount + extracted;
    return text(
      `Audio extraction complete.\n` +
      `Source: ${path.basename(sourcePath)} (${totalDuration.toFixed(1)}s)\n` +
      `Raw speech segments: ${rawSegments.length}\n` +
      `Extracted clips: ${extracted} (${minDuration}-${maxDuration}s each)\n` +
      `Total clips in dataset: ${totalClips}\n` +
      `Output: ${WAVS_DIR}/`,
    );
  } catch (err) {
    return errorResult(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Tool 2: prepare_voice_dataset
// ---------------------------------------------------------------------------

async function handlePrepareVoiceDataset(args: Record<string, unknown>) {
  const regenerate = (args.regenerate as boolean) ?? false;

  // Check wavs directory has clips
  const clipCount = await countWavFiles(WAVS_DIR);
  if (clipCount === 0) {
    return errorResult(
      `No WAV clips found in ${WAVS_DIR}. Run extract_voice_audio first to extract clips from source audio/video files.`,
    );
  }

  // Check if metadata already exists
  const metadataPath = path.join(DATASET_DIR, 'metadata.csv');
  if (await fileExists(metadataPath) && !regenerate) {
    const existing = await fs.readFile(metadataPath, 'utf-8');
    const lineCount = existing.trim().split('\n').length;
    return text(
      `Dataset already prepared with ${lineCount} entries.\n` +
      `WAV clips: ${clipCount}\n` +
      `Metadata: ${metadataPath}\n` +
      `Set regenerate=true to re-transcribe all clips.`,
    );
  }

  try {
    // Run faster-whisper transcription via Python
    const pythonScript = `
import sys, os
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
from faster_whisper import WhisperModel
import re

wavs_dir = "${WAVS_DIR}"
model = WhisperModel("base.en", device="cpu", compute_type="int8")

wav_files = sorted([f for f in os.listdir(wavs_dir) if f.endswith('.wav')])
results = []
for wav_file in wav_files:
    wav_path = os.path.join(wavs_dir, wav_file)
    try:
        segments, info = model.transcribe(wav_path, language="en", beam_size=5, vad_filter=True)
        text_parts = [seg.text.strip() for seg in segments]
        transcript = " ".join(text_parts).strip()
        transcript = re.sub(r'\\s+', ' ', transcript)
        if transcript:
            basename = wav_file.replace('.wav', '')
            results.append(f"{basename}|{transcript}|{transcript}")
            print(f"OK: {wav_file}: {transcript[:80]}...")
        else:
            print(f"SKIP: {wav_file}: empty transcript")
    except Exception as e:
        print(f"ERR: {wav_file}: {e}")

# Write metadata.csv
csv_path = os.path.join("${DATASET_DIR}", "metadata.csv")
with open(csv_path, "w") as f:
    f.write("\\n".join(results) + "\\n")
print(f"DONE: {len(results)} entries written to {csv_path}")
`;

    const { stdout, stderr } = await execAsync(
      `python3 -c ${JSON.stringify(pythonScript)}`,
      { timeout: TRANSCRIBE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );

    // Count results
    const output = stdout.trim();
    const okCount = (output.match(/^OK:/gm) || []).length;
    const skipCount = (output.match(/^SKIP:/gm) || []).length;
    const errCount = (output.match(/^ERR:/gm) || []).length;

    // Also copy clips to voices directory for reference audio
    await fs.mkdir(VOICES_DIR, { recursive: true });
    const wavFiles = await fs.readdir(WAVS_DIR);
    // Copy up to 10 best clips as reference audio
    const refClips = wavFiles.filter(f => f.endsWith('.wav')).slice(0, 10);
    for (const clip of refClips) {
      await fs.copyFile(
        path.join(WAVS_DIR, clip),
        path.join(VOICES_DIR, clip),
      );
    }

    return text(
      `Dataset preparation complete.\n` +
      `Transcribed: ${okCount} clips\n` +
      `Skipped (empty): ${skipCount}\n` +
      `Errors: ${errCount}\n` +
      `Total WAV clips: ${clipCount}\n` +
      `Metadata: ${metadataPath}\n` +
      `Reference audio updated: ${refClips.length} clips copied to ${VOICES_DIR}\n\n` +
      `Dataset is ready for retraining. Use retrain_voice_model to start fine-tuning.`,
    );
  } catch (err) {
    return errorResult(`Dataset preparation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Tool 3: retrain_voice_model
// ---------------------------------------------------------------------------

async function handleRetrainVoiceModel(args: Record<string, unknown>) {
  const epochs = (args.epochs as number) ?? 6;

  // Validate dataset exists
  const metadataPath = path.join(DATASET_DIR, 'metadata.csv');
  if (!await fileExists(metadataPath)) {
    return errorResult(
      `No training dataset found at ${metadataPath}. Run prepare_voice_dataset first.`,
    );
  }

  // Count training samples
  const metadata = await fs.readFile(metadataPath, 'utf-8');
  const sampleCount = metadata.trim().split('\n').length;
  if (sampleCount < 3) {
    return errorResult(
      `Dataset has only ${sampleCount} samples. Need at least 3 for meaningful training.`,
    );
  }

  // Check Docker container is running
  try {
    const { stdout } = await execAsync('docker inspect -f "{{.State.Running}}" jarvis-tts');
    if (stdout.trim() !== 'true') {
      return errorResult('TTS container is not running. Start it first: cd /opt/jarvis-tts && docker compose up -d');
    }
  } catch {
    return errorResult('TTS Docker container not found. Is Docker running?');
  }

  try {
    // Update epochs in finetune script if different from default
    if (epochs !== 6) {
      await execAsync(
        `docker exec jarvis-tts sed -i 's/epochs=${6}/epochs=${epochs}/' /training/finetune_xtts.py 2>/dev/null || true`,
      );
    }

    // Run fine-tuning inside Docker container (background)
    // The training script uses /training/dataset/ which is volume-mounted
    const { stdout, stderr } = await execAsync(
      `docker exec jarvis-tts python3 /training/finetune_xtts.py 2>&1`,
      { timeout: TRAIN_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
    );

    // Check for completion
    const lines = stdout.split('\n');
    const lastLines = lines.slice(-20).join('\n');
    const success = stdout.includes('Fine-tuning complete');

    if (success) {
      // Extract the best GPT checkpoint
      const checkpointDir = `${TRAINING_OUTPUT}/gpt_finetuned`;
      const weightsPath = `${TRAINING_OUTPUT}/gpt_finetuned_weights.pth`;

      // Find latest checkpoint and extract GPT weights
      const extractScript = `
import torch, glob, os
ckpt_dir = "${checkpointDir}"
ckpts = sorted(glob.glob(os.path.join(ckpt_dir, "*.pth")))
if not ckpts:
    print("ERROR: No checkpoints found")
    exit(1)
best = ckpts[-1]
print(f"Loading checkpoint: {best}")
state = torch.load(best, map_location="cpu")
model_state = state.get("model", state)
gpt_weights = {k: v for k, v in model_state.items() if "gpt" in k.lower()}
print(f"Extracted {len(gpt_weights)} GPT weight tensors")
torch.save(gpt_weights, "${weightsPath}")
print(f"Saved to: ${weightsPath}")
`;
      await execAsync(
        `docker exec jarvis-tts python3 -c ${JSON.stringify(extractScript)}`,
        { timeout: 60_000 },
      );

      // Re-compute speaker embedding with new model
      const embedScript = `
import torch
from TTS.tts.models.xtts import Xtts
from TTS.tts.configs.xtts_config import XttsConfig
import glob

model_dir = "/models/.local/share/tts/tts_models--multilingual--multi-dataset--xtts_v2"
config = XttsConfig()
config.load_json(f"{model_dir}/config.json")
config.model_dir = model_dir
model = Xtts(config)
model.load_checkpoint(config, checkpoint_dir=model_dir, eval=True, strict=False)

# Load fine-tuned GPT weights
gpt_weights = torch.load("${weightsPath}", map_location="cpu")
model.load_state_dict(gpt_weights, strict=False)

# Compute speaker embedding from reference clips
ref_files = sorted(glob.glob("/voices/jarvis/*.wav"))[:10]
if ref_files:
    gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(audio_path=ref_files)
    torch.save({
        "gpt_cond_latent": gpt_cond_latent,
        "speaker_embedding": speaker_embedding,
        "num_clips": len(ref_files),
    }, "/training/output/jarvis_speaker.pth")
    print(f"Speaker embedding computed from {len(ref_files)} clips")
else:
    print("WARNING: No reference clips found for embedding")
`;
      await execAsync(
        `docker exec jarvis-tts python3 -c ${JSON.stringify(embedScript)}`,
        { timeout: 120_000 },
      );

      return text(
        `Voice model retraining complete!\n` +
        `Epochs: ${epochs}\n` +
        `Training samples: ${sampleCount}\n` +
        `GPT weights saved: ${weightsPath}\n` +
        `Speaker embedding: updated\n\n` +
        `${lastLines}\n\n` +
        `Use deploy_voice_model to apply the new weights to the live TTS service.`,
      );
    } else {
      return errorResult(
        `Training may have failed. Last output:\n${lastLines}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Check if it's a timeout (training took too long)
    if (msg.includes('TIMEOUT') || msg.includes('timeout')) {
      return errorResult(
        `Training timed out after ${TRAIN_TIMEOUT_MS / 60000} minutes. ` +
        `Try reducing epochs or running manually: docker exec jarvis-tts python3 /training/finetune_xtts.py`,
      );
    }
    return errorResult(`Training failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Tool 4: deploy_voice_model
// ---------------------------------------------------------------------------

async function handleDeployVoiceModel(_args: Record<string, unknown>) {
  const weightsPath = `${TRAINING_OUTPUT}/gpt_finetuned_weights.pth`;
  const speakerPath = `${TRAINING_OUTPUT}/jarvis_speaker.pth`;

  // Validate weights exist
  if (!await fileExists(weightsPath)) {
    return errorResult(
      `No fine-tuned weights found at ${weightsPath}. Run retrain_voice_model first.`,
    );
  }

  try {
    // Step 1: Clear synthesis cache (old voice cached phrases)
    const cacheFiles = await fs.readdir(CACHE_DIR).catch(() => []);
    let cleared = 0;
    for (const f of cacheFiles) {
      if (f.endsWith('.wav')) {
        await fs.unlink(path.join(CACHE_DIR, f)).catch(() => {});
        cleared++;
      }
    }

    // Step 2: Restart TTS container (reloads model + weights on startup)
    const { stdout: restartOut } = await execAsync(
      'cd /opt/jarvis-tts && docker compose restart jarvis-tts',
      { timeout: 120_000 },
    );

    // Step 3: Wait for health check
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 10_000)); // Wait 10s between checks
      try {
        const { stdout: healthOut } = await execAsync(
          'curl -sf http://192.168.1.50:5050/health',
          { timeout: 5000 },
        );
        const health = JSON.parse(healthOut);
        if (health.status === 'ready' && health.voice_ready) {
          healthy = true;
          break;
        }
      } catch {
        // Still starting up
      }
    }

    if (!healthy) {
      return errorResult(
        'TTS container restarted but health check failed after 5 minutes. ' +
        'Check logs: docker logs jarvis-tts --tail 50',
      );
    }

    // Step 4: Test synthesis
    let testResult = 'Test synthesis: skipped';
    try {
      const { stdout: synthOut } = await execAsync(
        `curl -sf -X POST http://192.168.1.50:5050/synthesize -H "Content-Type: application/json" ` +
        `-d '{"text":"Good evening, sir. All systems are operational.","language":"en","voice":"jarvis"}' ` +
        `-o /tmp/deploy-test.wav`,
        { timeout: 30_000 },
      );
      const testStat = await fs.stat('/tmp/deploy-test.wav').catch(() => null);
      if (testStat && testStat.size > 1000) {
        testResult = `Test synthesis: success (${(testStat.size / 1024).toFixed(1)} KB)`;
      } else {
        testResult = 'Test synthesis: produced empty or very small output';
      }
    } catch {
      testResult = 'Test synthesis: failed (service may still be warming up)';
    }

    // Step 5: Get final health info
    let healthInfo = '';
    try {
      const { stdout: finalHealth } = await execAsync(
        'curl -sf http://192.168.1.50:5050/health',
        { timeout: 5000 },
      );
      const h = JSON.parse(finalHealth);
      healthInfo = `\nTTS Status: ${h.status}, Mode: ${h.mode}, Fine-tuned: ${h.gpt_finetuned}, References: ${h.reference_audio}`;
    } catch {
      healthInfo = '';
    }

    return text(
      `Voice model deployed successfully!\n` +
      `Cache cleared: ${cleared} cached phrases removed\n` +
      `Container: restarted\n` +
      `Health: ${healthy ? 'ready' : 'pending'}\n` +
      `${testResult}${healthInfo}\n\n` +
      `The new JARVIS voice is now live. Try speaking to test the improved quality.`,
    );
  } catch (err) {
    return errorResult(`Deployment failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerVoiceTools(server: McpServer): void {
  server.tool(
    'extract_voice_audio',
    'Extract audio segments from a video or audio file for JARVIS voice training. Converts to 22050Hz mono WAV, detects speech boundaries, and segments into clips suitable for XTTS v2 fine-tuning.',
    {
      sourcePath: z.string().describe('Absolute path to source video or audio file (mp4, mkv, wav, mp3, etc.)'),
      minDuration: z.number().optional().describe('Minimum clip duration in seconds (default: 4)'),
      maxDuration: z.number().optional().describe('Maximum clip duration in seconds (default: 16)'),
    },
    async ({ sourcePath, minDuration, maxDuration }) => {
      return handleExtractVoiceAudio({ sourcePath, minDuration, maxDuration });
    },
  );

  server.tool(
    'prepare_voice_dataset',
    'Transcribe extracted audio clips using Whisper and build an LJSpeech-format training dataset (metadata.csv + wavs/). Must be run after extract_voice_audio.',
    {
      regenerate: z.boolean().optional().describe('Re-transcribe all clips even if metadata.csv exists (default: false)'),
    },
    async ({ regenerate }) => {
      return handlePrepareVoiceDataset({ regenerate });
    },
  );

  server.tool(
    'retrain_voice_model',
    'Fine-tune the XTTS v2 GPT decoder on the prepared JARVIS voice dataset. Runs inside the TTS Docker container. Produces fine-tuned weights and updated speaker embeddings.',
    {
      epochs: z.number().optional().describe('Number of training epochs (default: 6)'),
    },
    async ({ epochs }) => {
      return handleRetrainVoiceModel({ epochs });
    },
  );

  server.tool(
    'deploy_voice_model',
    'Deploy retrained voice model to the live TTS service. Clears synthesis cache, restarts the TTS container, waits for health check, and runs a test synthesis.',
    {},
    async () => {
      return handleDeployVoiceModel({});
    },
  );
}

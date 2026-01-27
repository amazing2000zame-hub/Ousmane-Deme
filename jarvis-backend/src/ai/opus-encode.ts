/**
 * WAV-to-OGG Opus transcoding via FFmpeg child process with stdin/stdout piping.
 *
 * Phase 23: Spawns FFmpeg with libopus codec to encode WAV audio buffers
 * into OGG Opus format. Zero temp files -- all I/O via pipes.
 *
 * Requires FFmpeg with libopus support installed in the container
 * (added to Dockerfile in Phase 23 Task 1).
 */

import { spawn } from 'node:child_process';
import { config } from '../config.js';

/**
 * Check whether Opus encoding is enabled via configuration.
 */
export function isOpusEnabled(): boolean {
  return config.opusEnabled;
}

/**
 * Transcode a WAV buffer to OGG Opus via FFmpeg stdin/stdout pipes.
 *
 * @param wavBuffer - Raw WAV audio data
 * @param bitrate - Target bitrate in kbps (default: config.opusBitrate)
 * @returns Object with encoded buffer and content type string
 * @throws Error if FFmpeg exits with non-zero code or fails to spawn
 */
export function encodeWavToOpus(
  wavBuffer: Buffer,
  bitrate?: number
): Promise<{ buffer: Buffer; contentType: string }> {
  const targetBitrate = bitrate ?? config.opusBitrate;

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', `${targetBitrate}k`,
      '-vbr', 'on',
      '-application', 'voip',
      '-f', 'ogg',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({
          buffer: Buffer.concat(stdoutChunks),
          contentType: 'audio/ogg; codecs=opus',
        });
      } else {
        const stderrMsg = Buffer.concat(stderrChunks).toString('utf-8').trim();
        reject(new Error(
          `FFmpeg Opus encoding failed (exit ${code})${stderrMsg ? ': ' + stderrMsg : ''}`
        ));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });

    // Write WAV buffer to stdin and signal end
    ffmpeg.stdin.write(wavBuffer);
    ffmpeg.stdin.end();
  });
}

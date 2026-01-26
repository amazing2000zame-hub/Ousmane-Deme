/**
 * Audio waveform visualizer bar — shown above the chat messages
 * when JARVIS is speaking. Reads frequency data from the
 * AnalyserNode exposed by the voice store.
 *
 * Iron Man aesthetic: amber bars on dark background with glow.
 */

import { useEffect, useRef } from 'react';
import { useVoiceStore } from '../../stores/voice';

const BAR_COUNT = 32;
const BAR_GAP = 2;

export function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const analyserNode = useVoiceStore((s) => s.analyserNode);
  const isPlaying = useVoiceStore((s) => s.isPlaying);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (analyserNode && isPlaying) {
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);

        const barWidth = (width - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
        const step = Math.floor(bufferLength / BAR_COUNT);

        for (let i = 0; i < BAR_COUNT; i++) {
          // Average a range of frequency bins for each bar
          let sum = 0;
          for (let j = 0; j < step; j++) {
            sum += dataArray[i * step + j] ?? 0;
          }
          const avg = sum / step;
          const barHeight = (avg / 255) * height;

          const x = i * (barWidth + BAR_GAP);
          const y = height - barHeight;

          // Amber gradient with intensity-based opacity
          const intensity = avg / 255;
          ctx.fillStyle = `rgba(255, 176, 0, ${0.3 + intensity * 0.7})`;
          ctx.shadowColor = 'rgba(255, 176, 0, 0.5)';
          ctx.shadowBlur = intensity > 0.5 ? 4 : 0;

          // Rounded top
          const radius = Math.min(barWidth / 2, 2);
          ctx.beginPath();
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + barWidth - radius, y);
          ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
          ctx.lineTo(x + barWidth, height);
          ctx.lineTo(x, height);
          ctx.lineTo(x, y + radius);
          ctx.quadraticCurveTo(x, y, x + radius, y);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      } else {
        // Idle state: flat amber line
        ctx.strokeStyle = 'rgba(255, 176, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [analyserNode, isPlaying]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        canvas.width = width * window.devicePixelRatio;
        canvas.height = 32 * window.devicePixelRatio;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    });

    observer.observe(canvas.parentElement!);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="h-8 px-3 py-1 border-b border-jarvis-amber/10 bg-jarvis-bg-panel flex items-center gap-2">
      <span className="text-[8px] font-display tracking-wider text-cyan-400 uppercase shrink-0 animate-pulse">
        SPEAKING
      </span>
      <canvas
        ref={canvasRef}
        className="flex-1 h-full"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}

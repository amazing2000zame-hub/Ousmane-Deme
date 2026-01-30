import { useEffect, useRef, useState } from 'react';
import type { VideoRTCElement } from '../../vendor/video-rtc';

interface InlineCameraCardProps {
  camera: string;
  onClose?: () => void;
}

// Frigate's go2rtc MSE WebSocket endpoint
const FRIGATE_URL = 'http://192.168.1.61:5000';

/**
 * Inline camera card for displaying live video within chat messages.
 * Compact version of LiveStreamModal, designed to fit in conversation flow.
 */
export function InlineCameraCard({ camera, onClose }: InlineCameraCardProps) {
  const videoRef = useRef<VideoRTCElement | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [retryCount, setRetryCount] = useState(0);

  // Set stream source when component mounts or retry is triggered
  useEffect(() => {
    const el = videoRef.current as VideoRTCElement | null;
    if (!el) return;

    let mounted = true;

    // Reset state on new connection attempt
    setConnectionState('connecting');

    // video-rtc.js expects property assignment (not setAttribute) to trigger connection
    el.mode = 'mse,webrtc,hls';
    el.media = 'video,audio';
    el.src = `${FRIGATE_URL}/live/mse/api/ws?src=${camera}`;

    // Poll for connection state with timeout
    const startTime = Date.now();
    const CONNECTION_TIMEOUT_MS = 10000; // 10 seconds

    const checkConnection = () => {
      if (!mounted) return;

      const video = el.querySelector('video');
      if (video && !video.paused && video.readyState >= 2) {
        setConnectionState('connected');
        return;
      }

      // Check for timeout
      if (Date.now() - startTime > CONNECTION_TIMEOUT_MS) {
        setConnectionState('error');
        return;
      }
    };

    const intervalId = setInterval(checkConnection, 500);

    return () => {
      mounted = false;
      clearInterval(intervalId);
      // Setting empty src triggers disconnect
      el.src = '';
    };
  }, [camera, retryCount]);

  const displayName = camera
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-jarvis-amber/30 bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 bg-jarvis-bg-panel border-b border-jarvis-amber/20">
        <div className="flex items-center gap-2">
          <span className="font-display text-jarvis-amber text-[10px] uppercase tracking-wider">
            {displayName}
          </span>
          <span className="text-[8px] font-display uppercase tracking-wider px-1 py-0.5 rounded bg-jarvis-red/20 text-jarvis-red animate-pulse">
            LIVE
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-jarvis-text-dim hover:text-jarvis-amber transition-colors p-0.5"
            title="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Video container */}
      <div className="relative aspect-video">
        <video-rtc
          ref={videoRef as React.RefObject<HTMLElement>}
          className="w-full h-full"
          autoplay
        />

        {/* Connection status overlay */}
        {connectionState === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="flex flex-col items-center gap-1">
              <div className="w-1.5 h-1.5 bg-jarvis-amber rounded-full animate-ping" />
              <span className="text-jarvis-text-dim text-[9px] font-display tracking-wider">
                CONNECTING
              </span>
            </div>
          </div>
        )}
        {connectionState === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="flex flex-col items-center gap-1">
              <svg className="w-4 h-4 text-jarvis-red" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-jarvis-red text-[9px] font-display tracking-wider">
                CONNECTION FAILED
              </span>
              <button
                onClick={() => setRetryCount(c => c + 1)}
                className="mt-1 px-2 py-0.5 text-[8px] font-display tracking-wider text-jarvis-amber border border-jarvis-amber/30 rounded hover:bg-jarvis-amber/10 transition-colors"
              >
                RETRY
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

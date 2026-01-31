import { memo, useEffect, useRef, useState } from 'react';
import type { VideoRTCElement } from '../../vendor/video-rtc';

interface LiveCameraCardProps {
  camera: string;
  onClick?: () => void;
}

// Frigate's go2rtc MSE WebSocket endpoint
const FRIGATE_URL = 'http://192.168.1.61:5000';

/**
 * Live camera card using video-rtc.js for real-time streaming.
 * Replaces snapshot-based CameraCard for actual live feeds in camera grid.
 */
export const LiveCameraCard = memo(function LiveCameraCard({
  camera,
  onClick,
}: LiveCameraCardProps) {
  const videoRef = useRef<VideoRTCElement | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Format camera name for display
  const displayName = camera
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Set stream source when component mounts
  useEffect(() => {
    const el = videoRef.current as VideoRTCElement | null;
    if (!el) return;

    // video-rtc.js expects property assignment (not setAttribute) to trigger connection
    // The src setter auto-converts http:// to ws:// and calls onconnect()
    el.mode = 'mse,webrtc,hls,mjpeg';
    el.media = 'video';
    el.src = `${FRIGATE_URL}/live/mse/api/ws?src=${camera}`;

    // Poll for connection state since video events don't bubble
    // Check if WebSocket is connected (OPEN = 1) or video is playing
    const checkConnection = () => {
      const video = el.querySelector('video');
      if (video && !video.paused && video.readyState >= 2) {
        setIsConnected(true);
        setHasError(false);
      } else if (el.wsState === WebSocket.CLOSED && el.pcState === WebSocket.CLOSED) {
        // Both connections closed - likely an error
        const timeSinceMount = Date.now() - mountTime;
        if (timeSinceMount > 10000) {
          // Give it 10 seconds before showing error
          setHasError(true);
          setIsConnected(false);
        }
      }
    };

    const mountTime = Date.now();
    const intervalId = setInterval(checkConnection, 500);

    return () => {
      clearInterval(intervalId);
      // Setting empty src triggers disconnect
      el.src = '';
    };
  }, [camera]);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-video bg-black rounded-lg overflow-hidden border border-jarvis-amber/10 hover:border-jarvis-amber/30 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-jarvis-amber/50"
    >
      {/* Live video stream */}
      <video-rtc
        ref={videoRef as React.RefObject<HTMLElement>}
        className="w-full h-full object-cover"
        autoplay
      />

      {/* Loading overlay */}
      {!isConnected && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-jarvis-bg-panel">
          <div className="flex flex-col items-center gap-1">
            <div className="w-1.5 h-1.5 bg-jarvis-cyan rounded-full animate-ping" />
            <span className="text-jarvis-text-muted text-[9px] font-display tracking-wider">
              CONNECTING
            </span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-jarvis-bg-panel">
          <div className="flex flex-col items-center gap-1">
            <span className="text-jarvis-red text-[9px] font-display tracking-wider">
              OFFLINE
            </span>
          </div>
        </div>
      )}

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/70 to-transparent" />

      {/* Camera name overlay */}
      <div className="absolute inset-x-0 bottom-0 p-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs text-jarvis-amber tracking-wider uppercase">
            {displayName}
          </span>
          {isConnected && (
            <span className="text-[8px] font-display uppercase tracking-wider px-1 py-0.5 rounded bg-jarvis-red/20 text-jarvis-red animate-pulse">
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Hover effect - subtle amber glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-jarvis-amber/5 transition-opacity duration-200 pointer-events-none" />

      {/* Expand icon hint */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-jarvis-amber"
        >
          <polyline points="15,3 21,3 21,9" />
          <polyline points="9,21 3,21 3,15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </div>
    </button>
  );
});

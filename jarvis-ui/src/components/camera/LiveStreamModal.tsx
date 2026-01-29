import { useEffect, useRef, useCallback } from 'react';
import type { VideoRTCElement } from '../../vendor/video-rtc';

interface LiveStreamModalProps {
  camera: string;
  onClose: () => void;
}

// Frigate's go2rtc MSE WebSocket endpoint
const FRIGATE_URL = 'http://192.168.1.61:5000';

/**
 * Live stream modal using video-rtc.js for MSE/WebRTC streaming.
 * Auto-connects when opened, cleans up WebSocket on close.
 * Closes via X button, backdrop click, or Escape key.
 */
export function LiveStreamModal({ camera, onClose }: LiveStreamModalProps) {
  const videoRef = useRef<VideoRTCElement | null>(null);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Set stream source when component mounts
  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      // video-rtc.js auto-converts http:// to ws://
      el.setAttribute('src', `${FRIGATE_URL}/live/mse/api/ws?src=${camera}`);
      el.setAttribute('mode', 'mse,webrtc,hls');
      el.setAttribute('media', 'video,audio');
    }
    return () => {
      // Cleanup: remove src to close WebSocket
      if (el) {
        el.removeAttribute('src');
      }
    };
  }, [camera]);

  const displayName = camera
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-display text-jarvis-amber text-sm uppercase tracking-wider">
              {displayName}
            </span>
            <span className="text-[9px] font-display uppercase tracking-wider px-1.5 py-0.5 rounded bg-jarvis-red/20 text-jarvis-red animate-pulse">
              LIVE
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-jarvis-text-dim hover:text-jarvis-amber transition-colors p-1"
            title="Close (Esc)"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video container */}
        <div className="relative aspect-video bg-black rounded overflow-hidden border border-jarvis-amber/30">
          <video-rtc
            ref={videoRef as React.RefObject<HTMLElement>}
            className="w-full h-full"
            autoplay
          />

          {/* Loading overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 opacity-50">
              <div className="w-2 h-2 bg-jarvis-amber rounded-full animate-ping" />
              <span className="text-jarvis-text-dim text-xs font-display tracking-wider">
                CONNECTING
              </span>
            </div>
          </div>
        </div>

        {/* Controls hint */}
        <div className="mt-2 text-center text-[10px] text-jarvis-text-muted">
          Press Escape or click outside to close
        </div>
      </div>
    </div>
  );
}

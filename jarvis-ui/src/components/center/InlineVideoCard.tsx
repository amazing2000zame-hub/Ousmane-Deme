import { memo, useCallback } from 'react';
import { useChatStore } from '../../stores/chat';

interface InlineVideoCardProps {
  type: 'youtube' | 'direct';
  videoId?: string;
  url?: string;
  title: string;
  timestamp: string;
}

export const InlineVideoCard = memo(function InlineVideoCard({
  type,
  videoId,
  url,
  title,
  timestamp,
}: InlineVideoCardProps) {
  const clearInlineVideo = useChatStore((s) => s.clearInlineVideo);

  const handleClose = useCallback(() => {
    clearInlineVideo();
  }, [clearInlineVideo]);

  const handleOpenExternal = useCallback(() => {
    const externalUrl = type === 'youtube'
      ? `https://www.youtube.com/watch?v=${videoId}`
      : url;
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    }
  }, [type, videoId, url]);

  // YouTube embed URL with privacy-enhanced mode
  const embedUrl = type === 'youtube' && videoId
    ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`
    : null;

  return (
    <div className="mt-2 bg-black/60 border border-cyan-400/50 rounded-lg overflow-hidden max-w-[640px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border-b border-red-500/30">
        <span className="text-base">{type === 'youtube' ? '▶️' : '🎬'}</span>
        <span className="flex-1 text-white font-medium truncate">{title}</span>
        <div className="flex gap-1">
          <button
            className="w-6 h-6 flex items-center justify-center border border-white/30 text-white rounded text-xs hover:bg-white/10 transition-colors"
            onClick={handleOpenExternal}
            title={type === 'youtube' ? 'Open on YouTube' : 'Open in new tab'}
          >
            ↗
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center border border-white/30 text-white rounded text-xs hover:bg-red-500/20 hover:border-red-400 hover:text-red-400 transition-colors"
            onClick={handleClose}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Video content - 16:9 aspect ratio */}
      <div className="relative w-full pb-[56.25%] bg-black">
        {type === 'youtube' && embedUrl && (
          <iframe
            src={embedUrl}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute top-0 left-0 w-full h-full border-none"
          />
        )}
        {type === 'direct' && url && (
          <video
            src={url}
            controls
            autoPlay
            title={title}
            className="absolute top-0 left-0 w-full h-full"
          >
            Your browser does not support video playback.
          </video>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between px-3 py-1.5 text-[10px] text-white/50 border-t border-white/10">
        {type === 'youtube' && videoId && (
          <span>ID: {videoId}</span>
        )}
        {type === 'direct' && url && (
          <span className="flex-1 truncate">{url}</span>
        )}
        <span>{new Date(timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
});

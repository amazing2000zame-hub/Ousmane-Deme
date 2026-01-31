import { memo, useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chat';

interface InlineWebCardProps {
  url: string;
  title: string;
  timestamp: string;
}

export const InlineWebCard = memo(function InlineWebCard({
  url,
  title,
  timestamp,
}: InlineWebCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const clearInlineWebpage = useChatStore((s) => s.clearInlineWebpage);

  const handleLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setError(true);
  }, []);

  const handleClose = useCallback(() => {
    clearInlineWebpage();
  }, [clearInlineWebpage]);

  const handleOpenExternal = useCallback(() => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [url]);

  return (
    <div className="mt-2 bg-black/60 border border-cyan-400/50 rounded-lg overflow-hidden max-w-[800px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-cyan-400/10 border-b border-cyan-400/30">
        <span className="text-base">🌐</span>
        <span className="flex-1 text-cyan-400 font-medium truncate">{title}</span>
        <div className="flex gap-1">
          <button
            className="w-6 h-6 flex items-center justify-center border border-cyan-400/50 text-cyan-400 rounded text-xs hover:bg-cyan-400/20 transition-colors"
            onClick={handleOpenExternal}
            title="Open in new tab"
          >
            ↗
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center border border-cyan-400/50 text-cyan-400 rounded text-xs hover:bg-red-500/20 hover:border-red-400 hover:text-red-400 transition-colors"
            onClick={handleClose}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative h-[400px] bg-black">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-cyan-400">
            <span className="inline-block w-5 h-5 border-2 border-transparent border-t-cyan-400 rounded-full animate-spin mr-2" />
            Loading...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 gap-3">
            <span>Failed to load page. Site may block embedding.</span>
            <button
              onClick={handleOpenExternal}
              className="px-4 py-2 bg-cyan-400/20 border border-cyan-400 text-cyan-400 rounded hover:bg-cyan-400/30 transition-colors"
            >
              Open in new tab
            </button>
          </div>
        )}
        <iframe
          src={url}
          title={title}
          sandbox="allow-scripts allow-same-origin"
          onLoad={handleLoad}
          onError={handleError}
          className="w-full h-full border-none bg-white"
          style={{ display: loading || error ? 'none' : 'block' }}
        />
      </div>

      {/* Footer */}
      <div className="flex justify-between px-3 py-1.5 text-[10px] text-white/50 border-t border-cyan-400/30">
        <span className="flex-1 truncate">{url}</span>
        <span>{new Date(timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
});

import { memo, useCallback } from 'react';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

interface SearchResultsCardProps {
  query: string;
  results: SearchResult[];
  timestamp: string;
}

export const SearchResultsCard = memo(function SearchResultsCard({
  query,
  results,
  timestamp,
}: SearchResultsCardProps) {
  const handleResultClick = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="mt-2 bg-black/60 border border-cyan-400/50 rounded-lg p-3 max-w-[600px]">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-cyan-400/30 mb-2">
        <span className="text-base">🔍</span>
        <span className="text-cyan-400 font-medium flex-1 truncate">"{query}"</span>
        <span className="text-white/50 text-xs">{results.length} results</span>
      </div>

      {/* Results list */}
      <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
        {results.map((result, index) => (
          <div
            key={index}
            className="p-2.5 bg-cyan-400/5 border border-cyan-400/20 rounded cursor-pointer transition-all hover:bg-cyan-400/15 hover:border-cyan-400"
            onClick={() => handleResultClick(result.url)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleResultClick(result.url)}
          >
            <div className="text-cyan-400 font-medium mb-1 line-clamp-2">{result.title}</div>
            <div className="text-emerald-400/80 text-[11px] mb-1 break-all truncate">{result.url}</div>
            {result.snippet && (
              <div className="text-white/70 text-xs leading-relaxed line-clamp-2">{result.snippet}</div>
            )}
            {result.engine && (
              <div className="text-white/40 text-[10px] mt-1">via {result.engine}</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-cyan-400/30 mt-2">
        <span className="text-white/40 text-[10px]">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
});

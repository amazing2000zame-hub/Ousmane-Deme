/**
 * Web browsing and video playback MCP tools.
 *
 * Phase 32: Provides web search, webpage fetching/display, YouTube integration,
 * and video playback capabilities.
 *
 * Tools:
 *  - web_search: Search the web via SearXNG
 *  - fetch_webpage: Fetch and optionally summarize webpage content
 *  - open_url: Display webpage in sandboxed iframe in UI
 *  - search_youtube: Search for YouTube videos
 *  - play_youtube: Embed YouTube player in UI
 *  - play_video: Play direct video URLs
 *  - open_in_browser: Launch URL in system browser on cluster node
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
}

interface SearXNGResponse {
  results: Array<{
    title: string;
    url: string;
    content?: string;
    engine?: string;
  }>;
  query: string;
  number_of_results: number;
}

// ---------------------------------------------------------------------------
// URL Validation Utilities
// ---------------------------------------------------------------------------

const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // 10.0.0.0/8
  /^192\.168\./,                    // 192.168.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^127\./,                         // 127.0.0.0/8 (loopback)
  /^0\./,                           // 0.0.0.0/8
  /^169\.254\./,                    // Link-local
];

const BLOCKED_HOSTS = [
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '[::1]',
];

function isPrivateHost(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(lowerHost)) {
    return true;
  }
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }
  return false;
}

function validateUrlForFetch(urlString: string): { valid: boolean; error?: string; url?: URL } {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: `Invalid protocol: ${url.protocol}` };
    }
    if (isPrivateHost(url.hostname)) {
      return { valid: false, error: 'Private/local addresses not allowed' };
    }
    return { valid: true, url };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function validateUrlForEmbed(urlString: string): { valid: boolean; error?: string; url?: URL } {
  const fetchResult = validateUrlForFetch(urlString);
  if (!fetchResult.valid) {
    return fetchResult;
  }
  if (fetchResult.url!.protocol !== 'https:') {
    return { valid: false, error: 'HTTPS required for embedding' };
  }
  return { valid: true, url: fetchResult.url };
}

function extractTextFromHtml(html: string, maxLength: number = 5000): string {
  // Remove script and style tags with content
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  return text;
}

function validateYouTubeVideoId(input: string): string | null {
  // Direct video ID (11 chars, alphanumeric + dash + underscore)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }
  // YouTube URL patterns
  const watchMatch = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = input.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerWebTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // web_search - Search the web via SearXNG
  // -------------------------------------------------------------------------
  server.tool(
    'web_search',
    'Search the web for information. Returns titles, URLs, and snippets from multiple search engines. Use this when users ask to search for something, look something up, or need current information.',
    {
      query: z.string().describe('The search query'),
      limit: z.number().min(1).max(20).optional().describe('Maximum number of results to return (default: 5)'),
      engines: z.string().optional().describe('Comma-separated list of search engines (e.g., "google,bing,duckduckgo"). Leave empty for all.'),
    },
    async ({ query, limit = 5, engines }) => {
      try {
        const searchUrl = new URL('/search', config.searxngUrl);
        searchUrl.searchParams.set('q', query);
        searchUrl.searchParams.set('format', 'json');
        if (engines) {
          searchUrl.searchParams.set('engines', engines);
        }

        console.log(`[WEB] Searching: "${query}" via SearXNG`);

        const response = await fetch(searchUrl.toString(), {
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as SearXNGResponse;

        const results: SearchResult[] = data.results
          .slice(0, limit)
          .map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content || '',
            engine: r.engine,
          }));

        console.log(`[WEB] Found ${data.number_of_results} results, returning ${results.length}`);

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: `No results found for "${query}"` }],
          };
        }

        // Emit to UI for inline display
        try {
          const { chatNs } = await import('../../index.js');
          if (chatNs) {
            chatNs.emit('chat:show_search_results', {
              query,
              results,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Socket not available, continue without UI display
        }

        // Format results for Claude
        const formatted = results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Found ${data.number_of_results} results for "${query}":\n\n${formatted}`
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WEB] Search error: ${message}`);
        return {
          content: [{ type: 'text', text: `Search failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // fetch_webpage - Fetch and optionally summarize webpage content
  // -------------------------------------------------------------------------
  server.tool(
    'fetch_webpage',
    'Fetch the content of a webpage and optionally summarize it. Use this when users want to know what a webpage says, or need content from a URL.',
    {
      url: z.string().url().describe('The URL to fetch'),
      summarize: z.boolean().optional().describe('Whether to summarize the content (default: true)'),
    },
    async ({ url, summarize = true }) => {
      try {
        const validation = validateUrlForFetch(url);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `Cannot fetch URL: ${validation.error}` }],
            isError: true,
          };
        }

        console.log(`[WEB] Fetching: ${url}`);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Jarvis/3.1; +https://jarvis.local)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(10000),
          redirect: 'follow',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          return {
            content: [{ type: 'text', text: `Cannot parse content type: ${contentType}` }],
            isError: true,
          };
        }

        const html = await response.text();

        // Limit response size
        if (html.length > 1000000) {
          return {
            content: [{ type: 'text', text: 'Page too large to process (>1MB)' }],
            isError: true,
          };
        }

        const text = extractTextFromHtml(html, 5000);

        if (summarize) {
          return {
            content: [{
              type: 'text',
              text: `Content from ${url}:\n\n${text}\n\n[Summarize this content for the user]`
            }],
          };
        } else {
          return {
            content: [{ type: 'text', text: `Content from ${url}:\n\n${text}` }],
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WEB] Fetch error: ${message}`);
        return {
          content: [{ type: 'text', text: `Failed to fetch webpage: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // open_url - Display webpage in sandboxed iframe
  // -------------------------------------------------------------------------
  server.tool(
    'open_url',
    'Display a webpage in the chat interface using a sandboxed iframe. Use this when users want to see or view a website directly.',
    {
      url: z.string().url().describe('The URL to display'),
      title: z.string().optional().describe('Optional title for the display'),
    },
    async ({ url, title }) => {
      try {
        const validation = validateUrlForEmbed(url);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `Cannot embed URL: ${validation.error}` }],
            isError: true,
          };
        }

        console.log(`[WEB] Opening URL in iframe: ${url}`);

        // Emit to UI
        try {
          const { chatNs } = await import('../../index.js');
          if (chatNs) {
            chatNs.emit('chat:show_webpage', {
              url,
              title: title || new URL(url).hostname,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Socket not available
        }

        return {
          content: [{ type: 'text', text: `Displaying ${title || url} in the chat interface.` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WEB] Open URL error: ${message}`);
        return {
          content: [{ type: 'text', text: `Failed to open URL: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // search_youtube - Search for YouTube videos
  // -------------------------------------------------------------------------
  server.tool(
    'search_youtube',
    'Search for videos on YouTube. Returns video titles, URLs, and descriptions. Use this when users want to find videos, YouTube content, or something to watch.',
    {
      query: z.string().describe('What to search for on YouTube'),
      limit: z.number().min(1).max(10).optional().describe('Maximum number of results (default: 5)'),
    },
    async ({ query, limit = 5 }) => {
      try {
        const searchUrl = new URL('/search', config.searxngUrl);
        searchUrl.searchParams.set('q', query);
        searchUrl.searchParams.set('format', 'json');
        searchUrl.searchParams.set('categories', 'videos');
        searchUrl.searchParams.set('engines', 'youtube');

        console.log(`[WEB] YouTube search: "${query}"`);

        const response = await fetch(searchUrl.toString(), {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new Error(`SearXNG returned ${response.status}`);
        }

        const data = await response.json() as SearXNGResponse;

        interface YouTubeResult {
          title: string;
          url: string;
          videoId: string;
          description: string;
          thumbnail?: string;
        }

        const results: YouTubeResult[] = data.results
          .slice(0, limit * 2) // Get extra to filter
          .filter(r => r.url?.includes('youtube.com/watch') || r.url?.includes('youtu.be/'))
          .map(r => {
            let videoId = '';
            const watchMatch = r.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
            const shortMatch = r.url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
            if (watchMatch) videoId = watchMatch[1];
            else if (shortMatch) videoId = shortMatch[1];

            return {
              title: r.title,
              url: r.url,
              videoId,
              description: r.content || '',
              thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined,
            };
          })
          .filter(r => r.videoId)
          .slice(0, limit);

        console.log(`[WEB] Found ${results.length} YouTube videos`);

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: `No YouTube videos found for "${query}"` }],
          };
        }

        // Emit to UI
        try {
          const { chatNs } = await import('../../index.js');
          if (chatNs) {
            chatNs.emit('chat:show_search_results', {
              query: `YouTube: ${query}`,
              results: results.map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.description,
                engine: 'youtube',
              })),
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Socket not available
        }

        const formatted = results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.url}\n   Video ID: ${r.videoId}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Found ${results.length} YouTube videos for "${query}":\n\n${formatted}\n\nSay "play [title]" or "play video [number]" to watch.`
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WEB] YouTube search error: ${message}`);
        return {
          content: [{ type: 'text', text: `YouTube search failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // play_youtube - Embed YouTube video player
  // -------------------------------------------------------------------------
  server.tool(
    'play_youtube',
    'Play a YouTube video in the chat interface. Use this when users want to play, watch, or see a YouTube video.',
    {
      videoId: z.string().optional().describe('YouTube video ID (11 characters) or full URL'),
      url: z.string().optional().describe('YouTube video URL'),
      title: z.string().optional().describe('Video title for display'),
    },
    async ({ videoId, url, title }) => {
      try {
        const input = videoId || url;
        if (!input) {
          return {
            content: [{ type: 'text', text: 'Please provide a video ID or URL' }],
            isError: true,
          };
        }

        const validatedId = validateYouTubeVideoId(input);
        if (!validatedId) {
          return {
            content: [{ type: 'text', text: 'Invalid YouTube video ID or URL' }],
            isError: true,
          };
        }

        console.log(`[WEB] Playing YouTube video: ${validatedId}`);

        // Emit to UI
        try {
          const { chatNs } = await import('../../index.js');
          if (chatNs) {
            chatNs.emit('chat:show_video', {
              type: 'youtube',
              videoId: validatedId,
              title: title || 'YouTube Video',
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Socket not available
        }

        return {
          content: [{
            type: 'text',
            text: `Playing YouTube video${title ? `: ${title}` : ''}.`
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WEB] Play YouTube error: ${message}`);
        return {
          content: [{ type: 'text', text: `Failed to play video: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // play_video - Play direct video URL
  // -------------------------------------------------------------------------
  server.tool(
    'play_video',
    'Play a video from a direct URL (mp4, webm formats). Use this for non-YouTube video URLs.',
    {
      url: z.string().url().describe('Direct URL to the video file (mp4, webm)'),
      title: z.string().optional().describe('Title for the video'),
    },
    async ({ url, title }) => {
      try {
        const validation = validateUrlForFetch(url);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `Cannot play video: ${validation.error}` }],
            isError: true,
          };
        }

        // Check for supported video formats
        const urlLower = url.toLowerCase();
        const isVideo = urlLower.endsWith('.mp4') ||
                       urlLower.endsWith('.webm') ||
                       urlLower.endsWith('.ogg') ||
                       urlLower.includes('video/') ||
                       urlLower.includes('.mp4?') ||
                       urlLower.includes('.webm?');

        if (!isVideo) {
          // Try to detect content type
          try {
            const headResponse = await fetch(url, {
              method: 'HEAD',
              signal: AbortSignal.timeout(5000),
            });
            const contentType = headResponse.headers.get('content-type') || '';
            if (!contentType.startsWith('video/')) {
              return {
                content: [{ type: 'text', text: `URL does not appear to be a video (content-type: ${contentType})` }],
                isError: true,
              };
            }
          } catch {
            console.log('[WEB] Could not verify video content type, attempting playback');
          }
        }

        console.log(`[WEB] Playing direct video: ${url}`);

        // Emit to UI
        try {
          const { chatNs } = await import('../../index.js');
          if (chatNs) {
            chatNs.emit('chat:show_video', {
              type: 'direct',
              url,
              title: title || 'Video',
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Socket not available
        }

        return {
          content: [{
            type: 'text',
            text: `Playing video${title ? `: ${title}` : ''}.`
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WEB] Play video error: ${message}`);
        return {
          content: [{ type: 'text', text: `Failed to play video: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // open_in_browser - Launch URL in system browser on cluster node
  // -------------------------------------------------------------------------
  server.tool(
    'open_in_browser',
    'Open a URL in a web browser on a cluster node. Use this when a website cannot be embedded, or when the user specifically asks to open something in a real browser.',
    {
      url: z.string().url().describe('The URL to open'),
      node: z.string().optional().describe('Cluster node to open on (default: Home)'),
    },
    async ({ url, node = 'Home' }) => {
      try {
        const validation = validateUrlForFetch(url);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `Cannot open URL: ${validation.error}` }],
            isError: true,
          };
        }

        // Map node name to IP
        const nodeIps: Record<string, string> = {
          'Home': '192.168.1.50',
          'home': '192.168.1.50',
          'master': '192.168.1.50',
          'pve': '192.168.1.74',
          'agent1': '192.168.1.61',
          'agent': '192.168.1.62',
        };

        const nodeIp = nodeIps[node];
        if (!nodeIp) {
          return {
            content: [{ type: 'text', text: `Unknown node: ${node}. Available: Home, pve, agent1, agent` }],
            isError: true,
          };
        }

        console.log(`[WEB] Opening in browser on ${node}: ${url}`);

        // Use xdg-open to open in default browser
        const command = `DISPLAY=:0 xdg-open '${url.replace(/'/g, "'\\''")}'`;

        try {
          const { NodeSSH } = await import('node-ssh');
          const ssh = new NodeSSH();

          await ssh.connect({
            host: nodeIp,
            username: 'root',
            privateKey: config.sshKeyPath,
            readyTimeout: 10000,
          });

          const result = await ssh.execCommand(command, { cwd: '/' });
          ssh.dispose();

          if (result.code !== 0 && result.stderr) {
            console.log(`[WEB] xdg-open stderr: ${result.stderr}`);
          }

          return {
            content: [{
              type: 'text',
              text: `Opening ${url} in browser on ${node}.`
            }],
          };
        } catch (sshErr) {
          const sshMessage = sshErr instanceof Error ? sshErr.message : String(sshErr);
          console.error(`[WEB] SSH error: ${sshMessage}`);

          return {
            content: [{
              type: 'text',
              text: `Could not open browser on ${node}: ${sshMessage}. The node may not have a display connected.`
            }],
            isError: true,
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[WEB] Open browser error: ${message}`);
        return {
          content: [{ type: 'text', text: `Failed to open browser: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

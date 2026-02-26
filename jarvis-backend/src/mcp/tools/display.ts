/**
 * Physical display control MCP tool.
 *
 * Phase 37: Provides the control_display tool that lets the LLM control
 * physical kiosk displays. Two targets available:
 *   - "kiosk" = management VM camera display (192.168.1.65:8765)
 *   - "home"  = Home node eDP-1 screen (localhost:8766)
 *
 * Tools:
 *  - control_display: Show cameras, dashboards, or URLs on physical display
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPLAY_DAEMON_KIOSK = 'http://192.168.1.65:8765';
const DISPLAY_DAEMON_HOME = 'http://localhost:8766';

/** Camera name -> go2rtc stream viewer URL on agent1 */
const CAMERA_URLS: Record<string, string> = {
  front_door: 'http://192.168.1.61:1984/stream.html?src=front_door',
  side_house: 'http://192.168.1.61:1984/stream.html?src=side_house',
  birdseye: 'http://192.168.1.61:1984/stream.html?src=birdseye',
};

const AVAILABLE_CAMERAS = Object.keys(CAMERA_URLS).join(', ');

const DASHBOARD_URL = 'http://192.168.1.50:3004';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the display daemon URL based on target and action defaults. */
function resolveTarget(
  target: 'kiosk' | 'home' | undefined,
  action: string,
): string {
  if (target === 'home') return DISPLAY_DAEMON_HOME;
  if (target === 'kiosk') return DISPLAY_DAEMON_KIOSK;
  // Default routing when target not specified:
  // Camera/dashboard/URL commands default to kiosk (the camera display)
  // All actions default to kiosk for backward compatibility
  return DISPLAY_DAEMON_KIOSK;
}

/** Human-readable target name for logging. */
function targetName(url: string): string {
  if (url === DISPLAY_DAEMON_HOME) return 'home (eDP-1)';
  return 'kiosk (management VM)';
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerDisplayTools(server: McpServer): void {
  server.tool(
    'control_display',
    'Control physical kiosk displays. Two displays available: "kiosk" (management VM camera display at 192.168.1.65) and "home" (Home node eDP-1 screen). Show camera feeds, dashboards, or any URL. Use "home" target when user wants to see something on the local screen.',
    {
      action: z.enum(['show_url', 'show_camera', 'show_dashboard', 'restore'])
        .describe('What to show on the display'),
      url: z.string().optional()
        .describe('URL to display (required for show_url)'),
      camera: z.string().optional()
        .describe('Camera name for show_camera (e.g., "front_door", "side_house")'),
      target: z.enum(['kiosk', 'home']).optional()
        .describe('Which display to control. "kiosk" = management VM camera display (192.168.1.65), "home" = Home node eDP-1 screen. Defaults to "kiosk" for camera/URL commands.'),
    },
    async ({ action, url, camera, target }) => {
      const daemonUrl = resolveTarget(target, action);
      const displayName = targetName(daemonUrl);

      try {
        let endpoint: string;
        let payload: Record<string, string>;
        let description: string;

        switch (action) {
          case 'show_url': {
            if (!url) {
              return {
                content: [{ type: 'text', text: 'URL is required for show_url action' }],
                isError: true,
              };
            }
            endpoint = '/display/show';
            payload = { url };
            description = `Showing ${url} on ${displayName}`;
            break;
          }

          case 'show_camera': {
            const cameraName = camera?.toLowerCase() ?? '';
            const cameraUrl = CAMERA_URLS[cameraName];
            if (!cameraUrl) {
              return {
                content: [{
                  type: 'text',
                  text: `Unknown camera "${camera}". Available cameras: ${AVAILABLE_CAMERAS}`,
                }],
                isError: true,
              };
            }
            endpoint = '/display/show';
            payload = { url: cameraUrl };
            description = `Showing ${cameraName} camera feed on ${displayName}`;
            break;
          }

          case 'show_dashboard': {
            endpoint = '/display/show';
            payload = { url: DASHBOARD_URL };
            description = `Showing Jarvis dashboard on ${displayName}`;
            break;
          }

          case 'restore': {
            endpoint = '/display/restore';
            payload = {};
            description = `Restoring ${displayName} to default state`;
            break;
          }

          default: {
            return {
              content: [{ type: 'text', text: `Unknown action: ${action}` }],
              isError: true,
            };
          }
        }

        console.log(`[DISPLAY] ${description}`);

        const response = await fetch(`${daemonUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Display daemon returned ${response.status}: ${body}`);
        }

        console.log(`[DISPLAY] Success: ${description}`);

        return {
          content: [{ type: 'text', text: description }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[DISPLAY] Error: ${message}`);
        return {
          content: [{
            type: 'text',
            text: `Display control failed: ${message}. The display daemon may be unreachable at ${daemonUrl} (${displayName}).`,
          }],
          isError: true,
        };
      }
    },
  );
}

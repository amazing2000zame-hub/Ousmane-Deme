/**
 * Physical display control MCP tool.
 *
 * Phase 37: Provides the control_display tool that lets the LLM control
 * the physical kiosk display on the management VM (192.168.1.65).
 * Communicates with the Flask display daemon via HTTP POST.
 *
 * Tools:
 *  - control_display: Show cameras, dashboards, or URLs on physical display
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPLAY_DAEMON_URL = 'http://192.168.1.65:8765';

/** Camera name -> go2rtc stream viewer URL on agent1 */
const CAMERA_URLS: Record<string, string> = {
  front_door: 'http://192.168.1.61:1984/stream.html?src=front_door',
  side_house: 'http://192.168.1.61:1984/stream.html?src=side_house',
  birdseye: 'http://192.168.1.61:1984/stream.html?src=birdseye',
};

const AVAILABLE_CAMERAS = Object.keys(CAMERA_URLS).join(', ');

const DASHBOARD_URL = 'http://192.168.1.50:3004';

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerDisplayTools(server: McpServer): void {
  server.tool(
    'control_display',
    'Control the physical kiosk display. Show camera feeds, dashboards, or any URL on the management VM display. Use this when users ask to show something on the screen/display/TV, or want to see a camera feed, dashboard, or webpage on the physical display.',
    {
      action: z.enum(['show_url', 'show_camera', 'show_dashboard', 'restore'])
        .describe('What to show on the display'),
      url: z.string().optional()
        .describe('URL to display (required for show_url)'),
      camera: z.string().optional()
        .describe('Camera name for show_camera (e.g., "front_door", "side_house")'),
    },
    async ({ action, url, camera }) => {
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
            description = `Showing ${url} on display`;
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
            description = `Showing ${cameraName} camera feed on display`;
            break;
          }

          case 'show_dashboard': {
            endpoint = '/display/show';
            payload = { url: DASHBOARD_URL };
            description = 'Showing Jarvis dashboard on display';
            break;
          }

          case 'restore': {
            endpoint = '/display/restore';
            payload = {};
            description = 'Restoring camera feeds on display';
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

        const response = await fetch(`${DISPLAY_DAEMON_URL}${endpoint}`, {
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
            text: `Display control failed: ${message}. The display daemon may be unreachable at ${DISPLAY_DAEMON_URL}.`,
          }],
          isError: true,
        };
      }
    },
  );
}

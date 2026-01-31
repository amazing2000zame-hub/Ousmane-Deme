/**
 * 14 smart home control tools for presence detection, thermostat, locks, cameras, and face recognition.
 *
 * Safety tiers:
 *   GREEN: get_who_is_home, get_thermostat_status, get_lock_status,
 *          get_camera_snapshot, query_nvr_detections, scan_network_devices,
 *          whos_at_door, get_recognized_faces, get_unknown_visitors, show_live_feed,
 *          analyze_camera_snapshot
 *   YELLOW: set_thermostat
 *   RED: lock_door, unlock_door
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as ha from '../../clients/homeassistant.js';
import * as frigate from '../../clients/frigate.js';
import { execOnNodeByName } from '../../clients/ssh.js';
import { config } from '../../config.js';
import { getPresenceTracker } from '../../presence/tracker.js';
import { PresenceState } from '../../presence/types.js';

/**
 * Register all 12 smart home tools on the MCP server.
 */
export function registerSmartHomeTools(server: McpServer): void {

  // 1. get_who_is_home -- combined presence detection with state machine
  server.tool(
    'get_who_is_home',
    'Detect who is currently home using network presence, camera face recognition, and presence state tracking',
    {},
    async () => {
      try {
        const tracker = getPresenceTracker();

        // Run a fresh evaluation to ensure data is current
        await tracker.evaluatePresence();

        const states = tracker.getCurrentStates();

        const results: {
          people: Array<{
            name: string;
            state: string;
            since: string;
            lastNetworkSeen: string | null;
            lastCameraSeen: string | null;
          }>;
          summary: string;
        } = {
          people: [],
          summary: '',
        };

        for (const person of states) {
          results.people.push({
            name: person.name,
            state: person.state,
            since: person.stateChangedAt.toISOString(),
            lastNetworkSeen: person.lastNetworkSeen?.toISOString() ?? null,
            lastCameraSeen: person.lastCameraSeen?.toISOString() ?? null,
          });
        }

        // Build human-readable summary
        const home = states.filter(p =>
          p.state === PresenceState.HOME || p.state === PresenceState.JUST_ARRIVED
        );
        const away = states.filter(p =>
          p.state === PresenceState.AWAY ||
          p.state === PresenceState.EXTENDED_AWAY ||
          p.state === PresenceState.JUST_LEFT
        );

        if (home.length > 0) {
          const names = home.map(p => p.name);
          results.summary = `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} home`;
          if (away.length > 0) {
            results.summary += `. ${away.map(p => p.name).join(', ')} ${away.length === 1 ? 'is' : 'are'} away`;
          }
        } else if (away.length > 0) {
          results.summary = `No one is home. ${away.map(p => p.name).join(', ')} ${away.length === 1 ? 'is' : 'are'} away`;
        } else if (states.length > 0) {
          results.summary = `Presence status unknown for ${states.map(p => p.name).join(', ')}`;
        } else {
          results.summary = 'No people configured for presence tracking';
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 2. scan_network_devices -- raw network presence scan
  server.tool(
    'scan_network_devices',
    'Scan the network for all connected devices (phones, laptops, etc.)',
    {},
    async () => {
      try {
        const scanResult = await execOnNodeByName('Home', 'arp-scan -l --interface=vmbr0 2>/dev/null', 15000);
        const lines = scanResult.stdout.trim().split('\n').filter((l) => l.includes('\t'));

        const devices = lines.map((line) => {
          const parts = line.split('\t');
          return {
            ip: parts[0]?.trim() || 'unknown',
            mac: parts[1]?.trim() || 'unknown',
            vendor: parts[2]?.trim() || 'unknown',
          };
        });

        // Mark known devices
        const presenceDevices = config.presenceDevices || [];
        const knownMacs = new Set(presenceDevices.map((d: { mac: string }) => d.mac.toLowerCase()));

        const annotatedDevices = devices.map((d) => ({
          ...d,
          known: knownMacs.has(d.mac.toLowerCase()),
          owner: presenceDevices.find(
            (pd: { mac: string }) => pd.mac.toLowerCase() === d.mac.toLowerCase()
          )?.owner || null,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              totalDevices: annotatedDevices.length,
              knownDevices: annotatedDevices.filter((d) => d.known).length,
              devices: annotatedDevices,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 3. get_thermostat_status -- Ecobee thermostat status
  server.tool(
    'get_thermostat_status',
    'Get current thermostat status including temperature, humidity, and HVAC mode',
    {},
    async () => {
      try {
        const entityId = config.ecobeeEntityId;
        if (!entityId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: ECOBEE_ENTITY_ID not configured' }],
            isError: true,
          };
        }

        const status = await ha.getThermostatStatus(entityId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              currentTemperature: status.currentTemp,
              targetTemperature: status.targetTemp,
              hvacMode: status.hvacMode,
              hvacAction: status.hvacAction,
              humidity: status.humidity,
              unit: 'fahrenheit',
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 4. set_thermostat -- change temperature or mode (YELLOW tier)
  server.tool(
    'set_thermostat',
    'Set thermostat temperature or HVAC mode (heat, cool, auto, off)',
    {
      temperature: z.number().min(50).max(90).optional().describe('Target temperature in Fahrenheit (50-90)'),
      mode: z.enum(['heat', 'cool', 'heat_cool', 'off', 'auto']).optional().describe('HVAC mode to set'),
    },
    async ({ temperature, mode }) => {
      try {
        const entityId = config.ecobeeEntityId;
        if (!entityId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: ECOBEE_ENTITY_ID not configured' }],
            isError: true,
          };
        }

        if (!temperature && !mode) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Must specify temperature or mode (or both)' }],
            isError: true,
          };
        }

        // Apply changes
        if (mode) {
          await ha.setThermostatMode(entityId, mode);
        }
        if (temperature) {
          await ha.setThermostatTemp(entityId, temperature);
        }

        // Get updated state
        const status = await ha.getThermostatStatus(entityId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              message: `Thermostat updated${temperature ? ` to ${temperature}°F` : ''}${mode ? ` in ${mode} mode` : ''}`,
              currentState: {
                currentTemperature: status.currentTemp,
                targetTemperature: status.targetTemp,
                hvacMode: status.hvacMode,
                hvacAction: status.hvacAction,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 5. get_lock_status -- check all door locks
  server.tool(
    'get_lock_status',
    'Get the current status of all door locks (locked/unlocked)',
    {},
    async () => {
      try {
        const lockEntities = config.doorLockEntityIds || [];
        if (lockEntities.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Error: DOOR_LOCK_ENTITIES not configured' }],
            isError: true,
          };
        }

        const statuses = await Promise.all(
          lockEntities.map(async (entityId: string) => {
            try {
              const status = await ha.getLockStatus(entityId);
              return {
                entityId,
                name: status.friendlyName,
                state: status.state,
                lastChanged: status.lastChanged,
              };
            } catch (err) {
              return {
                entityId,
                name: entityId,
                state: 'error',
                error: err instanceof Error ? err.message : String(err),
              };
            }
          })
        );

        const allLocked = statuses.every((s) => s.state === 'locked');
        const summary = allLocked
          ? 'All doors are locked'
          : `Warning: ${statuses.filter((s) => s.state !== 'locked').map((s) => s.name).join(', ')} not locked`;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ summary, locks: statuses }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 6. lock_door -- lock a specific door (RED tier - requires confirmation)
  server.tool(
    'lock_door',
    'Lock a specific door (requires confirmation)',
    {
      lockName: z.string().describe('Door lock name or entity ID (e.g., "front_door", "lock.front_door")'),
    },
    async ({ lockName }) => {
      try {
        const entityId = lockName.startsWith('lock.') ? lockName : `lock.${lockName}`;

        await ha.lockDoor(entityId);

        // Verify the lock state
        const status = await ha.getLockStatus(entityId);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              lock: status.friendlyName,
              state: status.state,
              message: `${status.friendlyName} is now ${status.state}`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 7. unlock_door -- unlock a specific door (RED tier - requires confirmation)
  server.tool(
    'unlock_door',
    'Unlock a specific door (requires confirmation)',
    {
      lockName: z.string().describe('Door lock name or entity ID (e.g., "front_door", "lock.front_door")'),
    },
    async ({ lockName }) => {
      try {
        const entityId = lockName.startsWith('lock.') ? lockName : `lock.${lockName}`;

        await ha.unlockDoor(entityId);

        // Verify the lock state
        const status = await ha.getLockStatus(entityId);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              lock: status.friendlyName,
              state: status.state,
              message: `${status.friendlyName} is now ${status.state}`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 8. get_camera_snapshot -- get image from a camera
  server.tool(
    'get_camera_snapshot',
    'Get a snapshot image from a security camera',
    {
      camera: z.string().describe('Camera name (e.g., "driveway", "front_door", "backyard")'),
    },
    async ({ camera }) => {
      try {
        const snapshot = await frigate.getLatestSnapshot(camera);
        const base64 = snapshot.toString('base64');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              camera,
              imageSize: snapshot.length,
              timestamp: new Date().toISOString(),
              // Return truncated base64 for text display
              // Full image would be served via separate endpoint
              imagePreview: base64.slice(0, 200) + '...',
              note: 'Full image available via Frigate UI or API',
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 9. query_nvr_detections -- query AI object detections from Frigate
  server.tool(
    'query_nvr_detections',
    'Query recent AI object detections from security cameras (cars, people, packages, pets)',
    {
      camera: z.string().optional().describe('Filter by camera name'),
      objectType: z.enum(['person', 'car', 'package', 'dog', 'cat']).optional().describe('Filter by object type'),
      limit: z.number().min(1).max(50).optional().describe('Max number of results (default: 20)'),
      withinMinutes: z.number().min(1).max(1440).optional().describe('Only show detections within last N minutes'),
    },
    async ({ camera, objectType, limit, withinMinutes }) => {
      try {
        const options: Parameters<typeof frigate.getEvents>[0] = {
          limit: limit ?? 20,
          has_snapshot: true,
        };

        if (camera) options.camera = camera;
        if (objectType) options.label = objectType;
        if (withinMinutes) {
          options.after = Math.floor(Date.now() / 1000) - withinMinutes * 60;
        }

        const events = await frigate.getEvents(options);

        const formatted = events.map((e) => ({
          id: e.id,
          camera: e.camera,
          object: e.label,
          confidence: `${(e.score * 100).toFixed(1)}%`,
          time: new Date(e.start_time * 1000).toLocaleString(),
          duration: e.end_time ? `${Math.round(e.end_time - e.start_time)}s` : 'ongoing',
          hasClip: e.has_clip,
          hasSnapshot: e.has_snapshot,
        }));

        // Group by object type for summary
        const byCategoryCount: Record<string, number> = {};
        for (const e of events) {
          byCategoryCount[e.label] = (byCategoryCount[e.label] || 0) + 1;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              totalEvents: formatted.length,
              summary: byCategoryCount,
              events: formatted,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 10. whos_at_door -- check for recent person at entry cameras with face recognition
  server.tool(
    'whos_at_door',
    'Check who is at the door by querying recent person detections with face recognition at entry cameras (front_door)',
    {
      withinMinutes: z.number().min(1).max(60).optional()
        .describe('Look back N minutes (default: 5)'),
    },
    async ({ withinMinutes }) => {
      try {
        const lookbackMinutes = withinMinutes ?? 5;
        const after = Math.floor(Date.now() / 1000) - lookbackMinutes * 60;

        // Query person events at entry cameras (front_door)
        const events = await frigate.getEvents({
          camera: 'front_door',
          label: 'person',
          after,
          limit: 10,
          has_snapshot: true,
        });

        if (events.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                status: 'no_one',
                message: `No one detected at the door in the last ${lookbackMinutes} minutes`,
                events: [],
              }, null, 2),
            }],
          };
        }

        // Parse face recognition data
        const visitors = events.map((e) => {
          const face = frigate.parseFaceSubLabel(e.sub_label);
          return {
            time: new Date(e.start_time * 1000).toLocaleString(),
            recognized: face.name !== null,
            name: face.name ?? 'Unknown person',
            confidence: face.confidence ? `${(face.confidence * 100).toFixed(0)}%` : null,
            eventId: e.id,
            hasSnapshot: e.has_snapshot,
          };
        });

        // Build summary
        const recognized = visitors.filter(v => v.recognized);
        const unknown = visitors.filter(v => !v.recognized);

        let summary: string;
        if (recognized.length > 0) {
          const names = [...new Set(recognized.map(v => v.name))];
          summary = `${names.join(', ')} at the door`;
          if (unknown.length > 0) {
            summary += ` (plus ${unknown.length} unknown person${unknown.length > 1 ? 's' : ''})`;
          }
        } else {
          summary = `${unknown.length} unknown person${unknown.length > 1 ? 's' : ''} at the door`;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'detected',
              summary,
              visitors,
              lookbackMinutes,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 11. get_recognized_faces -- list all face events with recognized names
  server.tool(
    'get_recognized_faces',
    'Get recent events where a face was recognized (identified by name)',
    {
      camera: z.string().optional().describe('Filter by camera name'),
      name: z.string().optional().describe('Filter by person name'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default: 20)'),
      withinMinutes: z.number().min(1).max(1440).optional().describe('Look back N minutes (default: 60)'),
    },
    async ({ camera, name, limit, withinMinutes }) => {
      try {
        const lookbackMinutes = withinMinutes ?? 60;
        const after = Math.floor(Date.now() / 1000) - lookbackMinutes * 60;

        const events = await frigate.getEvents({
          camera,
          label: 'person',
          after,
          limit: limit ?? 20,
          has_snapshot: true,
        });

        // Filter to only events with face recognition
        const recognizedEvents = events
          .map((e) => {
            const face = frigate.parseFaceSubLabel(e.sub_label);
            return { event: e, face };
          })
          .filter((r) => r.face.name !== null)
          .filter((r) => !name || r.face.name?.toLowerCase() === name.toLowerCase());

        const formatted = recognizedEvents.map((r) => ({
          name: r.face.name,
          confidence: r.face.confidence ? `${(r.face.confidence * 100).toFixed(0)}%` : 'N/A',
          camera: r.event.camera,
          time: new Date(r.event.start_time * 1000).toLocaleString(),
          eventId: r.event.id,
          hasSnapshot: r.event.has_snapshot,
          hasClip: r.event.has_clip,
        }));

        // Group by name for summary
        const byName: Record<string, number> = {};
        for (const e of formatted) {
          byName[e.name!] = (byName[e.name!] || 0) + 1;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              totalRecognized: formatted.length,
              summary: byName,
              events: formatted,
              lookbackMinutes,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 12. get_unknown_visitors -- query person events without face recognition
  server.tool(
    'get_unknown_visitors',
    'Get recent person detections where no face was recognized (unknown visitors)',
    {
      camera: z.string().optional().describe('Filter by camera name'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default: 20)'),
      withinMinutes: z.number().min(1).max(1440).optional().describe('Look back N minutes (default: 60)'),
    },
    async ({ camera, limit, withinMinutes }) => {
      try {
        const lookbackMinutes = withinMinutes ?? 60;
        const after = Math.floor(Date.now() / 1000) - lookbackMinutes * 60;

        const events = await frigate.getEvents({
          camera,
          label: 'person',
          after,
          limit: limit ?? 20,
          has_snapshot: true,
        });

        // Filter to only events WITHOUT face recognition (sub_label is null)
        const unknownEvents = events.filter((e) => {
          const face = frigate.parseFaceSubLabel(e.sub_label);
          return face.name === null;
        });

        const formatted = unknownEvents.map((e) => ({
          camera: e.camera,
          time: new Date(e.start_time * 1000).toLocaleString(),
          duration: e.end_time ? `${Math.round(e.end_time - e.start_time)}s` : 'ongoing',
          confidence: `${(e.score * 100).toFixed(1)}%`,
          eventId: e.id,
          hasSnapshot: e.has_snapshot,
          hasClip: e.has_clip,
        }));

        // Group by camera for summary
        const byCamera: Record<string, number> = {};
        for (const e of formatted) {
          byCamera[e.camera] = (byCamera[e.camera] || 0) + 1;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              totalUnknown: formatted.length,
              summary: byCamera,
              events: formatted,
              lookbackMinutes,
              note: unknownEvents.length === 0
                ? 'No unknown visitors detected'
                : `${unknownEvents.length} person detection(s) without face recognition`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 13. show_live_feed -- open live camera stream in the dashboard
  server.tool(
    'show_live_feed',
    'Open a live camera feed in the dashboard UI. Use when user asks to see, view, or bring up a camera stream.',
    {
      camera: z.string().describe('Camera name (e.g., "front_door", "side_house")'),
    },
    async ({ camera }) => {
      try {
        // Validate camera exists (getCameras returns string[])
        const cameras = await frigate.getCameras();

        if (!cameras.includes(camera)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Camera "${camera}" not found. Available cameras: ${cameras.join(', ')}`,
            }],
            isError: true,
          };
        }

        // Lazy import to avoid circular dependency with index.ts
        const { eventsNs, chatNs } = await import('../../index.js');
        const timestamp = new Date().toISOString();

        // Emit to events namespace (for modal display in cam tab)
        eventsNs.emit('show_live_feed', { camera, timestamp });

        // Emit to chat namespace (for inline display in chat)
        chatNs.emit('chat:show_live_feed', { camera, timestamp });

        return {
          content: [{
            type: 'text' as const,
            text: `Opening ${camera} live feed in the dashboard.`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 14. close_live_feed -- close live camera stream in the dashboard
  server.tool(
    'close_live_feed',
    'Close/stop a live camera feed in the dashboard UI. Use when user asks to stop, close, or dismiss a camera stream.',
    {},
    async () => {
      try {
        const { eventsNs, chatNs } = await import('../../index.js');
        const timestamp = new Date().toISOString();

        // Emit close events to both namespaces
        eventsNs.emit('close_live_feed', { timestamp });
        chatNs.emit('chat:close_live_feed', { timestamp });

        return {
          content: [{
            type: 'text' as const,
            text: 'Live camera feed closed.',
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // 15. analyze_camera_snapshot -- use Claude Vision to analyze camera image
  server.tool(
    'analyze_camera_snapshot',
    'Analyze a camera snapshot using AI vision to identify and count objects (cars, people, packages). Use this when asked "how many cars in the driveway" or similar questions requiring visual analysis.',
    {
      camera: z.string().describe('Camera name (e.g., "side_house" for driveway, "front_door")'),
      question: z.string().optional().describe('Specific question to answer about the image (default: describe what you see)'),
    },
    async ({ camera, question }) => {
      try {
        // Lazy import to avoid circular dependency
        const { claudeClient, claudeAvailable } = await import('../../ai/claude.js');

        if (!claudeAvailable) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Claude API not configured for vision analysis' }],
            isError: true,
          };
        }

        // Fetch snapshot from Frigate
        const snapshot = await frigate.getLatestSnapshot(camera);
        const base64Image = snapshot.toString('base64');

        // Build the prompt
        const prompt = question
          ? question
          : 'Describe what you see in this security camera image. Count and identify any vehicles (including color, type, approximate size), people, and other notable objects.';

        // Call Claude Vision
        const response = await claudeClient.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: base64Image,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        });

        // Extract text response
        const textContent = response.content.find((c) => c.type === 'text');
        const analysis = textContent && 'text' in textContent ? textContent.text : 'No analysis available';

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              camera,
              timestamp: new Date().toISOString(),
              question: question || 'general analysis',
              analysis,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}

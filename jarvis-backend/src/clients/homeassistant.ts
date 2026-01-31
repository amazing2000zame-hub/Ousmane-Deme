/**
 * Home Assistant REST API client for smart home control.
 *
 * Connects to Home Assistant instance at http://192.168.1.54:8123
 * Uses long-lived access token for authentication.
 */

import { config } from '../config.js';

export interface HAState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

export interface HAServiceResponse {
  entity_id?: string;
  state?: string;
  attributes?: Record<string, unknown>;
}

const TIMEOUT_MS = 10_000;

/**
 * Build authorization headers for HA API requests.
 */
function getHeaders(): Record<string, string> {
  const token = config.homeAssistantToken;
  if (!token) {
    throw new Error('HOME_ASSISTANT_TOKEN not configured');
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * GET a Home Assistant API endpoint.
 */
export async function haGet<T>(path: string): Promise<T> {
  const url = `${config.homeAssistantUrl}/api${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`HA GET ${path} failed: ${res.status} ${res.statusText} -- ${body}`);
    }

    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`HA GET ${path} timed out after ${TIMEOUT_MS}ms`);
    }
    if (err instanceof Error && err.message.startsWith('HA')) {
      throw err;
    }
    throw new Error(
      `HA GET ${path} network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST to a Home Assistant API endpoint.
 */
export async function haPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${config.homeAssistantUrl}/api${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`HA POST ${path} failed: ${res.status} ${res.statusText} -- ${text}`);
    }

    const text = await res.text();
    if (!text) return [] as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`HA POST ${path} timed out after ${TIMEOUT_MS}ms`);
    }
    if (err instanceof Error && err.message.startsWith('HA')) {
      throw err;
    }
    throw new Error(
      `HA POST ${path} network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ Domain methods

/**
 * Get state of a specific entity.
 */
export async function getState(entityId: string): Promise<HAState> {
  return haGet<HAState>(`/states/${encodeURIComponent(entityId)}`);
}

/**
 * Get all states (all entities).
 */
export async function getAllStates(): Promise<HAState[]> {
  return haGet<HAState[]>('/states');
}

/**
 * Call a Home Assistant service.
 *
 * @param domain - Service domain (e.g., 'climate', 'lock', 'light')
 * @param service - Service name (e.g., 'turn_on', 'lock', 'set_temperature')
 * @param data - Service data including entity_id
 */
export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<HAServiceResponse[]> {
  return haPost<HAServiceResponse[]>(`/services/${domain}/${service}`, data);
}

/**
 * Get states of all entities matching a domain (e.g., 'climate', 'lock').
 */
export async function getEntitiesByDomain(domain: string): Promise<HAState[]> {
  const allStates = await getAllStates();
  return allStates.filter((s) => s.entity_id.startsWith(`${domain}.`));
}

// ------------------------------------------------------------------ Convenience methods

/**
 * Get thermostat status.
 */
export async function getThermostatStatus(entityId: string): Promise<{
  currentTemp: number | null;
  targetTemp: number | null;
  hvacMode: string;
  hvacAction: string | null;
  humidity: number | null;
}> {
  const state = await getState(entityId);
  return {
    currentTemp: state.attributes.current_temperature as number | null,
    targetTemp: state.attributes.temperature as number | null,
    hvacMode: state.state,
    hvacAction: (state.attributes.hvac_action as string) ?? null,
    humidity: (state.attributes.current_humidity as number) ?? null,
  };
}

/**
 * Set thermostat temperature.
 */
export async function setThermostatTemp(entityId: string, temperature: number): Promise<void> {
  await callService('climate', 'set_temperature', {
    entity_id: entityId,
    temperature,
  });
}

/**
 * Set thermostat HVAC mode.
 */
export async function setThermostatMode(
  entityId: string,
  mode: 'heat' | 'cool' | 'heat_cool' | 'off' | 'auto',
): Promise<void> {
  await callService('climate', 'set_hvac_mode', {
    entity_id: entityId,
    hvac_mode: mode,
  });
}

/**
 * Lock a door.
 */
export async function lockDoor(entityId: string): Promise<void> {
  await callService('lock', 'lock', { entity_id: entityId });
}

/**
 * Unlock a door.
 */
export async function unlockDoor(entityId: string): Promise<void> {
  await callService('lock', 'unlock', { entity_id: entityId });
}

/**
 * Get lock status.
 */
export async function getLockStatus(entityId: string): Promise<{
  state: 'locked' | 'unlocked' | 'unknown';
  friendlyName: string;
  lastChanged: string;
}> {
  const state = await getState(entityId);
  return {
    state: state.state as 'locked' | 'unlocked' | 'unknown',
    friendlyName: (state.attributes.friendly_name as string) ?? entityId,
    lastChanged: state.last_changed,
  };
}

/**
 * Check if Home Assistant is reachable.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await haGet<unknown>('/');
    return true;
  } catch {
    return false;
  }
}

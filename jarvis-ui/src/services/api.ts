const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://192.168.1.50:4000';

/** Generic authenticated API call with JSON handling */
export async function apiCall<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string>) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API error: ${res.status} ${res.statusText} - ${body}`);
  }

  return res.json() as Promise<T>;
}

/** Authenticate with the backend and return a JWT token */
export async function login(password: string): Promise<string> {
  const data = await apiCall<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  return data.token;
}

/** Execute an MCP tool via the backend REST API */
export async function executeToolApi(
  tool: string,
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const data = await apiCall<{ result: unknown }>('/api/tools/execute', {
    method: 'POST',
    body: JSON.stringify({ tool, args }),
  }, token);
  return data.result;
}

/* ── Monitor API ─────────────────────────────────────────────── */

import type { MonitorStatus } from '../types/events';

/** Get current monitor service status */
export async function getMonitorStatus(token: string): Promise<MonitorStatus> {
  return apiCall<MonitorStatus>('/api/monitor/status', {}, token);
}

/** Toggle the autonomous-action kill switch */
export async function toggleKillSwitch(
  active: boolean,
  token: string,
): Promise<{ killSwitch: boolean }> {
  return apiCall<{ killSwitch: boolean }>('/api/monitor/killswitch', {
    method: 'PUT',
    body: JSON.stringify({ active }),
  }, token);
}

/** Set the autonomy level (0-4) */
export async function setAutonomyLevel(
  level: number,
  token: string,
): Promise<{ autonomyLevel: number }> {
  return apiCall<{ autonomyLevel: number }>('/api/monitor/autonomy-level', {
    method: 'PUT',
    body: JSON.stringify({ level }),
  }, token);
}

/** Retrieve recent autonomous actions from the audit log */
export async function getMonitorActions(
  token: string,
  limit?: number,
): Promise<{ actions: unknown[] }> {
  const query = limit ? `?limit=${limit}` : '';
  return apiCall<{ actions: unknown[] }>(`/api/monitor/actions${query}`, {}, token);
}

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

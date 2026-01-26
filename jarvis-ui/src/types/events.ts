/** A JARVIS system event */
export interface JarvisEvent {
  id: string;
  type: 'alert' | 'action' | 'status' | 'metric';
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  node?: string;
  timestamp: string;     // ISO 8601
  resolvedAt?: string;   // ISO 8601
}

/** Result of an MCP tool execution */
export interface ToolExecution {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  tier: string;
  duration: number;      // ms
  success: boolean;
  timestamp: string;     // ISO 8601
}

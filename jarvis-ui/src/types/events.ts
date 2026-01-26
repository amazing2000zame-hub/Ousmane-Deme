/** A JARVIS system event */
export interface JarvisEvent {
  id: string;
  type: 'alert' | 'action' | 'status' | 'metric';
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  node?: string;
  source?: 'monitor' | 'user' | 'jarvis' | 'system';  // event origin for UI filtering
  timestamp: string;     // ISO 8601
  resolvedAt?: string;   // ISO 8601
}

/** Monitor service status for dashboard display */
export interface MonitorStatus {
  killSwitch: boolean;
  autonomyLevel: number;
  running: boolean;
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

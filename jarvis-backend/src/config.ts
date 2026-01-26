import 'dotenv/config';

export interface ClusterNode {
  name: string;
  host: string;
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Auth
  jwtSecret: process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return 'jarvis-dev-secret';
  })(),
  jarvisPassword: process.env.JARVIS_PASSWORD || 'jarvis',

  // Database
  dbPath: process.env.DB_PATH || './data/jarvis.db',

  // SSH
  sshKeyPath: process.env.SSH_KEY_PATH || '/app/.ssh/id_ed25519',

  // Proxmox API
  pveTokenId: process.env.PVE_TOKEN_ID || 'root@pam!jarvis',
  pveTokenSecret: process.env.PVE_TOKEN_SECRET || '',

  // Cluster nodes
  clusterNodes: [
    { name: 'Home', host: '192.168.1.50' },
    { name: 'pve', host: '192.168.1.74' },
    { name: 'agent1', host: '192.168.1.61' },
    { name: 'agent', host: '192.168.1.62' },
  ] as ClusterNode[],

  // Override passkey for elevated operations
  overrideKey: process.env.JARVIS_OVERRIDE_KEY || '',

  // Claude AI
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  claudeMaxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10),
  chatHistoryLimit: parseInt(process.env.CHAT_HISTORY_LIMIT || '20', 10),
  chatMaxLoopIterations: parseInt(process.env.CHAT_MAX_LOOP || '10', 10),

  // Local LLM fallback (OpenAI-compatible endpoint)
  localLlmEndpoint: process.env.LOCAL_LLM_ENDPOINT || 'http://192.168.1.50:8080',
  localLlmModel: process.env.LOCAL_LLM_MODEL || 'qwen2.5-7b-instruct-q4_k_m.gguf',
  qwenContextWindow: parseInt(process.env.QWEN_CONTEXT_WINDOW || '4096', 10),
  qwenHistoryLimit: parseInt(process.env.QWEN_HISTORY_LIMIT || '10', 10),

  // Cost tracking
  dailyCostLimit: parseFloat(process.env.DAILY_COST_LIMIT || '10.0'),

  // CORS
  corsOrigins: [
    'http://192.168.1.65:3004',
    'http://localhost:3004',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://192.168.1.50:5173',
    'http://192.168.1.50:5174',
  ] as string[],
} as const;

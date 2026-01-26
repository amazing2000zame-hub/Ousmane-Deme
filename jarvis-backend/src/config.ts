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

  // CORS
  corsOrigins: [
    'http://192.168.1.65:3004',
    'http://localhost:3004',
  ] as string[],
} as const;

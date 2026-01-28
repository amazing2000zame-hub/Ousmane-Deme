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
  qwenContextWindow: parseInt(process.env.QWEN_CONTEXT_WINDOW || '8192', 10),
  qwenHistoryLimit: parseInt(process.env.QWEN_HISTORY_LIMIT || '10', 10),

  // Cost tracking
  dailyCostLimit: parseFloat(process.env.DAILY_COST_LIMIT || '10.0'),

  // Memory TTL tiers
  memoryConversationTTLDays: parseInt(process.env.MEMORY_CONVERSATION_TTL_DAYS || '7', 10),
  memoryEpisodicTTLDays: parseInt(process.env.MEMORY_EPISODIC_TTL_DAYS || '30', 10),
  memoryCleanupIntervalMinutes: parseInt(process.env.MEMORY_CLEANUP_INTERVAL_MIN || '60', 10),
  memoryContextTokenBudget: parseInt(process.env.MEMORY_CONTEXT_BUDGET || '600', 10),

  // TTS — Local XTTS v2 (preferred, custom JARVIS voice clone)
  localTtsEndpoint: process.env.LOCAL_TTS_ENDPOINT || 'http://192.168.1.50:5050',

  // TTS -- Piper CPU fallback (fast, <200ms)
  piperTtsEndpoint: process.env.PIPER_TTS_ENDPOINT || 'http://jarvis-piper:5000',

  // Phase 23: Parallel TTS, disk cache, Opus encoding
  opusEnabled: process.env.OPUS_ENABLED === 'true',
  opusBitrate: parseInt(process.env.OPUS_BITRATE || '32', 10),
  ttsCacheDir: process.env.TTS_CACHE_DIR || '/data/tts-cache',
  ttsCacheMaxEntries: parseInt(process.env.TTS_CACHE_MAX || '500', 10),
  ttsMaxParallel: parseInt(process.env.TTS_MAX_PARALLEL || '2', 10),

  // TTS (Text-to-Speech) — OpenAI fallback
  ttsVoice: process.env.TTS_VOICE || 'onyx',
  ttsSpeed: parseFloat(process.env.TTS_SPEED || '1.0'),
  ttsModel: process.env.TTS_MODEL || 'tts-1',

  // Phase 24: Context management
  contextWindowTokens: parseInt(process.env.CONTEXT_WINDOW_TOKENS || '8192', 10),
  contextResponseReserve: parseInt(process.env.CONTEXT_RESPONSE_RESERVE || '1024', 10),
  contextSummarizeThreshold: parseInt(process.env.CONTEXT_SUMMARIZE_THRESHOLD || '25', 10),
  contextRecentRatio: parseFloat(process.env.CONTEXT_RECENT_RATIO || '0.7'),
  contextMaxSummaryTokens: parseInt(process.env.CONTEXT_MAX_SUMMARY_TOKENS || '500', 10),

  // ElevenLabs TTS (preferred when ELEVENLABS_API_KEY is set)
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9', // "Daniel" — deep British male
  elevenlabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  elevenlabsStability: parseFloat(process.env.ELEVENLABS_STABILITY || '0.5'),
  elevenlabsSimilarity: parseFloat(process.env.ELEVENLABS_SIMILARITY || '0.75'),
  elevenlabsStyle: parseFloat(process.env.ELEVENLABS_STYLE || '0.4'),

  // CORS
  corsOrigins: [
    'http://192.168.1.50:3004',
    'http://192.168.1.65:3004',
    'http://localhost:3004',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://192.168.1.50:5173',
    'http://192.168.1.50:5174',
  ] as string[],
} as const;

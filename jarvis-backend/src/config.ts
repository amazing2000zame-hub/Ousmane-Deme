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

  // API key for REST /api/chat endpoint (Telegram bot, external callers)
  jarvisApiKey: process.env.JARVIS_API_KEY || '',

  // Telegram integration
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  telegramPollingInterval: parseInt(process.env.TELEGRAM_POLLING_INTERVAL || '2000', 10),
  telegramListenerEnabled: process.env.TELEGRAM_LISTENER_ENABLED !== 'false', // default true

  // Keyword for ORANGE tier approval (dangerous operations)
  approvalKeyword: process.env.JARVIS_APPROVAL_KEYWORD || 'JARVIS-EXECUTE',

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
  localTtsEndpoint: process.env.LOCAL_TTS_ENDPOINT || 'http://jarvis-tts:5050',

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

  // Phase 25: Smart Home Integration

  // Home Assistant
  homeAssistantUrl: process.env.HOME_ASSISTANT_URL || 'http://192.168.1.54:8123',
  homeAssistantToken: process.env.HOME_ASSISTANT_TOKEN || '',

  // Frigate NVR
  frigateUrl: process.env.FRIGATE_URL || 'http://192.168.1.61:5000',

  // Phase 29: Proactive Alerts
  alertPollIntervalMs: parseInt(process.env.ALERT_POLL_INTERVAL_MS || '5000', 10),
  alertCooldownMs: parseInt(process.env.ALERT_COOLDOWN_MS || '300000', 10), // 5 minutes
  alertEntryCameras: (process.env.ALERT_ENTRY_CAMERAS || 'front_door').split(',').filter(Boolean),
  alertTtsEnabled: process.env.ALERT_TTS_ENABLED !== 'false', // default true

  // Phase 33: MQTT Real-Time Alerts
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://192.168.1.61:1883',
  mqttClientId: process.env.MQTT_CLIENT_ID || 'jarvis-backend',
  mqttTopicPrefix: process.env.MQTT_TOPIC_PREFIX || 'frigate',
  mqttEnabled: process.env.MQTT_ENABLED !== 'false', // default true

  // Entity IDs (adjust after HA integration setup)
  ecobeeEntityId: process.env.ECOBEE_ENTITY_ID || 'climate.ecobee',
  doorLockEntityIds: (process.env.DOOR_LOCK_ENTITIES || '').split(',').filter(Boolean),

  // Presence detection - known device MAC addresses
  // Format: [{"mac":"aa:bb:cc:dd:ee:ff","name":"User iPhone","owner":"User","ip":"192.168.1.x"}]
  presenceDevices: (() => {
    try {
      return JSON.parse(process.env.PRESENCE_DEVICES || '[]');
    } catch {
      return [];
    }
  })() as Array<{ mac: string; name: string; owner: string; ip?: string }>,

  // Phase 32: Web Browsing
  searxngUrl: process.env.SEARXNG_URL || 'http://jarvis-searxng:8080',

  // Phase 33: Server-Side Voice I/O
  whisperEndpoint: process.env.WHISPER_ENDPOINT || 'http://jarvis-whisper:5051',
  voiceSilenceThresholdMs: parseInt(process.env.VOICE_SILENCE_THRESHOLD_MS || '1500', 10),
  voiceMaxRecordingMs: parseInt(process.env.VOICE_MAX_RECORDING_MS || '30000', 10),

  // Phase 40+: Reminder snooze / timezone
  timezone: process.env.TIMEZONE || 'America/New_York',
  reminderSnoozeIntervalMs: parseInt(process.env.REMINDER_SNOOZE_INTERVAL_MS || '900000', 10),   // 15 min
  reminderEscalatedIntervalMs: parseInt(process.env.REMINDER_ESCALATED_INTERVAL_MS || '1800000', 10), // 30 min

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

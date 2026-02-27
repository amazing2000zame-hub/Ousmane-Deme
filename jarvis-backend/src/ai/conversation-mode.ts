/**
 * Conversation mode detector.
 *
 * Classifies incoming messages as casual, work, or info based on content
 * analysis and recent conversation history. Used to adapt Jarvis's tone
 * and response style dynamically.
 */

export type ConversationMode = 'casual' | 'work' | 'info';

// Casual indicators: greetings, personal, slang, short informal messages
const CASUAL_PATTERNS = [
  /^(hey|hi|hello|yo|sup|hiya|heya|what'?s\s*up|wassup|howdy)\b/i,
  /^(good\s*(morning|afternoon|evening|night))\b/i,
  /^(how\s*(are|r)\s*you|how('?s\s*it\s*going|'?s\s*everything))/i,
  /^(what\s*do\s*you\s*think|what('?s)?\s*your\s*opinion)/i,
  /^(thanks|thank\s*you|thx|ty|cheers)\b/i,
  /^(lol|lmao|haha|heh|nice|cool|awesome|neat)\b/i,
  /^(gn|gm|brb|ttyl|bye|later|cya|see\s*ya)\b/i,
  // Fun / personal requests (from real user messages)
  /\btell\s*me\s*(a\s*)?(story|joke|fun\s*fact)/i,
  /\b(who\s*(made|created|built)\s*you|what('?s)?\s*my\s*name|what\s*do\s*you\s*know\s*about\s*me)\b/i,
  /\bfun\s*facts?\s*(about|on)\b/i,
  /\b(i\s*was\s*just|i('?m)?\s*(bored|tired|hungry|vibing|chilling))\b/i,
  /^(thank\s*you|good\s*night|good\s*morning)\s*[.!]*$/i,
];

// Work indicators: technical terms, cluster references, commands, projects
const WORK_PATTERNS = [
  // Programming / DevOps terms
  /\b(function|class|error|bug|fix|deploy|build|compile|refactor|debug|lint)\b/i,
  /\b(docker|git|npm|yarn|bun|pip|cargo|systemctl|journalctl|nginx)\b/i,
  /\b(config|configuration|env|environment|variable|endpoint|route|middleware)\b/i,
  /\b(server|database|db|api|rest|graphql|webhook|socket|port)\b/i,
  /\b(ssh|curl|wget|apt|dnf|pacman|make|cmake)\b/i,
  // Cluster nodes
  /\b(pve|agent1|agent\b|home\s*node|proxmox)\b/i,
  // File paths and extensions
  /\b[\w-]+\.(ts|js|py|json|yml|yaml|toml|conf|cfg|service|sh)\b/i,
  /\/(root|opt|etc|var|home|usr|tmp)\//i,
  // Project names
  /\b(jarvis|comfyui|frigate|scrypted|adguard|twingate)\b/i,
  // VM/CT references
  /\b(vm|vmid|ct|lxc|qemu|container)\s*\d+/i,
  // Infrastructure
  /\b(cluster|node|storage|lvm|zfs|nfs|samba|ceph|corosync)\b/i,
];

// Info indicators: knowledge-seeking questions
const INFO_PATTERNS = [
  /^(what\s*(is|are|was|were|does|do)\s)/i,
  /^(how\s*(does|do|did|can|could|would|should)\s)/i,
  /^(explain|describe|tell\s*me\s*about|define)\b/i,
  /^(what('?s)?\s*the\s*difference\s*(between|of))/i,
  /^(why\s*(does|do|did|is|are|can|would|should)\s)/i,
  /^(can\s*you\s*(explain|describe|tell))/i,
  /^(is\s*(it|there|this|that)\s)/i,
];

// Technical terms that disqualify a short message from being "casual"
const TECHNICAL_TERMS = /\b(api|ssh|vm|ct|node|docker|git|npm|config|server|port|error|bug|deploy|log|dns|ip|cpu|ram|disk)\b/i;

/**
 * Detect the conversation mode from a message and optional recent history.
 *
 * Detection priority:
 *  1. Info patterns (explicit knowledge questions)
 *  2. Work patterns (technical content)
 *  3. Casual patterns (greetings, personal, short informal)
 *  4. History-based consistency (stay in recent mode if ambiguous)
 *  5. Default to casual for short, non-technical messages; work otherwise
 */
export function detectConversationMode(
  message: string,
  recentHistory?: Array<{ role: string; content: string; mode?: ConversationMode }>,
): ConversationMode {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // Info mode: explicit knowledge-seeking questions
  for (const pattern of INFO_PATTERNS) {
    if (pattern.test(lower)) {
      // But if it also has heavy work terms, treat as work
      let workHits = 0;
      for (const wp of WORK_PATTERNS) {
        if (wp.test(lower)) workHits++;
      }
      if (workHits >= 2) return 'work';
      return 'info';
    }
  }

  // Work mode: technical content
  let workScore = 0;
  for (const pattern of WORK_PATTERNS) {
    if (pattern.test(lower)) workScore++;
  }
  if (workScore >= 1) return 'work';

  // Casual mode: greetings, personal chat, slang
  for (const pattern of CASUAL_PATTERNS) {
    if (pattern.test(lower)) return 'casual';
  }

  // Short messages without technical terms → casual
  if (trimmed.length < 20 && !TECHNICAL_TERMS.test(lower)) {
    return 'casual';
  }

  // Emoji-heavy messages → casual (3+ emoji-like sequences)
  const emojiCount = (trimmed.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;
  if (emojiCount >= 3) return 'casual';

  // History-based consistency: if last 2 messages were in the same mode and current is ambiguous, stay
  if (recentHistory && recentHistory.length >= 2) {
    const recentModes = recentHistory
      .filter((m) => m.mode)
      .slice(-2)
      .map((m) => m.mode);
    if (recentModes.length === 2 && recentModes[0] === recentModes[1]) {
      return recentModes[0]!;
    }
  }

  // Default: casual for short messages, work for longer ones
  return trimmed.length < 40 ? 'casual' : 'work';
}

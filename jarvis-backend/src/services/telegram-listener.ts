/**
 * Telegram polling listener service.
 *
 * Polls the Telegram Bot API `getUpdates` endpoint to receive incoming
 * messages, forwards them through the chat pipeline, and sends the AI
 * response back to the user via Telegram.
 *
 * Supports bot commands: /start, /help, /reminders, /done
 */

import { config } from '../config.js';
import { processChat } from '../ai/chat-pipeline.js';
import { sendTelegramMessage } from '../mcp/tools/telegram.js';
import { dismissReminderByKeyword } from './reminders.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface GetUpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let offset = 0;
let running = false;

// Track which messages are currently being processed to avoid double-handling
const processing = new Set<number>();

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

async function getUpdates(): Promise<TelegramUpdate[]> {
  const token = config.telegramBotToken;
  if (!token) return [];

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates`;
    const body: Record<string, unknown> = {
      offset,
      timeout: 1, // short poll (we manage our own interval)
      allowed_updates: ['message'],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json()) as GetUpdatesResponse;
    if (!data.ok) {
      console.error(`[TelegramListener] getUpdates error: ${data.description}`);
      return [];
    }

    return data.result || [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[TelegramListener] getUpdates fetch failed: ${msg}`);
    return [];
  }
}

async function sendChatAction(chatId: number | string, action: string): Promise<void> {
  const token = config.telegramBotToken;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // non-critical
  }
}

// ---------------------------------------------------------------------------
// Bot command handlers
// ---------------------------------------------------------------------------

const HELP_TEXT = [
  '🤖 *Jarvis Telegram Bot*',
  '',
  'Send me any message and I\'ll respond using the full Jarvis AI pipeline (with cluster tools, home automation, etc.).',
  '',
  '*Commands:*',
  '/start — Welcome message',
  '/help — Show this help',
  '/reminders — List your active reminders',
  '/done — Dismiss your most recent reminder',
  '',
  'Examples:',
  '• "What\'s the cluster status?"',
  '• "Set a reminder in 30 minutes to check the oven"',
  '• "Turn off the living room lights"',
].join('\n');

async function handleCommand(
  command: string,
  chatId: number,
  _args: string,
): Promise<string | null> {
  switch (command) {
    case '/start':
      return 'Hello! I\'m Jarvis, your homelab AI assistant. Send me any message to get started.\n\nType /help to see what I can do.';

    case '/help':
      return HELP_TEXT;

    case '/reminders':
      // Forward to chat pipeline so the AI can use the list_reminders tool
      return null; // null = process through chat pipeline

    case '/done':
      // Forward to chat pipeline so the AI can use dismiss_reminder tool
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Message processing
// ---------------------------------------------------------------------------

async function handleMessage(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const text = msg.text.trim();
  const userName = msg.from?.first_name || 'User';

  // Skip if already processing
  if (processing.has(messageId)) return;
  processing.add(messageId);

  console.log(`[TelegramListener] Message from ${userName} (chat ${chatId}): "${text.substring(0, 80)}"`);

  try {
    // Check for bot commands
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.split(/\s+/);
      const command = cmd.toLowerCase().replace(/@\w+$/, ''); // strip @botname suffix
      const args = rest.join(' ');

      const directReply = await handleCommand(command, chatId, args);
      if (directReply !== null) {
        await sendTelegramMessage(directReply, chatId, 'Markdown');
        return;
      }
      // null means fall through to chat pipeline
    }

    // Check for reminder dismiss keywords before sending to AI pipeline
    const dismissResult = dismissReminderByKeyword(text);
    if (dismissResult.ok) {
      await sendTelegramMessage(dismissResult.message, chatId);
      return;
    }

    // Send typing indicator
    await sendChatAction(chatId, 'typing');

    // Build a message to forward through the chat pipeline
    // For /reminders and /done, wrap in natural language
    let pipelineMessage = text;
    if (text.toLowerCase() === '/reminders') {
      pipelineMessage = 'List my active reminders';
    } else if (text.toLowerCase().startsWith('/done')) {
      pipelineMessage = 'Dismiss my most recent reminder';
    }

    // Use persistent session per chat (not per-message) so conversation history works
    const sessionId = `telegram_${chatId}`;

    // Send a progress update if the AI takes more than 8 seconds
    const progressTimer = setTimeout(async () => {
      try {
        await sendChatAction(chatId, 'typing');
        await sendTelegramMessage('Still working on it — running some checks...', chatId);
      } catch { /* best effort */ }
    }, 8_000);

    let result;
    try {
      result = await processChat({
        message: pipelineMessage,
        sessionId,
        source: 'telegram',
      });
    } finally {
      clearTimeout(progressTimer);
    }

    // Send the response back to Telegram
    const response = result.response || 'I processed your request but have no text response.';

    // Telegram has a 4096 character limit per message; split if needed
    const chunks = splitMessage(response, 4000);
    for (const chunk of chunks) {
      await sendTelegramMessage(chunk, chatId);
    }

    console.log(`[TelegramListener] Replied to ${userName} (provider: ${result.provider}, tools: ${result.toolsUsed.join(', ') || 'none'})`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[TelegramListener] Error processing message from ${userName}: ${errMsg}`);

    // Send error feedback to user
    await sendTelegramMessage(
      'Sorry, I hit an error processing your message. Please try again.',
      chatId,
    );
  } finally {
    processing.delete(messageId);
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.5) {
      // No good newline, split at space
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      // No good split point, force split
      splitIdx = maxLen;
    }
    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function poll(): Promise<void> {
  if (!running) return;

  try {
    const updates = await getUpdates();

    for (const update of updates) {
      // Advance offset past this update (even if processing fails)
      offset = update.update_id + 1;

      // Process in background (don't block the poll loop)
      handleMessage(update).catch((err) => {
        console.error(`[TelegramListener] Unhandled error in handleMessage:`, err);
      });
    }
  } catch (err) {
    console.error(`[TelegramListener] Poll error:`, err);
  }

  // Schedule next poll
  if (running) {
    pollTimer = setTimeout(poll, config.telegramPollingInterval);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startTelegramListener(): void {
  if (!config.telegramListenerEnabled) {
    console.log('[TelegramListener] Disabled via TELEGRAM_LISTENER_ENABLED=false');
    return;
  }

  if (!config.telegramBotToken) {
    console.log('[TelegramListener] No TELEGRAM_BOT_TOKEN configured, skipping');
    return;
  }

  if (running) {
    console.log('[TelegramListener] Already running');
    return;
  }

  running = true;
  offset = 0;
  console.log(`[TelegramListener] Starting (poll interval: ${config.telegramPollingInterval}ms)`);

  // Start first poll
  poll();
}

export function stopTelegramListener(): void {
  if (!running) return;
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[TelegramListener] Stopped');
}

/**
 * Telegram messaging MCP tool.
 *
 * Phase 39: Provides the send_telegram_message tool that lets the LLM
 * send messages to the operator via Telegram. Used for:
 *  - "Send me a message on Telegram with the cluster status"
 *  - "Text me when the backup finishes"
 *  - Reminder delivery (Phase 40)
 *
 * Uses the Telegram Bot API directly (no dependencies).
 *
 * Tools:
 *  - send_telegram_message: Send a text message via Telegram
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../../config.js';
import type { ConversationMode } from '../../ai/conversation-mode.js';

// ---------------------------------------------------------------------------
// Telegram Bot API helper
// ---------------------------------------------------------------------------

/**
 * Send a message via Telegram Bot API.
 * Exported so reminder scheduler and other services can reuse it.
 */
export async function sendTelegramMessage(
  text: string,
  chatId?: string | number,
  parseMode: 'HTML' | 'Markdown' | '' = '',
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const token = config.telegramBotToken;
  if (!token) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  const targetChatId = chatId || config.telegramChatId;
  if (!targetChatId) {
    return { ok: false, error: 'No chat ID provided and TELEGRAM_CHAT_ID not configured' };
  }

  try {
    const body: Record<string, unknown> = {
      chat_id: targetChatId,
      text,
    };
    if (parseMode) {
      body.parse_mode = parseMode;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };

    if (!result.ok) {
      return { ok: false, error: result.description || 'Telegram API error' };
    }

    return { ok: true, messageId: result.result?.message_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Telegram] Send failed: ${message}`);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Telegram message formatting by conversation mode
// ---------------------------------------------------------------------------

/**
 * Format a message for Telegram based on the current conversation mode.
 *
 * - casual: strip all markdown, plain text only
 * - work: convert markdown to Telegram HTML (bold, code blocks, links)
 * - info: light formatting, mostly plain text with occasional bold
 */
export function formatForTelegram(
  text: string,
  mode: ConversationMode = 'work',
): { text: string; parseMode: 'HTML' | '' } {
  if (mode === 'casual') {
    // Strip all markdown formatting
    const plain = text
      .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, '').trim())
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '- ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    return { text: plain, parseMode: '' };
  }

  if (mode === 'work') {
    // Convert markdown to Telegram HTML
    let html = text
      // Code blocks: ```lang\ncode\n``` → <pre>code</pre>
      .replace(/```\w*\n([\s\S]*?)```/g, '<pre>$1</pre>')
      // Inline code: `code` → <code>code</code>
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold: **text** → <b>text</b>
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      // Italic: *text* → <i>text</i>
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>')
      // Links: [text](url) → <a href="url">text</a>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Headers: strip # prefix, bold the text
      .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
    return { text: html, parseMode: 'HTML' };
  }

  // info mode: light formatting — just bold for emphasis
  const light = text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return { text: light, parseMode: '' };
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerTelegramTools(server: McpServer): void {
  server.tool(
    'send_telegram_message',
    'Send a text message to the operator via Telegram. Use when asked to "text me", "send me a message on Telegram", or when delivering reminders/notifications.',
    {
      message: z.string().describe('The message text to send'),
      chatId: z.string().optional().describe('Telegram chat ID (defaults to operator chat)'),
    },
    async ({ message, chatId }) => {
      console.log(`[Telegram] Sending message: "${message.substring(0, 80)}..."`);

      const result = await sendTelegramMessage(message, chatId);

      if (!result.ok) {
        return {
          content: [{
            type: 'text',
            text: `Failed to send Telegram message: ${result.error}`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Message sent to Telegram successfully (message ID: ${result.messageId})`,
        }],
      };
    },
  );
}

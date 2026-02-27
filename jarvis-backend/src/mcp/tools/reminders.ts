/**
 * Cross-platform reminder MCP tools (Phase 40+).
 *
 * Tools:
 *  - set_reminder: Create a reminder with natural time parsing
 *  - list_reminders: Show pending/snoozed/all reminders
 *  - cancel_reminder: Cancel a pending/snoozed reminder by ID
 *  - dismiss_reminder: Dismiss (acknowledge) a nagging reminder
 *  - dismiss_all_reminders: Dismiss all active reminders at once
 *
 * Reminders are stored in SQLite and delivered via Telegram by the scheduler.
 * After initial delivery, reminders enter snooze mode and nag every 15-30 min
 * until dismissed or expired.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createReminder,
  listReminders,
  cancelReminder,
  dismissReminder,
  dismissAllReminders,
  parseNaturalTime,
} from '../../services/reminders.js';

export function registerReminderTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // set_reminder
  // -----------------------------------------------------------------------
  server.tool(
    'set_reminder',
    'Set a reminder that will nag via Telegram until dismissed. Accepts natural time: "in 30 minutes", "at 3pm", "tomorrow at 9am", "tonight", "next Monday at 3pm", "in 2 weeks".',
    {
      task: z.string().describe('What to remind about'),
      fire_at: z.string().describe('When to fire: natural time ("in 30 minutes", "at 3pm", "tomorrow at 9am", "next Monday") or Unix timestamp in ms'),
      source: z.string().optional().describe('Source interface (voice, web, telegram, api)'),
    },
    async ({ task, fire_at, source }) => {
      const fireAtMs = parseNaturalTime(fire_at);

      if (!fireAtMs) {
        return {
          content: [{
            type: 'text',
            text: `Could not parse time "${fire_at}". Try "in 30 minutes", "at 3pm", "tomorrow at 9am", "next Monday", or "tonight".`,
          }],
          isError: true,
        };
      }

      // Ensure fire time is in the future
      if (fireAtMs <= Date.now()) {
        return {
          content: [{
            type: 'text',
            text: `The specified time is in the past. Please provide a future time.`,
          }],
          isError: true,
        };
      }

      const reminder = createReminder(task, fireAtMs, source || 'api');

      const fireDate = new Date(fireAtMs);
      const timeStr = fireDate.toLocaleString('en-US', {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      return {
        content: [{
          type: 'text',
          text: `Reminder set: "${task}" at ${timeStr} (ID: ${reminder.id}). Will nag until you reply "done".`,
        }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // list_reminders
  // -----------------------------------------------------------------------
  server.tool(
    'list_reminders',
    'List reminders. Shows pending and snoozed reminders by default.',
    {
      status: z.string().optional().describe('Filter by status: "pending", "snoozed", "fired", "cancelled", "expired", or omit for all active'),
    },
    async ({ status }) => {
      const items = listReminders(status);

      if (items.length === 0) {
        return {
          content: [{
            type: 'text',
            text: status
              ? `No ${status} reminders found.`
              : 'No active reminders found.',
          }],
        };
      }

      const lines = items.map(r => {
        const fireDate = new Date(r.fireAt);
        const timeStr = fireDate.toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const statusEmoji = r.status === 'pending' ? '⏳'
          : r.status === 'snoozed' ? '🔔'
          : r.status === 'fired' ? '✅'
          : r.status === 'expired' ? '💤'
          : '❌';
        const snoozeInfo = r.status === 'snoozed' ? ` [nagged ${r.snoozeCount}x]` : '';
        return `${statusEmoji} [${r.id}] "${r.task}" — ${timeStr} (via ${r.source})${snoozeInfo}`;
      });

      return {
        content: [{
          type: 'text',
          text: `Reminders (${items.length}):\n${lines.join('\n')}`,
        }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // cancel_reminder
  // -----------------------------------------------------------------------
  server.tool(
    'cancel_reminder',
    'Cancel a pending or snoozed reminder by its ID.',
    {
      id: z.string().describe('Reminder ID to cancel'),
    },
    async ({ id }) => {
      const success = cancelReminder(id);

      if (!success) {
        return {
          content: [{
            type: 'text',
            text: `Reminder "${id}" not found or already fired/cancelled.`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Reminder ${id} cancelled.`,
        }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // dismiss_reminder
  // -----------------------------------------------------------------------
  server.tool(
    'dismiss_reminder',
    'Dismiss (acknowledge) a nagging reminder. Stops it from repeating. Use "latest" to dismiss the most recent one.',
    {
      id: z.string().describe('Reminder ID to dismiss, or "latest" for the most recent snoozed reminder'),
    },
    async ({ id }) => {
      const result = dismissReminder(id);

      if (!result.ok) {
        return {
          content: [{
            type: 'text',
            text: result.error || 'Could not dismiss reminder.',
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Dismissed reminder: "${result.reminder!.task}" (ID: ${result.reminder!.id})`,
        }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // dismiss_all_reminders
  // -----------------------------------------------------------------------
  server.tool(
    'dismiss_all_reminders',
    'Dismiss all active (pending and snoozed) reminders at once. Stops all nagging.',
    {},
    async () => {
      const count = dismissAllReminders();

      if (count === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No active reminders to dismiss.',
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Dismissed ${count} reminder${count === 1 ? '' : 's'}.`,
        }],
      };
    },
  );
}

/**
 * Cross-platform reminder service (Phase 40+).
 *
 * Features:
 *  - Natural time parsing ("in 30 minutes", "at 3pm", "tomorrow at 9am",
 *    "next Monday at 3pm", "in 2 weeks")
 *  - Timezone-aware scheduling (configurable via TIMEZONE)
 *  - SQLite storage with pending/fired/cancelled/snoozed/expired states
 *  - Persistent nagging: reminders repeat every 15 min (escalating to 30 min)
 *    until dismissed or expired (max 20 snoozes ≈ 6+ hours)
 *  - Scheduler polls every 30s and delivers via Telegram
 *  - Handles backend restart gaps (delivers reminders up to 30 min late)
 *
 * Used by:
 *  - set_reminder MCP tool (voice, web UI, Telegram, API)
 *  - dismiss_reminder / dismiss_all_reminders MCP tools
 *  - Telegram listener (keyword dismiss via dismissReminderByKeyword)
 *  - Scheduler service (auto-delivery + snooze loop)
 */

import crypto from 'node:crypto';
import { sqlite } from '../db/index.js';
import { config } from '../config.js';
import { sendTelegramMessage } from '../mcp/tools/telegram.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Reminder {
  id: string;
  task: string;
  fireAt: number;      // Unix timestamp ms (column: fire_at)
  createdAt: number;
  source: string;
  delivery: string;
  chatId: string | null;
  status: string;       // 'pending' | 'fired' | 'cancelled' | 'snoozed' | 'expired'
  firedAt: number | null;
  snoozeCount: number;
  nextSnoozeAt: number | null;
}

// Map DB snake_case rows → camelCase Reminder objects
function mapRow(row: any): Reminder {
  return {
    id: row.id,
    task: row.task,
    fireAt: row.fire_at,
    createdAt: row.created_at,
    source: row.source,
    delivery: row.delivery,
    chatId: row.chat_id,
    status: row.status,
    firedAt: row.fired_at,
    snoozeCount: row.snooze_count ?? 0,
    nextSnoozeAt: row.next_snooze_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Raw SQL helpers (avoids better-sqlite3 prepared statement type issues)
// ---------------------------------------------------------------------------

function dbRun(sql: string, ...params: unknown[]) {
  return sqlite.prepare(sql).run(...params as any[]);
}

function dbAll(sql: string, ...params: unknown[]): any[] {
  return sqlite.prepare(sql).all(...params as any[]);
}

function dbGet(sql: string, ...params: unknown[]): any {
  return sqlite.prepare(sql).get(...params as any[]);
}

// ---------------------------------------------------------------------------
// Timezone helper
// ---------------------------------------------------------------------------

/** Create a Date object representing "now" in the configured timezone. */
function nowInTz(): Date {
  // We build a date by reading the wall-clock components in the target tz.
  const tz = config.timezone || 'America/New_York';
  const str = new Date().toLocaleString('en-US', { timeZone: tz });
  return new Date(str);
}

/** Build a target Date for a specific wall-clock time in the configured tz. */
function dateInTz(year: number, month: number, day: number, hours: number, minutes: number): Date {
  // Build an ISO-like string and resolve via the tz offset
  const tz = config.timezone || 'America/New_York';
  // Create a rough date to determine offset
  const rough = new Date(year, month, day, hours, minutes, 0, 0);
  // Get what the clock reads in target tz for this rough UTC-ish date
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(rough);

  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
  const tzHours = get('hour');
  const roughHours = rough.getHours();
  // offset = rough local hours - tz hours (approximate)
  const offsetMs = (roughHours - tzHours) * 3_600_000;

  // Build the target: we want wall-clock `hours:minutes` in tz
  const target = new Date(year, month, day, hours, minutes, 0, 0);
  // Adjust by the difference: target is in local (server) tz, shift to configured tz
  return new Date(target.getTime() + offsetMs);
}

// ---------------------------------------------------------------------------
// Natural time parsing
// ---------------------------------------------------------------------------

/**
 * Parse a natural time expression into a Unix timestamp (ms).
 *
 * Supports:
 *  - "in X minutes/hours/seconds/days/weeks"
 *  - "at Xpm/am", "at X:XX pm/am"
 *  - "tomorrow", "tomorrow at Xpm"
 *  - "tonight" (default 8pm)
 *  - "next Monday", "next Tuesday at 3pm"
 *  - ISO date strings
 *  - Unix timestamp in ms
 *
 * All "at Xpm" style times are interpreted in the configured timezone.
 */
export function parseNaturalTime(input: string): number | null {
  const now = Date.now();
  const text = input.toLowerCase().trim();

  // "in X minutes/hours/seconds/days/weeks"
  const relativeMatch = text.match(/in\s+(\d+)\s*(second|sec|minute|min|hour|hr|day|week)s?/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    let ms = 0;
    if (unit.startsWith('sec')) ms = amount * 1000;
    else if (unit.startsWith('min')) ms = amount * 60_000;
    else if (unit.startsWith('hour') || unit.startsWith('hr')) ms = amount * 3_600_000;
    else if (unit.startsWith('day')) ms = amount * 86_400_000;
    else if (unit.startsWith('week')) ms = amount * 7 * 86_400_000;
    return now + ms;
  }

  // "next Monday", "next Tuesday at 3pm", etc.
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const nextDayMatch = text.match(/next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (nextDayMatch) {
    const targetDayName = nextDayMatch[1].toLowerCase();
    const targetDayIdx = dayNames.indexOf(targetDayName);
    let hours = nextDayMatch[2] ? parseInt(nextDayMatch[2], 10) : 9; // default 9am
    const minutes = nextDayMatch[3] ? parseInt(nextDayMatch[3], 10) : 0;
    const ampm = nextDayMatch[4]?.toLowerCase();

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    const current = nowInTz();
    const currentDay = current.getDay();
    let daysUntil = targetDayIdx - currentDay;
    if (daysUntil <= 0) daysUntil += 7; // always next week

    const target = new Date(current);
    target.setDate(target.getDate() + daysUntil);

    const result = dateInTz(target.getFullYear(), target.getMonth(), target.getDate(), hours, minutes);
    return result.getTime();
  }

  // "at X:XX pm/am" or "at Xpm/am" (with optional "tomorrow" prefix)
  const atTimeMatch = text.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (atTimeMatch) {
    let hours = parseInt(atTimeMatch[1], 10);
    const minutes = atTimeMatch[2] ? parseInt(atTimeMatch[2], 10) : 0;
    const ampm = atTimeMatch[3]?.toLowerCase();

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    const current = nowInTz();
    const target = new Date(current);

    if (text.includes('tomorrow')) {
      target.setDate(target.getDate() + 1);
    }

    const result = dateInTz(target.getFullYear(), target.getMonth(), target.getDate(), hours, minutes);

    // If the time has already passed today and "tomorrow" wasn't specified, schedule for tomorrow
    if (result.getTime() <= now && !text.includes('tomorrow')) {
      const tomorrow = new Date(target);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return dateInTz(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), hours, minutes).getTime();
    }

    return result.getTime();
  }

  // "tomorrow" (without specific time — default 9am)
  if (text === 'tomorrow' || text.startsWith('tomorrow ')) {
    if (!text.includes('at ')) {
      const current = nowInTz();
      const target = new Date(current);
      target.setDate(target.getDate() + 1);
      return dateInTz(target.getFullYear(), target.getMonth(), target.getDate(), 9, 0).getTime();
    }
  }

  // "tonight" (default 8pm)
  if (text.includes('tonight')) {
    const current = nowInTz();
    const result = dateInTz(current.getFullYear(), current.getMonth(), current.getDate(), 20, 0);
    if (result.getTime() <= now) {
      // Already past 8pm, schedule for tomorrow
      const tomorrow = new Date(current);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return dateInTz(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 20, 0).getTime();
    }
    return result.getTime();
  }

  // Try parsing as absolute timestamp (Unix ms)
  const asNum = parseInt(text, 10);
  if (!isNaN(asNum) && asNum > 1_000_000_000_000) {
    return asNum;
  }

  // Try ISO date string
  const isoDate = Date.parse(text);
  if (!isNaN(isoDate) && isoDate > now) {
    return isoDate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export function createReminder(
  task: string,
  fireAt: number,
  source: string = 'api',
  chatId?: string,
): Reminder {
  const id = crypto.randomUUID().slice(0, 8);
  const createdAt = Date.now();
  const delivery = 'telegram';
  const resolvedChatId = chatId || config.telegramChatId || null;

  dbRun(
    'INSERT INTO reminders (id, task, fire_at, created_at, source, delivery, chat_id, status, snooze_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, task, fireAt, createdAt, source, delivery, resolvedChatId, 'pending', 0,
  );

  console.log(`[Reminders] Created: "${task}" fires at ${new Date(fireAt).toLocaleString()} (ID: ${id})`);

  return {
    id,
    task,
    fireAt,
    createdAt,
    source,
    delivery,
    chatId: resolvedChatId,
    status: 'pending',
    firedAt: null,
    snoozeCount: 0,
    nextSnoozeAt: null,
  };
}

export function listReminders(status?: string): Reminder[] {
  let rows: any[];
  if (status) {
    rows = dbAll('SELECT * FROM reminders WHERE status = ? ORDER BY fire_at ASC', status);
  } else {
    rows = dbAll('SELECT * FROM reminders WHERE status NOT IN (?, ?) ORDER BY fire_at ASC LIMIT 50', 'cancelled', 'expired');
  }
  return rows.map(mapRow);
}

export function cancelReminder(id: string): boolean {
  const result = dbRun(
    'UPDATE reminders SET status = ? WHERE id = ? AND status IN (?, ?)',
    'cancelled', id, 'pending', 'snoozed',
  );
  if (result.changes > 0) {
    console.log(`[Reminders] Cancelled: ${id}`);
    return true;
  }
  return false;
}

export function getReminder(id: string): Reminder | null {
  const row = dbGet('SELECT * FROM reminders WHERE id = ?', id);
  return row ? mapRow(row) : null;
}

// ---------------------------------------------------------------------------
// Dismiss operations (for snooze/nag system)
// ---------------------------------------------------------------------------

/** Dismiss a specific reminder by ID (or "latest" for most recently snoozed). */
export function dismissReminder(idOrLatest: string): { ok: boolean; reminder?: Reminder; error?: string } {
  let row: any;
  if (idOrLatest === 'latest') {
    row = dbGet(
      'SELECT * FROM reminders WHERE status = ? ORDER BY next_snooze_at DESC LIMIT 1',
      'snoozed',
    );
    if (!row) {
      // Also try pending reminders that have fired
      row = dbGet(
        'SELECT * FROM reminders WHERE status IN (?, ?) ORDER BY fire_at DESC LIMIT 1',
        'snoozed', 'pending',
      );
    }
  } else {
    row = dbGet('SELECT * FROM reminders WHERE id = ?', idOrLatest);
  }

  if (!row) {
    return { ok: false, error: 'No active reminder found.' };
  }

  if (row.status === 'fired' || row.status === 'cancelled' || row.status === 'expired') {
    return { ok: false, error: `Reminder "${row.id}" is already ${row.status}.` };
  }

  dbRun('UPDATE reminders SET status = ?, fired_at = ? WHERE id = ?', 'fired', Date.now(), row.id);
  console.log(`[Reminders] Dismissed: "${row.task}" (ID: ${row.id})`);
  return { ok: true, reminder: mapRow({ ...row, status: 'fired', fired_at: Date.now() }) };
}

/** Dismiss all snoozed and pending reminders. */
export function dismissAllReminders(): number {
  const result = dbRun(
    'UPDATE reminders SET status = ?, fired_at = ? WHERE status IN (?, ?)',
    'fired', Date.now(), 'pending', 'snoozed',
  );
  console.log(`[Reminders] Dismissed all: ${result.changes} reminder(s)`);
  return result.changes as number;
}

/**
 * Dismiss reminders by keyword match (for Telegram listener).
 * Called when user says "done", "dismiss", "got it", etc.
 * Dismisses the most recently snoozed reminder.
 */
export function dismissReminderByKeyword(keyword: string): { ok: boolean; message: string } {
  const normalized = keyword.toLowerCase().trim();
  const dismissWords = ['done', 'dismiss', 'got it', 'ok', 'okay', 'acknowledged', 'ack', 'stop', 'thanks', 'noted'];

  if (!dismissWords.some(w => normalized.includes(w))) {
    return { ok: false, message: 'Not a dismiss keyword.' };
  }

  // Dismiss the most recent snoozed reminder
  const result = dismissReminder('latest');
  if (result.ok && result.reminder) {
    return { ok: true, message: `Dismissed reminder: "${result.reminder.task}"` };
  }

  return { ok: false, message: result.error || 'No active reminders to dismiss.' };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const SCHEDULER_POLL_MS = 30_000; // 30 seconds
const MAX_LATE_DELIVERY_MS = 30 * 60_000; // 30 minutes (increased for snooze system)
const MAX_SNOOZE_COUNT = 20;

/**
 * Check for due reminders and snoozed reminders, then deliver via Telegram.
 */
async function processReminders(): Promise<void> {
  const now = Date.now();

  // 1. Process pending reminders that are due
  const dueReminders = dbAll(
    'SELECT * FROM reminders WHERE status = ? AND fire_at <= ?',
    'pending', now,
  );

  for (const row of dueReminders) {
    const reminder = mapRow(row);

    // Skip extremely stale reminders
    if (now - reminder.fireAt > MAX_LATE_DELIVERY_MS) {
      console.log(`[Reminders] Skipping stale reminder ${reminder.id} (${Math.round((now - reminder.fireAt) / 60_000)}min late)`);
      dbRun('UPDATE reminders SET status = ?, fired_at = ? WHERE id = ?', 'expired', now, reminder.id);
      continue;
    }

    // Deliver initial notification via Telegram
    const timeAgo = formatTimeAgo(now - reminder.createdAt);
    const messageText = `⏰ Reminder\n\n${reminder.task}\n\nSet ${timeAgo} via ${reminder.source}\n\nReply "done" to dismiss.`;

    try {
      const result = await sendTelegramMessage(messageText, reminder.chatId || undefined);

      if (result.ok) {
        // Move to snoozed state (not fired) — will keep nagging
        const nextSnooze = now + (config.reminderSnoozeIntervalMs || 900_000);
        dbRun(
          'UPDATE reminders SET status = ?, fired_at = ?, snooze_count = ?, next_snooze_at = ? WHERE id = ?',
          'snoozed', now, 1, nextSnooze, reminder.id,
        );
        console.log(`[Reminders] Delivered (snooze 1): "${reminder.task}" (ID: ${reminder.id}), next nag at ${new Date(nextSnooze).toLocaleTimeString()}`);
      } else {
        console.error(`[Reminders] Delivery failed for ${reminder.id}: ${result.error}`);
      }
    } catch (err) {
      console.error(`[Reminders] Delivery error for ${reminder.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2. Process snoozed reminders that need nagging
  const snoozedDue = dbAll(
    'SELECT * FROM reminders WHERE status = ? AND next_snooze_at <= ?',
    'snoozed', now,
  );

  for (const row of snoozedDue) {
    const reminder = mapRow(row);
    const count = reminder.snoozeCount;

    // Check if max snoozes exceeded
    if (count >= MAX_SNOOZE_COUNT) {
      const finalMsg = `⏰ Reminder expired\n\n"${reminder.task}" — nagged ${count} times with no response. Marking as expired.`;
      try {
        await sendTelegramMessage(finalMsg, reminder.chatId || undefined);
      } catch { /* best effort */ }
      dbRun('UPDATE reminders SET status = ?, fired_at = ? WHERE id = ?', 'expired', now, reminder.id);
      console.log(`[Reminders] Expired after ${count} snoozes: "${reminder.task}" (ID: ${reminder.id})`);
      continue;
    }

    // Build snooze message
    let messageText: string;
    if (count < 3) {
      messageText = `⏰ Hey, reminder: ${reminder.task} — reply "done" to dismiss`;
    } else {
      messageText = `⏰ Reminder #${count + 1}: ${reminder.task}. Still pending! Reply "done" when handled.`;
    }

    try {
      const result = await sendTelegramMessage(messageText, reminder.chatId || undefined);

      if (result.ok) {
        const newCount = count + 1;
        // Escalate interval after 3 snoozes
        const interval = newCount >= 3
          ? (config.reminderEscalatedIntervalMs || 1_800_000)
          : (config.reminderSnoozeIntervalMs || 900_000);
        const nextSnooze = now + interval;

        dbRun(
          'UPDATE reminders SET snooze_count = ?, next_snooze_at = ? WHERE id = ?',
          newCount, nextSnooze, reminder.id,
        );
        console.log(`[Reminders] Snooze #${newCount}: "${reminder.task}" (ID: ${reminder.id}), next at ${new Date(nextSnooze).toLocaleTimeString()}`);
      } else {
        console.error(`[Reminders] Snooze delivery failed for ${reminder.id}: ${result.error}`);
      }
    } catch (err) {
      console.error(`[Reminders] Snooze error for ${reminder.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

function formatTimeAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Start the reminder scheduler. Call once at boot.
 */
export function startReminderScheduler(): void {
  if (schedulerInterval) return;

  // Run immediately on start to catch any missed reminders
  processReminders().catch(err => {
    console.warn(`[Reminders] Initial check error: ${err instanceof Error ? err.message : err}`);
  });

  schedulerInterval = setInterval(() => {
    processReminders().catch(err => {
      console.warn(`[Reminders] Scheduler error: ${err instanceof Error ? err.message : err}`);
    });
  }, SCHEDULER_POLL_MS);

  console.log(`[Reminders] Scheduler started (polling every ${SCHEDULER_POLL_MS / 1000}s, snooze enabled)`);
}

/**
 * Stop the reminder scheduler.
 */
export function stopReminderScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Reminders] Scheduler stopped');
  }
}

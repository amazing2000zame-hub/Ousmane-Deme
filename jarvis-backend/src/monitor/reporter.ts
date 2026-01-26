/**
 * Email reporting for autonomous remediation actions.
 *
 * Sends HTML emails via SSH to the agent1 node (192.168.1.61) which hosts
 * the email service at /opt/agent/. Uses execOnNode() from the SSH client.
 *
 * Email rate limiting: max 1 email per 5 minutes (except escalations).
 * All errors are caught -- email failure is non-fatal.
 */

import { execOnNode } from '../clients/ssh.js';
import type { Incident } from './types.js';
import type { ToolResult } from '../mcp/server.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT1_HOST = '192.168.1.61';
const EMAIL_TO = 'amazing2000zame@gmail.com';
const RATE_LIMIT_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// Rate limiting state
// ---------------------------------------------------------------------------

let lastEmailSentAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape single quotes for shell safety when embedding in a bash command.
 */
function shellEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Build the SSH command to send an email via agent1's email service.
 */
function buildEmailCommand(subject: string, html: string): string {
  const safeSubject = shellEscape(subject);
  const safeHtml = shellEscape(html);

  return `cd /opt/agent && node -e 'require("dotenv").config(); const es = require("./src/services/emailService"); es.init(); es.sendNotification("${EMAIL_TO}", "${safeSubject}", "${safeHtml}").then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });'`;
}

// ---------------------------------------------------------------------------
// Remediation email
// ---------------------------------------------------------------------------

/**
 * Send a remediation report email (success or failure).
 *
 * Rate limited to 1 email per 5 minutes. Skips silently if rate limited.
 * Errors are caught and logged -- never throws.
 */
export async function sendRemediationEmail(
  incident: Incident,
  result: ToolResult,
  success: boolean,
): Promise<void> {
  try {
    // Rate limit check
    const now = Date.now();
    if (now - lastEmailSentAt < RATE_LIMIT_MS) {
      console.log('[Reporter] Skipping email (rate limited)');
      return;
    }

    const statusColor = success ? '#22c55e' : '#ef4444';
    const statusText = success ? 'RESOLVED' : 'FAILED';
    const resultText = result.content?.[0]?.text ?? 'No details available';

    const subject = `[Jarvis] ${success ? 'Resolved' : 'Failed'}: ${incident.type} on ${incident.node}`;

    const html = `<html><body style="font-family: sans-serif; padding: 20px;">
<h2 style="color: ${statusColor};">${statusText}: ${incident.type}</h2>
<table style="border-collapse: collapse; width: 100%;">
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Incident Key</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.key}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Node</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.node}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Target</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.target}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Detected At</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.detectedAt}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Status</td><td style="padding: 8px; border: 1px solid #ddd; color: ${statusColor};">${statusText}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Result</td><td style="padding: 8px; border: 1px solid #ddd;">${resultText.slice(0, 500)}</td></tr>
</table>
<p style="color: #666; margin-top: 20px;"><em>Automated by Jarvis Autonomous Monitor</em></p>
</body></html>`;

    const command = buildEmailCommand(subject, html);
    await execOnNode(AGENT1_HOST, command, 30_000);

    lastEmailSentAt = Date.now();
    console.log(`[Reporter] Remediation email sent: ${subject}`);
  } catch (err) {
    console.warn('[Reporter] Failed to send remediation email:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Escalation email
// ---------------------------------------------------------------------------

/**
 * Send an escalation email when remediation attempts are exhausted.
 *
 * Escalation emails BYPASS the 5-minute rate limit -- they are always sent.
 * Errors are caught and logged -- never throws.
 */
export async function sendEscalationEmail(
  incident: Incident,
  attemptCount: number,
): Promise<void> {
  try {
    const subject = `[Jarvis] ESCALATION: ${incident.type} on ${incident.node} -- ${attemptCount} failed attempts`;

    const html = `<html><body style="font-family: sans-serif; padding: 20px;">
<h2 style="color: #ef4444; border-bottom: 3px solid #ef4444; padding-bottom: 10px;">ESCALATION REQUIRED</h2>
<p style="font-size: 16px;">Jarvis has exhausted all automatic remediation attempts for the following issue:</p>
<table style="border-collapse: collapse; width: 100%;">
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Incident Key</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.key}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Condition</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.type}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Node</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.node}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Target</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.target}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">First Detected</td><td style="padding: 8px; border: 1px solid #ddd;">${incident.detectedAt}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Attempts</td><td style="padding: 8px; border: 1px solid #ddd; color: #ef4444; font-weight: bold;">${attemptCount}</td></tr>
</table>
<h3 style="color: #f59e0b; margin-top: 20px;">Recommendation</h3>
<ul>
<li>SSH into ${incident.node} and investigate manually</li>
<li>Check system logs: <code>journalctl -p err -n 50</code></li>
<li>If the issue is resolved, further attempts will resume on next detection cycle</li>
</ul>
<p style="color: #666; margin-top: 20px;"><em>Automated by Jarvis Autonomous Monitor -- no further automatic attempts will be made for this incident within the rate limit window.</em></p>
</body></html>`;

    const command = buildEmailCommand(subject, html);
    await execOnNode(AGENT1_HOST, command, 30_000);

    // Update lastEmailSentAt even for escalations (to track timing)
    lastEmailSentAt = Date.now();
    console.log(`[Reporter] Escalation email sent: ${subject}`);
  } catch (err) {
    console.warn('[Reporter] Failed to send escalation email:', err instanceof Error ? err.message : err);
  }
}

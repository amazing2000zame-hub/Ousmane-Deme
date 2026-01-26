/**
 * Runbook definitions and execution engine.
 *
 * Maps detected conditions to MCP tool actions. The executeRunbook() pipeline:
 *  1. Find matching runbook for the condition type
 *  2. Check guardrails (kill switch, rate limit, blast radius, autonomy level)
 *  3. Record attempt and mark remediation active
 *  4. Double-check kill switch immediately before execution
 *  5. Execute tool via executeTool() pipeline (inherits safety tier enforcement)
 *  6. Wait for verification delay
 *  7. Verify recovery by re-polling the resource
 *  8. Log autonomy action, emit events, send email report
 *  9. If failure and 3+ attempts, escalate via email
 *
 * All errors are caught -- runbook execution never crashes the process.
 */

import type { Namespace } from 'socket.io';
import crypto from 'node:crypto';
import { executeTool } from '../mcp/server.js';
import { memoryStore } from '../db/memory.js';
import { getAnyClient } from '../clients/proxmox.js';
import { AutonomyLevel, type Incident, type ConditionType } from './types.js';
import {
  checkGuardrails,
  recordAttempt,
  markRemediationActive,
  markRemediationComplete,
  getAttemptCount,
  isKillSwitchActive,
} from './guardrails.js';
import { sendRemediationEmail, sendEscalationEmail } from './reporter.js';

// ---------------------------------------------------------------------------
// Runbook types
// ---------------------------------------------------------------------------

interface RunbookAction {
  tool: string;
  argsBuilder: (incident: Incident) => Record<string, unknown>;
}

interface Runbook {
  id: string;
  name: string;
  trigger: ConditionType;
  autonomyLevel: AutonomyLevel;
  action: RunbookAction;
  verifyDelayMs: number;
  cooldownMs: number;
}

// ---------------------------------------------------------------------------
// Runbook definitions
// ---------------------------------------------------------------------------

export const RUNBOOKS: Runbook[] = [
  {
    id: 'vm-crashed-restart',
    name: 'Restart crashed VM',
    trigger: 'VM_CRASHED',
    autonomyLevel: AutonomyLevel.L3_ACT_REPORT,
    action: {
      tool: 'start_vm',
      argsBuilder: (incident: Incident) => ({
        node: incident.node,
        vmid: parseInt(incident.target, 10),
        confirmed: true,
      }),
    },
    verifyDelayMs: 15_000,
    cooldownMs: 60_000,
  },
  {
    id: 'ct-crashed-restart',
    name: 'Restart crashed container',
    trigger: 'CT_CRASHED',
    autonomyLevel: AutonomyLevel.L3_ACT_REPORT,
    action: {
      tool: 'start_container',
      argsBuilder: (incident: Incident) => ({
        node: incident.node,
        vmid: parseInt(incident.target, 10),
        confirmed: true,
      }),
    },
    verifyDelayMs: 10_000,
    cooldownMs: 60_000,
  },
  {
    id: 'node-unreachable-wol',
    name: 'Wake unreachable node via WOL',
    trigger: 'NODE_UNREACHABLE',
    autonomyLevel: AutonomyLevel.L3_ACT_REPORT,
    action: {
      tool: 'wake_node',
      argsBuilder: (incident: Incident) => ({
        node: incident.node,
      }),
    },
    verifyDelayMs: 60_000,
    cooldownMs: 120_000,
  },
];

// ---------------------------------------------------------------------------
// Runbook lookup
// ---------------------------------------------------------------------------

/**
 * Find the first matching runbook for a condition type.
 */
export function findRunbook(conditionType: ConditionType): Runbook | undefined {
  return RUNBOOKS.find(r => r.trigger === conditionType);
}

// ---------------------------------------------------------------------------
// Runbook execution engine
// ---------------------------------------------------------------------------

/**
 * Execute the remediation pipeline for an incident.
 *
 * This is the core autonomous action function. It matches the incident to a
 * runbook, checks all guardrails, executes the tool, verifies the result,
 * logs the action, and sends email reports.
 *
 * Fire-and-forget from the poller -- errors are caught internally.
 */
export async function executeRunbook(
  incident: Incident,
  eventsNs: Namespace,
): Promise<void> {
  try {
    // 1. Find matching runbook
    const runbook = findRunbook(incident.type);
    if (!runbook) {
      return; // No automated fix for this condition type
    }

    // 2. Check guardrails
    const guardrailResult = checkGuardrails(
      incident.key,
      incident.node,
      runbook.autonomyLevel,
    );

    if (!guardrailResult.allowed) {
      const reason = guardrailResult.reason ?? 'Unknown guardrail block';

      // Rate limit escalation
      if (reason.includes('Rate limit')) {
        const attemptCount = getAttemptCount(incident.key, 3_600_000);
        try {
          await sendEscalationEmail(incident, attemptCount);
        } catch (emailErr) {
          console.warn('[Runbook] Escalation email failed:', emailErr instanceof Error ? emailErr.message : emailErr);
        }

        memoryStore.saveAutonomyAction({
          incidentKey: incident.key,
          incidentId: incident.id,
          runbookId: runbook.id,
          condition: incident.type,
          action: runbook.action.tool,
          actionArgs: JSON.stringify(runbook.action.argsBuilder(incident)),
          result: 'escalated',
          resultDetails: `Rate limit exceeded after ${attemptCount} attempts -- escalation email sent`,
          autonomyLevel: runbook.autonomyLevel,
          node: incident.node,
          attemptNumber: attemptCount,
          escalated: true,
          emailSent: true,
        });
      }

      // Log the block
      memoryStore.saveEvent({
        type: 'status',
        severity: 'warning',
        source: 'system',
        node: incident.node,
        summary: `[Monitor] Remediation blocked for ${incident.key}: ${reason}`,
      });

      eventsNs.emit('event', {
        id: crypto.randomUUID(),
        type: 'status',
        severity: 'warning',
        title: `Remediation blocked: ${incident.type}`,
        message: reason,
        node: incident.node,
        source: 'monitor',
        timestamp: new Date().toISOString(),
      });

      return;
    }

    // 3. Record attempt
    recordAttempt(incident.key);

    // 4. Mark remediation active (blast radius tracking)
    markRemediationActive(incident.node);

    try {
      // 5. Emit "remediation starting" event
      eventsNs.emit('event', {
        id: crypto.randomUUID(),
        type: 'action',
        severity: 'info',
        title: `Remediation starting: ${runbook.name}`,
        message: `Executing ${runbook.action.tool} for ${incident.key}`,
        node: incident.node,
        source: 'monitor',
        timestamp: new Date().toISOString(),
      });

      // 6. Double-check kill switch before execution
      if (isKillSwitchActive()) {
        memoryStore.saveEvent({
          type: 'status',
          severity: 'warning',
          source: 'system',
          node: incident.node,
          summary: `[Monitor] Remediation aborted for ${incident.key}: Kill switch activated between detection and execution`,
        });
        return;
      }

      // 7. Execute tool
      const toolArgs = runbook.action.argsBuilder(incident);
      const result = await executeTool(runbook.action.tool, toolArgs, 'monitor');

      // 8. Wait for verification delay
      await new Promise(r => setTimeout(r, runbook.verifyDelayMs));

      // 9. Verify recovery
      let verified = false;
      try {
        verified = await verifyRecovery(incident);
      } catch (verifyErr) {
        console.warn('[Runbook] Verification failed:', verifyErr instanceof Error ? verifyErr.message : verifyErr);
      }

      const success = !result.isError && verified;
      const attemptCount = getAttemptCount(incident.key, 3_600_000);

      // 10. Log autonomy action
      memoryStore.saveAutonomyAction({
        incidentKey: incident.key,
        incidentId: incident.id,
        runbookId: runbook.id,
        condition: incident.type,
        action: runbook.action.tool,
        actionArgs: JSON.stringify(toolArgs),
        result: success ? 'success' : 'failure',
        resultDetails: success
          ? `Tool executed successfully, recovery verified`
          : `Tool ${result.isError ? 'failed' : 'succeeded'}, verification ${verified ? 'passed' : 'failed'}`,
        verificationResult: verified ? 'passed' : 'failed',
        autonomyLevel: runbook.autonomyLevel,
        node: incident.node,
        attemptNumber: attemptCount,
        escalated: false,
        emailSent: true,
      });

      // 11. Emit result event
      eventsNs.emit('event', {
        id: crypto.randomUUID(),
        type: success ? 'status' : 'alert',
        severity: success ? 'info' : 'error',
        title: success
          ? `Resolved: ${incident.type} on ${incident.node}`
          : `Remediation failed: ${incident.type} on ${incident.node}`,
        message: success
          ? `${runbook.name} succeeded -- ${incident.key} recovered`
          : `${runbook.name} failed -- ${incident.key} still in error state`,
        node: incident.node,
        source: 'monitor',
        timestamp: new Date().toISOString(),
      });

      // 12. Send email report
      if (success) {
        try {
          await sendRemediationEmail(incident, result, true);
        } catch (emailErr) {
          console.warn('[Runbook] Success email failed:', emailErr instanceof Error ? emailErr.message : emailErr);
        }
      } else {
        // Check if we should escalate (3+ failed attempts)
        if (attemptCount >= 3) {
          try {
            await sendEscalationEmail(incident, attemptCount);
          } catch (emailErr) {
            console.warn('[Runbook] Escalation email failed:', emailErr instanceof Error ? emailErr.message : emailErr);
          }

          memoryStore.saveAutonomyAction({
            incidentKey: incident.key,
            incidentId: incident.id,
            runbookId: runbook.id,
            condition: incident.type,
            action: runbook.action.tool,
            result: 'escalated',
            resultDetails: `${attemptCount} failed attempts -- escalation email sent`,
            autonomyLevel: runbook.autonomyLevel,
            node: incident.node,
            attemptNumber: attemptCount,
            escalated: true,
            emailSent: true,
          });
        } else {
          // Regular failure email
          try {
            await sendRemediationEmail(incident, result, false);
          } catch (emailErr) {
            console.warn('[Runbook] Failure email failed:', emailErr instanceof Error ? emailErr.message : emailErr);
          }
        }
      }

      console.log(`[Runbook] ${runbook.name} for ${incident.key}: ${success ? 'SUCCESS' : 'FAILURE'}`);
    } finally {
      // CRITICAL: Always release blast radius lock
      markRemediationComplete(incident.node);
    }
  } catch (err) {
    console.error('[Runbook] Unexpected error in executeRunbook:', err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Recovery verification
// ---------------------------------------------------------------------------

/**
 * Verify that a remediation succeeded by re-polling the affected resource.
 */
async function verifyRecovery(incident: Incident): Promise<boolean> {
  const pve = getAnyClient();

  if (incident.type === 'NODE_UNREACHABLE') {
    // Check node status
    const nodes = (await pve.getClusterResources('node')) as Array<Record<string, unknown>>;
    const node = nodes.find(n => n.node === incident.node);
    return node?.status === 'online';
  }

  if (incident.type === 'VM_CRASHED' || incident.type === 'CT_CRASHED') {
    // Check VM/CT status
    const vms = (await pve.getClusterResources('vm')) as Array<Record<string, unknown>>;
    // Extract vmid from target -- target format may be "name (vmid)" or just a number
    const vmidMatch = incident.target.match(/\d+/);
    if (!vmidMatch) return false;
    const vmid = parseInt(vmidMatch[0], 10);
    const vm = vms.find(v => v.vmid === vmid);
    return vm?.status === 'running';
  }

  return false;
}

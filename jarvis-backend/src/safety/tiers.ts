/**
 * 4-tier action classification for MCP tool safety enforcement.
 *
 * Every tool invocation passes through checkSafety() which:
 *  1. Looks up the tool's tier
 *  2. Checks if the target is a protected resource (always blocked)
 *  3. Applies tier-specific logic (GREEN auto-exec, RED needs confirmation, BLACK blocked)
 *
 * Fail-safe: unknown tools default to BLACK (blocked).
 */

import { isProtectedResource } from './protected.js';

// ---------------------------------------------------------------------------
// Tier enum
// ---------------------------------------------------------------------------

export enum ActionTier {
  /** Auto-execute: read-only operations, no side effects */
  GREEN = 'green',

  /** Execute + log: service restarts, safe operational commands */
  YELLOW = 'yellow',

  /** Require confirmed=true flag: VM/CT start/stop/restart */
  RED = 'red',

  /** Always blocked: destructive operations that could break the cluster */
  BLACK = 'black',
}

// ---------------------------------------------------------------------------
// Tool-to-tier mapping
// ---------------------------------------------------------------------------

export const TOOL_TIERS: Record<string, ActionTier> = {
  // GREEN -- read-only cluster monitoring
  get_cluster_status: ActionTier.GREEN,
  get_node_status: ActionTier.GREEN,
  get_vms: ActionTier.GREEN,
  get_containers: ActionTier.GREEN,
  get_storage: ActionTier.GREEN,
  get_cluster_resources: ActionTier.GREEN,
  get_node_temperature: ActionTier.GREEN,
  get_recent_tasks: ActionTier.GREEN,
  get_backups: ActionTier.GREEN,

  // GREEN -- read-only file operations
  list_directory: ActionTier.GREEN,
  get_file_info: ActionTier.GREEN,

  // GREEN -- read-only project intelligence
  list_projects: ActionTier.GREEN,
  get_project_structure: ActionTier.GREEN,
  read_project_file: ActionTier.GREEN,
  search_project_files: ActionTier.GREEN,
  analyze_project: ActionTier.GREEN,

  // YELLOW -- operational commands with controlled side effects
  execute_ssh: ActionTier.YELLOW,
  restart_service: ActionTier.YELLOW,
  wake_node: ActionTier.YELLOW,

  // YELLOW -- file transfer operations (write side effects)
  download_file: ActionTier.YELLOW,
  copy_file: ActionTier.YELLOW,
  transfer_file: ActionTier.YELLOW,

  // YELLOW -- voice pipeline (extraction, dataset, training)
  extract_voice_audio: ActionTier.YELLOW,
  prepare_voice_dataset: ActionTier.YELLOW,
  retrain_voice_model: ActionTier.YELLOW,

  // RED -- voice deployment (changes live TTS service)
  deploy_voice_model: ActionTier.RED,

  // YELLOW -- starting VMs/CTs (non-destructive, no confirmation needed)
  start_vm: ActionTier.YELLOW,
  start_container: ActionTier.YELLOW,

  // RED -- stopping/restarting VMs/CTs requires explicit confirmation
  stop_vm: ActionTier.RED,
  restart_vm: ActionTier.RED,
  stop_container: ActionTier.RED,
  restart_container: ActionTier.RED,

  // BLACK -- always blocked destructive operations
  reboot_node: ActionTier.BLACK,

  // Phase 25: Smart Home Tools

  // GREEN -- read-only smart home
  get_who_is_home: ActionTier.GREEN,
  scan_network_devices: ActionTier.GREEN,
  get_thermostat_status: ActionTier.GREEN,
  get_lock_status: ActionTier.GREEN,
  get_camera_snapshot: ActionTier.GREEN,
  query_nvr_detections: ActionTier.GREEN,

  // GREEN -- face recognition queries (Phase 26)
  whos_at_door: ActionTier.GREEN,
  get_recognized_faces: ActionTier.GREEN,
  get_unknown_visitors: ActionTier.GREEN,

  // YELLOW -- thermostat control (logged, non-destructive)
  set_thermostat: ActionTier.YELLOW,

  // RED -- door lock control (requires confirmation for security)
  lock_door: ActionTier.RED,
  unlock_door: ActionTier.RED,
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Get the safety tier for a tool. Unknown tools return BLACK (fail-safe).
 */
export function getToolTier(toolName: string): ActionTier {
  return TOOL_TIERS[toolName] ?? ActionTier.BLACK;
}

// ---------------------------------------------------------------------------
// Safety check
// ---------------------------------------------------------------------------

export interface SafetyResult {
  allowed: boolean;
  reason?: string;
  tier: ActionTier;
}

/**
 * Determine whether a tool invocation should be allowed.
 *
 * Evaluation order:
 *  1. Look up tool tier
 *  2. Check if target is a protected resource -> BLOCK
 *  3. BLACK -> always block
 *  4. RED && !confirmed -> block with "requires confirmation"
 *  5. YELLOW -> allow
 *  6. GREEN -> allow
 *  7. Default: block (fail-safe, should never be reached)
 */
export function checkSafety(
  tool: string,
  args: Record<string, unknown>,
  confirmed: boolean = false,
  overrideActive: boolean = false,
): SafetyResult {
  const tier = getToolTier(tool);

  // Step 2: Protected resource check (overrides everything, even override key)
  const protectedCheck = isProtectedResource(args);
  if (protectedCheck.protected) {
    return {
      allowed: false,
      reason: protectedCheck.reason ?? `Target is a protected resource: ${protectedCheck.resource}`,
      tier,
    };
  }

  // Step 3: Override active -- bypass BLACK and RED restrictions
  if (overrideActive) {
    return { allowed: true, tier };
  }

  // Step 4: BLACK tier -- always blocked (without override)
  if (tier === ActionTier.BLACK) {
    return {
      allowed: false,
      reason: `Tool "${tool}" is classified as BLACK tier and is always blocked. Use the override passkey to elevate.`,
      tier,
    };
  }

  // Step 5: RED tier -- requires explicit confirmation
  if (tier === ActionTier.RED) {
    if (!confirmed) {
      return {
        allowed: false,
        reason: `Tool "${tool}" is classified as RED tier and requires confirmed=true`,
        tier,
      };
    }
    return { allowed: true, tier };
  }

  // Step 5: YELLOW tier -- allowed
  if (tier === ActionTier.YELLOW) {
    return { allowed: true, tier };
  }

  // Step 6: GREEN tier -- allowed
  if (tier === ActionTier.GREEN) {
    return { allowed: true, tier };
  }

  // Step 7: Fail-safe -- block anything unclassified
  return {
    allowed: false,
    reason: `Tool "${tool}" has unrecognized tier "${tier}" -- blocked by fail-safe`,
    tier,
  };
}

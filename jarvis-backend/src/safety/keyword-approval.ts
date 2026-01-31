/**
 * Keyword-based approval for ORANGE tier operations.
 *
 * ORANGE tier tools (delete_file, execute_command, install_package, etc.)
 * require the user to type a specific keyword to confirm execution.
 * This adds an extra layer of safety for dangerous operations.
 */

import { config } from '../config.js';

/**
 * Validate that the provided keyword matches the configured approval keyword.
 * Comparison is case-insensitive.
 *
 * @param providedKeyword - The keyword provided by the user
 * @returns true if the keyword matches
 */
export function validateApprovalKeyword(providedKeyword: string): boolean {
  const expected = config.approvalKeyword.toLowerCase();
  const provided = providedKeyword.trim().toLowerCase();
  return expected === provided;
}

/**
 * Get the approval keyword hint (redacted for security).
 * Returns first and last character with asterisks in between.
 *
 * @returns Redacted keyword hint like "J***-E*****E"
 */
export function getKeywordHint(): string {
  const keyword = config.approvalKeyword;
  if (keyword.length <= 2) return keyword;

  // Show first and last character, mask the middle
  const first = keyword[0];
  const last = keyword[keyword.length - 1];
  const middle = '*'.repeat(keyword.length - 2);
  return `${first}${middle}${last}`;
}

/**
 * Get the full approval keyword (for displaying to user when needed).
 * Should only be shown in secure contexts.
 */
export function getApprovalKeyword(): string {
  return config.approvalKeyword;
}

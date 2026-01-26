/**
 * Unit tests for memory extraction.
 * Tests the pure detectPreferences() function.
 */

import { describe, it, expect } from 'vitest';
import { detectPreferences } from '../ai/memory-extractor.js';

describe('detectPreferences', () => {
  it('detects "I prefer" statements', () => {
    const prefs = detectPreferences('I prefer email alerts for critical issues');
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs[0].content).toContain('prefers');
    expect(prefs[0].key).toMatch(/^pref_/);
  });

  it('detects "always" directives', () => {
    const prefs = detectPreferences('always check disk usage before storage operations');
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs[0].content).toContain('Always');
  });

  it('detects "never" directives', () => {
    const prefs = detectPreferences('never restart the management VM automatically');
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs[0].content).toContain('Never');
  });

  it('detects "remind me" statements', () => {
    const prefs = detectPreferences('remind me to check backups every morning');
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs[0].content).toContain('Reminder');
  });

  it('detects "my ... is ..." statements', () => {
    const prefs = detectPreferences('my email is test@example.com');
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs[0].content).toContain("User's");
  });

  it('ignores short messages', () => {
    const prefs = detectPreferences('hi');
    expect(prefs).toHaveLength(0);
  });

  it('ignores questions', () => {
    const prefs = detectPreferences('do I prefer email or slack for alerts?');
    expect(prefs).toHaveLength(0);
  });

  it('generates unique keys per preference', () => {
    const prefs1 = detectPreferences('I prefer email alerts');
    const prefs2 = detectPreferences('I prefer slack notifications');
    if (prefs1.length > 0 && prefs2.length > 0) {
      expect(prefs1[0].key).not.toBe(prefs2[0].key);
    }
  });

  it('returns empty for non-preference messages', () => {
    const prefs = detectPreferences('what is the cluster status right now');
    expect(prefs).toHaveLength(0);
  });
});

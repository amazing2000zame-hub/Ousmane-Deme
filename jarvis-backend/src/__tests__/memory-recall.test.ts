/**
 * Unit tests for memory recall detection.
 * Tests the pure detectRecallQuery() function.
 */

import { describe, it, expect } from 'vitest';
import { detectRecallQuery } from '../ai/memory-recall.js';

describe('detectRecallQuery', () => {
  it('detects "what did we discuss" as recall', () => {
    const result = detectRecallQuery('what did we discuss about pve yesterday');
    expect(result.isRecall).toBe(true);
    expect(result.searchTerms.length).toBeGreaterThan(0);
  });

  it('detects "do you remember" as recall', () => {
    const result = detectRecallQuery('do you remember the disk issue');
    expect(result.isRecall).toBe(true);
    expect(result.searchTerms).toContain('disk');
  });

  it('detects "last time we" as recall', () => {
    const result = detectRecallQuery('last time we talked about storage');
    expect(result.isRecall).toBe(true);
    expect(result.searchTerms).toContain('storage');
  });

  it('detects "what happened with" as recall', () => {
    const result = detectRecallQuery('what happened with node agent');
    expect(result.isRecall).toBe(true);
  });

  it('detects "remind me about" as recall', () => {
    const result = detectRecallQuery('remind me about the backup schedule');
    expect(result.isRecall).toBe(true);
    expect(result.searchTerms).toContain('backup');
  });

  it('detects "any issues with" as recall', () => {
    const result = detectRecallQuery('any issues with pve recently');
    expect(result.isRecall).toBe(true);
  });

  it('detects "history of" as recall', () => {
    const result = detectRecallQuery('history of node failures');
    expect(result.isRecall).toBe(true);
    expect(result.searchTerms).toContain('node');
  });

  it('does NOT flag regular messages as recall', () => {
    expect(detectRecallQuery('restart the VM').isRecall).toBe(false);
    expect(detectRecallQuery('hello how are you').isRecall).toBe(false);
    expect(detectRecallQuery('show cluster status').isRecall).toBe(false);
    expect(detectRecallQuery('tell me a joke').isRecall).toBe(false);
  });

  it('extracts meaningful search terms', () => {
    const result = detectRecallQuery('what did we discuss about pve disk usage');
    expect(result.isRecall).toBe(true);
    // Should not include stop words like "about", "we", "the"
    expect(result.searchTerms).not.toContain('about');
    expect(result.searchTerms).not.toContain('the');
  });

  it('limits search terms to 5', () => {
    const result = detectRecallQuery('what did we discuss about pve storage lvm disk backup migration networking');
    expect(result.isRecall).toBe(true);
    expect(result.searchTerms.length).toBeLessThanOrEqual(5);
  });
});

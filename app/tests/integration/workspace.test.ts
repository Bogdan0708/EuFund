import { describe, it, expect } from 'vitest';

describe('normalizeSections', () => {
  it('fills missing versioning fields with defaults', async () => {
    const { normalizeSections } = await import('@/lib/ai/orchestrator/workspace');

    const raw = [
      { id: 'sec-1', title: 'Context', content: 'Hello', order: 1, source: 'generated', metadata: {} },
    ];

    const result = normalizeSections(raw as any, '2026-01-01T00:00:00Z');
    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('draft');
    expect(result[0].currentVersion).toBe(1);
    expect(result[0].versionCount).toBe(1);
    expect(result[0].contentHash).toHaveLength(64); // SHA-256 hex
    expect(result[0].lastStateChangeAt).toBe('2026-01-01T00:00:00Z');
    expect(result[0].lastStateChangeBy).toBeNull();
  });

  it('preserves already-complete sections unchanged', async () => {
    const { normalizeSections } = await import('@/lib/ai/orchestrator/workspace');

    const complete = [{
      id: 'sec-1', title: 'Context', content: 'Hello', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 3, versionCount: 3,
      contentHash: 'abc123', lastStateChangeAt: '2026-03-01T00:00:00Z',
      lastStateChangeBy: '22222222-2222-4222-8222-222222222222',
      metadata: { model: 'gpt-4', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-03-01T00:00:00Z', checksum: 'abc' },
    }];

    const result = normalizeSections(complete, '2026-01-01T00:00:00Z');
    expect(result[0].state).toBe('approved');
    expect(result[0].currentVersion).toBe(3);
    expect(result[0].contentHash).toBe('abc123');
  });
});

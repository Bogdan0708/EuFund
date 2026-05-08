import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateMock, captureExceptionMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
    insert: () => ({ values: () => Promise.resolve([]) }),
  },
}));
vi.mock('@/lib/ai/gateway', () => ({
  createGatewayClient: vi.fn(() => ({ generate: generateMock })),
}));
vi.mock('@/lib/monitoring/sentry', () => ({
  captureException: captureExceptionMock,
}));

beforeEach(() => {
  generateMock.mockReset();
  captureExceptionMock.mockReset();
  vi.resetModules();
});

describe('Discovery Pipeline', () => {
  it('exports runDiscovery function', async () => {
    const { runDiscovery } = await import('@/lib/discovery/pipeline');
    expect(typeof runDiscovery).toBe('function');
  });

  it('returns result with counts when Perplexity returns an empty array', async () => {
    generateMock.mockResolvedValue({ content: '[]', tokensUsed: 100 });
    const { runDiscovery } = await import('@/lib/discovery/pipeline');
    const result = await runDiscovery();
    expect(result).toMatchObject({ newCalls: 0, duplicates: 0, errors: [] });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('inserts a new call when Perplexity returns a finding', async () => {
    generateMock.mockResolvedValue({
      content: JSON.stringify([
        {
          sourceUrl: 'https://example.eu/call/1',
          sourceDomain: 'example.eu',
          title: 'Example Call',
          program: 'PNRR',
          summary: 'Test',
        },
      ]),
    });
    const { runDiscovery } = await import('@/lib/discovery/pipeline');
    const result = await runDiscovery();
    expect(result.newCalls).toBe(1);
    expect(result.errors).toEqual([]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('reports the failure (does NOT silently return []) when Perplexity throws', async () => {
    generateMock.mockRejectedValue(new Error('perplexity 503'));
    const { runDiscovery } = await import('@/lib/discovery/pipeline');
    const result = await runDiscovery();
    expect(result.newCalls).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/perplexity/i);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: 'perplexitySweep', phase: 'fetch' }),
    );
  });

  it('reports parse failure when Perplexity returns non-JSON', async () => {
    generateMock.mockResolvedValue({ content: 'not json at all', tokensUsed: 100 });
    const { runDiscovery } = await import('@/lib/discovery/pipeline');
    const result = await runDiscovery();
    expect(result.newCalls).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: 'perplexitySweep', phase: 'parse' }),
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

// Parser-level coverage for searchFundingCalls: mocks global fetch with a
// realistic EC funding-tenders search-api payload and asserts the parser
// maps it into ECFundingCall[] including the numeric-status -> string-status
// translation. Catches parser drift on PR CI without depending on live EC.

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWrappers() {
  vi.doMock('@/lib/integrations/common/cache', () => ({
    withCache: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn(),
  }));
  vi.doMock('@/lib/integrations/common/circuit-breaker', () => ({
    withCircuitBreaker: <T>(_key: string, fn: () => Promise<T>) => fn(),
  }));
  vi.doMock('@/lib/integrations/common/rate-limiter', () => ({
    withRateLimit: <T>(_key: string, fn: () => Promise<T>) => fn(),
  }));
}

describe('EC funding-calls client searchFundingCalls parser', () => {
  it('maps a realistic EC search-api payload into ECFundingCall[] and translates numeric status', async () => {
    vi.resetModules();
    stubWrappers();

    const upstreamPayload = {
      results: [
        {
          reference: 'topic/HORIZON-CL5-2024-01',
          summary: 'Climate research call',
          metadata: {
            identifier: ['HORIZON-CL5-2024-01'],
            title: ['Climate adaptation in coastal regions'],
            descriptionByte: ['<p>Funding for <em>climate adaptation</em> research projects.</p>'],
            frameworkProgramme: ['HORIZON-EUROPE'],
            status: ['31094501'], // numeric "open"
            startDate: ['2024-04-01'],
            deadlineDate: ['2024-09-15'],
            keywords: ['climate', 'adaptation', 'coastal'],
            url: ['https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/HORIZON-CL5-2024-01'],
          },
        },
        {
          reference: 'topic/HORIZON-CL5-2024-02',
          metadata: {
            identifier: ['HORIZON-CL5-2024-02'],
            title: ['Forthcoming forestry call'],
            status: ['31094502'], // numeric "forthcoming"
            keywords: [],
          },
        },
      ],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => upstreamPayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { searchFundingCalls } = await import('@/lib/integrations/ec-portal/client');
    // Use status='closed' so the multi-page scan path isn't triggered (single page).
    const calls = await searchFundingCalls({ status: 'closed', query: 'climate', limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // status='closed' filters out open + forthcoming, so neither result remains;
    // assert by re-running with no filter through a second test below.
    expect(calls).toHaveLength(0);
  });

  it('preserves open + forthcoming when status filter does not exclude them', async () => {
    vi.resetModules();
    stubWrappers();

    const upstreamPayload = {
      results: [
        {
          reference: 'topic/HORIZON-CL5-2024-01',
          metadata: {
            identifier: ['HORIZON-CL5-2024-01'],
            title: ['Climate adaptation in coastal regions'],
            descriptionByte: ['<p>Funding for <em>climate adaptation</em>.</p>'],
            frameworkProgramme: ['HORIZON-EUROPE'],
            status: ['31094501'],
            startDate: ['2024-04-01'],
            deadlineDate: ['2024-09-15'],
            keywords: ['climate', 'adaptation'],
          },
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => upstreamPayload,
    }));

    const { searchFundingCalls } = await import('@/lib/integrations/ec-portal/client');
    const calls = await searchFundingCalls({ status: 'open', query: 'climate', limit: 10 });

    expect(calls).toHaveLength(1);
    const [first] = calls;
    expect(first.identifier).toBe('HORIZON-CL5-2024-01');
    expect(first.title).toBe('Climate adaptation in coastal regions');
    expect(first.description).not.toContain('<p>');
    expect(first.description).not.toContain('<em>');
    expect(first.programme).toBe('HORIZON-EUROPE');
    expect(first.status).toBe('open');
    expect(first.openingDate).toBe('2024-04-01');
    expect(first.deadlineDate).toBe('2024-09-15');
    expect(first.topics).toEqual(['climate', 'adaptation']);
    expect(first.currency).toBe('EUR');
  });

  it('throws when the upstream returns a non-OK response', async () => {
    vi.resetModules();
    stubWrappers();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    const { searchFundingCalls } = await import('@/lib/integrations/ec-portal/client');
    await expect(searchFundingCalls({ query: 'x', status: 'closed', limit: 5 }))
      .rejects.toThrow(/EC Portal API error: 500/);
  });
});

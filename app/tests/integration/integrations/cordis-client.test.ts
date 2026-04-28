import { afterEach, describe, expect, it, vi } from 'vitest';

// Parser-level coverage for searchFundedProjects: mocks global fetch with a
// realistic CORDIS EC search-api payload and asserts the parser maps it into
// CORDISProject[] correctly. Catches parser drift on PR CI without depending
// on live upstreams. Status mapping for the route handler is in cordis.test.ts.

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

describe('CORDIS client searchFundedProjects parser', () => {
  it('maps a realistic EC search-api payload into CORDISProject[]', async () => {
    vi.resetModules();
    stubWrappers();

    const upstreamPayload = {
      results: [
        {
          reference: 'project/12345',
          summary: 'A funded research project on AI safety',
          content: 'AI Safety Initiative',
          url: 'https://cordis.europa.eu/project/id/12345',
          metadata: {
            identifier: ['12345'],
            acronym: ['AISAFE'],
            title: ['AI Safety Initiative'],
            descriptionByte: ['<p>A research project on AI safety <strong>methods</strong>.</p>'],
            frameworkProgramme: ['HORIZON-EUROPE'],
            totalCost: ['2500000'],
            ecMaxContribution: ['2000000'],
            startDate: ['2024-01-01'],
            endDate: ['2026-12-31'],
            coordinator: ['Test University'],
            coordinatorCountry: ['RO'],
            participantOrganisation: ['Acme Lab', 'Beta Inc'],
            status: ['SIGNED'],
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

    const { searchFundedProjects } = await import('@/lib/integrations/cordis/client');
    const projects = await searchFundedProjects({ query: 'ai safety', limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(projects).toHaveLength(1);
    const project = projects[0];
    expect(project.id).toBe('12345');
    expect(project.acronym).toBe('AISAFE');
    expect(project.title).toBe('AI Safety Initiative');
    expect(project.description).not.toContain('<p>');
    expect(project.description).not.toContain('<strong>');
    expect(project.programme).toBe('HORIZON-EUROPE');
    expect(project.totalCost).toBe(2_500_000);
    expect(project.ecContribution).toBe(2_000_000);
    expect(project.startDate).toBe('2024-01-01');
    expect(project.endDate).toBe('2026-12-31');
    expect(project.coordinator).toBe('Test University');
    expect(project.country).toBe('RO');
    expect(project.participants).toEqual(['Acme Lab', 'Beta Inc']);
    expect(project.status).toBe('SIGNED');
    expect(project.url).toBe('https://cordis.europa.eu/project/id/12345');
  });

  it('returns an empty array when the upstream returns no results', async () => {
    vi.resetModules();
    stubWrappers();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));

    const { searchFundedProjects } = await import('@/lib/integrations/cordis/client');
    const projects = await searchFundedProjects({ query: 'no-such-thing' });
    expect(projects).toEqual([]);
  });

  it('throws when the upstream returns a non-OK response', async () => {
    vi.resetModules();
    stubWrappers();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    const { searchFundedProjects } = await import('@/lib/integrations/cordis/client');
    await expect(searchFundedProjects({ query: 'x' })).rejects.toThrow(/CORDIS API error: 503/);
  });
});

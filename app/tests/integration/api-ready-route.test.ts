import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Migrated from e2e/api-health.spec.ts ("GET /api/ready returns ready status").
// /api/health and /api/metrics already covered by health-route.test.ts and metrics-route.test.ts.
describe('GET /api/ready', () => {
  it('returns 200 with status "ready" and a timestamp', async () => {
    vi.resetModules();

    // Stub the rate-limit HOF to a passthrough so we test the handler, not the limiter.
    vi.doMock('@/lib/middleware/rate-limit', () => ({
      withRateLimit: (_opts: unknown, handler: (req: NextRequest) => Promise<Response>) => handler,
    }));

    const { GET } = await import('@/app/api/ready/route');
    const request = new NextRequest('http://localhost:3000/api/ready');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(typeof body.timestamp).toBe('string');
  });
});

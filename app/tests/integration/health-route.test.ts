import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health', () => {
  it('returns detailed health outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const { GET } = await import('@/app/api/health/route');
    const request = new NextRequest('http://localhost:3000/api/health');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('services');
    expect(body).toHaveProperty('memory');
    expect(body).toHaveProperty('environment', 'development');
  });

  it('returns minimal health in production without a token', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTHCHECK_AUTH_TOKEN', 'secret-token');

    const { GET } = await import('@/app/api/health/route');
    const request = new NextRequest('http://localhost:3000/api/health');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('version');
    expect(body).not.toHaveProperty('services');
    expect(body).not.toHaveProperty('memory');
    expect(body).not.toHaveProperty('environment');
  });

  it('returns detailed health in production with a valid token', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTHCHECK_AUTH_TOKEN', 'secret-token');

    const { GET } = await import('@/app/api/health/route');
    const request = new NextRequest('http://localhost:3000/api/health', {
      headers: { 'x-health-token': 'secret-token' },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('services');
    expect(body).toHaveProperty('memory');
    expect(body).toHaveProperty('environment', 'production');
  });
});

import { describe, expect, it } from 'vitest';

describe('GET /api/metrics', () => {
  it('returns Prometheus exposition with live request and external API metrics', async () => {
    const monitoring = await import('@/lib/monitoring/metrics');
    const { GET } = await import('@/app/api/metrics/route');

    monitoring.trackRequest('GET', '/api/health', 200, 42);
    monitoring.trackExternalAPI('eurlex', true, 120);
    monitoring.trackExternalAPI('eurlex', false, 250);

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(text).toContain('# HELP http_requests_total');
    expect(text).toContain('http_requests_total{method="GET",path="/api/health",status="200"}');
    expect(text).toContain('external_api_calls_total{api="eurlex"}');
    expect(text).toContain('external_api_errors_total{api="eurlex"}');
    expect(text).toContain('http_request_duration_seconds');
  });
});

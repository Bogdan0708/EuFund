// ─── Prometheus Metrics Endpoint ─────────────────────────────────
// GET /api/metrics — returns Prometheus exposition format

import { metrics } from '@/lib/monitoring/metrics';

export async function GET() {
  return new Response(metrics.toPrometheus(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

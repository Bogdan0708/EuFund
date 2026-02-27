import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('POST /api/ai/ghid-to-tasks', () => {
  it('returns generated tasks for authenticated users', async () => {
    vi.resetModules();
    vi.doMock('@/lib/middleware/auth', () => ({
      withAIAuth: (_req: NextRequest, handler: Function) =>
        handler({ id: 'user-1', email: 'user@test.com', tier: 'pro' }),
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { POST } = await import('@/app/api/ai/ghid-to-tasks/route');
    const req = new NextRequest('http://localhost:3000/api/ai/ghid-to-tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: '123e4567-e89b-42d3-a456-426614174000',
        ghidText: `
          Solicitantul trebuie să prezinte documentele obligatorii privind eligibilitatea.
          Beneficiarul se va asigura că raportul financiar este transmis la termen.
          Este obligatoriu să fie anexată declarația DNSH.
        `.repeat(5),
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.summary.total).toBeGreaterThan(0);
    expect(json.data.readiness.overallScore).toBeLessThanOrEqual(100);
    expect(json.data.tasks[0].sourceRef.clauseId).toMatch(/^GHID-/);
  });
});

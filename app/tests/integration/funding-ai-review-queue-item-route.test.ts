import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/v1/admin/funding-ai/review-queue/[id] PATCH', () => {
  it('updates queue item status to approved and logs audit', async () => {
    vi.resetModules();

    const existing = {
      id: '11111111-1111-4111-8111-111111111112',
      status: 'pending',
      severity: 'high',
      assignedTo: null,
      metadata: {},
      resolvedAt: null,
      resolutionNotes: null,
    };
    const updated = {
      ...existing,
      status: 'approved',
      resolutionNotes: 'Validated against updated guide',
    };

    const dbMock = {
      query: {
        fundingReviewQueue: {
          findFirst: vi.fn().mockResolvedValue(existing),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([updated]),
          })),
        })),
      })),
    };

    vi.doMock('@/lib/auth/helpers', () => ({
      requirePlatformAdmin: vi.fn().mockResolvedValue({ id: 'user-admin' }),
    }));
    vi.doMock('@/lib/db', () => ({ db: dbMock }));

    const logAudit = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/legal/audit', () => ({ logAudit }));

    const { PATCH } = await import('@/app/api/v1/admin/funding-ai/review-queue/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/v1/admin/funding-ai/review-queue/111', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        resolutionNotes: 'Validated against updated guide',
      }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111112' }),
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.data.status).toBe('approved');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'funding_ai.review_queue_update',
    }));
  });
});

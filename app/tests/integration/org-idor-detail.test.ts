import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const MOCK_ORG_ID = '22222222-2222-4222-8222-222222222222';

function mockLogger() {
  vi.doMock('@/lib/logger', () => ({
    logger: {
      child: () => ({
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      }),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  }));
}

function mockDb() {
  vi.doMock('@/lib/db', () => ({
    db: {
      query: {
        organizations: { findFirst: vi.fn() },
      },
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{}]),
          }),
        }),
      }),
    },
    withUserRLS: vi.fn(),
  }));
}

function mockAudit() {
  vi.doMock('@/lib/legal/audit', () => ({
    logAudit: vi.fn(),
    sanitizeForAudit: vi.fn((v: unknown) => v),
  }));
}

describe('organizations/[id] IDOR protection', () => {
  describe('GET /api/v1/organizations/[id]', () => {
    it('returns 403 when caller is not a member of the org', async () => {
      vi.resetModules();

      // Import Errors AFTER resetModules so instanceof works
      const { Errors } = await import('@/lib/errors');

      mockLogger();
      mockDb();
      mockAudit();

      vi.doMock('@/lib/auth/helpers', () => ({
        requireOrgMembership: vi.fn().mockRejectedValue(Errors.forbidden()),
      }));

      const { GET } = await import(
        '@/app/api/v1/organizations/[id]/route'
      );

      const res = await GET(
        new NextRequest(
          `http://localhost:3000/api/v1/organizations/${MOCK_ORG_ID}`,
        ),
        { params: { id: MOCK_ORG_ID } },
      );

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/organizations/[id]', () => {
    it('returns 403 when caller is not an org_admin', async () => {
      vi.resetModules();

      const { Errors } = await import('@/lib/errors');

      mockLogger();
      mockDb();
      mockAudit();

      vi.doMock('@/lib/auth/helpers', () => ({
        requireOrgMembership: vi.fn().mockRejectedValue(Errors.forbidden()),
      }));

      const { PUT } = await import(
        '@/app/api/v1/organizations/[id]/route'
      );

      const res = await PUT(
        new NextRequest(
          `http://localhost:3000/api/v1/organizations/${MOCK_ORG_ID}`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Hacked Org' }),
          },
        ),
        { params: { id: MOCK_ORG_ID } },
      );

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/organizations/[id]', () => {
    it('returns 403 when caller is not an admin', async () => {
      vi.resetModules();

      const { Errors } = await import('@/lib/errors');

      mockLogger();
      mockDb();
      mockAudit();

      vi.doMock('@/lib/auth/helpers', () => ({
        requireOrgMembership: vi.fn().mockRejectedValue(Errors.forbidden()),
      }));

      const { DELETE } = await import(
        '@/app/api/v1/organizations/[id]/route'
      );

      const res = await DELETE(
        new NextRequest(
          `http://localhost:3000/api/v1/organizations/${MOCK_ORG_ID}`,
          { method: 'DELETE' },
        ),
        { params: { id: MOCK_ORG_ID } },
      );

      expect(res.status).toBe(403);
    });
  });
});

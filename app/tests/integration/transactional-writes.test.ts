import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('Transactional write paths', () => {
  it('register uses a DB transaction for user and consent creation', async () => {
    vi.resetModules();

    const tx = {
      insert: vi.fn()
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: '123e4567-e89b-42d3-a456-426614174000',
                email: 'new@test.com',
                fullName: 'New User',
                createdAt: new Date(),
              },
            ]),
          }),
        })
        .mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
    };

    const dbMock = {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      transaction: vi.fn(async (fn: Function) => fn(tx)),
    };

    vi.doMock('@/lib/db', () => ({ db: dbMock }));
    vi.doMock('@/lib/validators', () => ({
      registerSchema: {
        safeParse: vi.fn().mockReturnValue({
          success: true,
          data: {
            email: 'new@test.com',
            password: 'password123',
            fullName: 'New User',
            phone: undefined,
            dateOfBirth: '1990-01-01',
          },
        }),
      },
    }));
    vi.doMock('bcryptjs', () => ({ hash: vi.fn().mockResolvedValue('hashed-password') }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/email/verification', () => ({ generateVerificationToken: vi.fn().mockResolvedValue('token') }));
    vi.doMock('@/lib/email/transporter', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
    vi.doMock('@/lib/email/templates', () => ({ welcomeEmail: vi.fn().mockReturnValue({ subject: 'Welcome', html: '<p>ok</p>' }) }));
    vi.doMock('@/lib/middleware/rate-limit', () => ({ withRateLimit: (_opts: unknown, handler: Function) => handler }));

    const { POST } = await import('@/app/api/auth/register/route');
    const request = new NextRequest('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(dbMock.transaction).toHaveBeenCalledOnce();
  });

  it('organization creation uses a DB transaction for org and membership creation', async () => {
    vi.resetModules();

    const tx = {
      insert: vi.fn()
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: '123e4567-e89b-42d3-a456-426614174111',
                name: 'Org Test',
              },
            ]),
          }),
        })
        .mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
    };

    const dbMock = {
      query: {
        organizations: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      transaction: vi.fn(async (fn: Function) => fn(tx)),
      select: vi.fn(),
    };

    vi.doMock('@/lib/db', () => ({ db: dbMock }));
    vi.doMock('@/lib/validators', () => ({
      organizationSchema: {
        safeParse: vi.fn().mockReturnValue({
          success: true,
          data: {
            name: 'Org Test',
            cui: '123',
            orgType: 'srl',
            orgSize: undefined,
            caenPrimary: undefined,
            caenSecondary: undefined,
            address: undefined,
            nutsRegion: undefined,
            legalRepName: undefined,
            legalRepRole: undefined,
            contactEmail: undefined,
            contactPhone: undefined,
            website: undefined,
          },
        }),
      },
    }));
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', email: 'u@test.com' }),
      getPaginationParams: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn().mockResolvedValue(undefined),
      sanitizeForAudit: vi.fn((value: unknown) => value),
    }));

    const { POST } = await import('@/app/api/v1/organizations/route');
    const request = new NextRequest('http://localhost:3000/api/v1/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(dbMock.transaction).toHaveBeenCalledOnce();
  });
});

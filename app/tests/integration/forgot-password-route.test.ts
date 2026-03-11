import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('Forgot password route', () => {
  it('returns 200 when token generation fails for an existing user', async () => {
    vi.resetModules();

    const findFirst = vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'user@test.com',
      fullName: 'Test User',
      preferredLang: 'en',
    });
    const sendEmail = vi.fn();

    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          users: {
            findFirst,
          },
        },
      },
    }));
    vi.doMock('@/lib/db/schema', () => ({ users: {} }));
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(() => 'eq-clause') }));
    vi.doMock('@/lib/logger', () => ({
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
      },
    }));
    vi.doMock('@/lib/middleware/rate-limit', () => ({
      withRateLimit: (_opts: unknown, handler: Function) => handler,
    }));
    vi.doMock('@/lib/email/password-reset', () => ({
      generatePasswordResetToken: vi.fn().mockRejectedValue(new Error('db unavailable')),
    }));
    vi.doMock('@/lib/email/transporter', () => ({ sendEmail }));
    vi.doMock('@/lib/email/templates', () => ({
      passwordResetEmail: vi.fn(() => ({ subject: 'Reset', html: '<p>Reset</p>' })),
    }));

    const { POST } = await import('@/app/api/auth/forgot-password/route');
    const request = new NextRequest('http://localhost:3000/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'en-GB,en;q=0.9',
      },
      body: JSON.stringify({ email: 'user@test.com' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

describe('AI Output PII Sanitization', () => {
  it('redacts PII from AI JSON responses in withAIAuth', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'user-1', email: 'u@test.com' } }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ tier: 'free' }]) }) }) }) },
      schema: { users: { tier: 'tier', id: 'id' } },
    }));
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn() }));
    vi.doMock('@/lib/redis/client', () => ({
      isRedisAvailable: vi.fn().mockResolvedValue(true),
      checkRateLimit: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 9,
        resetTime: Date.now() + 1000,
      }),
    }));

    const { withAIAuth } = await import('@/lib/middleware/auth');

    const req = new NextRequest('http://localhost:3000/api/ai/chat', { method: 'POST' });
    const res = await withAIAuth(req, async () => {
      return NextResponse.json({
        success: true,
        data: {
          answer: 'Contact: john.doe@example.com, CNP 1980101223344, IBAN RO49AAAA1B31007593840000',
        },
      });
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    const answer = json?.data?.answer as string;
    expect(answer).toContain('[EMAIL_REDACTED]');
    expect(answer).toContain('[CNP_REDACTED]');
    expect(answer).toContain('[IBAN_REDACTED]');
    expect(answer).not.toContain('john.doe@example.com');
  });
});


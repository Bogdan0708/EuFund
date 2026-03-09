import { describe, expect, it, vi } from 'vitest';

describe('GET /api/billing/info', () => {
  it('returns trial-aware billing state for authenticated users', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/integrations/stripe/billing', () => ({
      getBillingInfo: vi.fn().mockResolvedValue({
        userId: 'user-1',
        tier: 'free',
        effectiveTier: 'pro',
        subscriptionStatus: 'none',
        effectiveSubscriptionStatus: 'trialing',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionPeriodEnd: null,
        isInFreeTrial: true,
        trialEndsAt: new Date('2026-04-01T00:00:00.000Z'),
        trialDaysRemaining: 22,
        usage: {
          apiCallsThisMonth: 10,
          apiCallsLimit: 25000,
          percentUsed: 0,
        },
      }),
    }));

    const { GET } = await import('@/app/api/billing/info/route');
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.effectiveTier).toBe('pro');
    expect(json.effectiveSubscriptionStatus).toBe('trialing');
    expect(json.isInFreeTrial).toBe(true);
    expect(json.trialDaysRemaining).toBe(22);
  });
});

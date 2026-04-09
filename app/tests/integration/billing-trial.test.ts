import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbSelectMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: dbSelectMock,
  },
}));

describe('billing trial behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('treats new free users as trialing with effective pro limits', async () => {
    // Use a date within the 30-day trial window (relative to now)
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'user-1',
              tier: 'free',
              subscriptionStatus: 'none',
              stripeCustomerId: null,
              stripeSubscriptionId: null,
              subscriptionPeriodEnd: null,
              createdAt: recentDate,
              apiCallsThisMonth: 120,
            },
          ]),
        }),
      }),
    });

    const { getBillingInfo } = await import('@/lib/integrations/stripe/billing');
    const info = await getBillingInfo('user-1');

    expect(info.tier).toBe('free');
    expect(info.effectiveTier).toBe('pro');
    expect(info.subscriptionStatus).toBe('none');
    expect(info.effectiveSubscriptionStatus).toBe('trialing');
    expect(info.isInFreeTrial).toBe(true);
    expect(info.trialDaysRemaining).toBeGreaterThan(0);
    expect(info.usage.apiCallsLimit).toBe(25000);
  });

  it('ends the trial after 30 days and falls back to free limits', async () => {
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'user-2',
              tier: 'free',
              subscriptionStatus: 'none',
              stripeCustomerId: null,
              stripeSubscriptionId: null,
              subscriptionPeriodEnd: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              apiCallsThisMonth: 120,
            },
          ]),
        }),
      }),
    });

    const { getBillingInfo } = await import('@/lib/integrations/stripe/billing');
    const info = await getBillingInfo('user-2');

    expect(info.tier).toBe('free');
    expect(info.effectiveTier).toBe('free');
    expect(info.effectiveSubscriptionStatus).toBe('none');
    expect(info.isInFreeTrial).toBe(false);
    expect(info.trialDaysRemaining).toBe(0);
    expect(info.usage.apiCallsLimit).toBe(1000);
  });

  it('publishes the free plan as a 30-day trial and removes paid-plan trial metadata', async () => {
    const { getPricingTiers } = await import('@/lib/integrations/stripe/billing');
    const pricing = getPricingTiers();

    expect(pricing.find((tier) => tier.tier === 'free')?.trialDays).toBe(30);
    expect(pricing.find((tier) => tier.tier === 'pro')?.trialDays).toBe(0);
    expect(pricing.find((tier) => tier.tier === 'enterprise')?.trialDays).toBe(0);
  });
});

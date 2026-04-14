import { Errors } from '@/lib/errors';
import { isBillingEnabled } from '@/lib/billing/config';

export type BillingTier = 'free' | 'plus' | 'pro' | 'enterprise' | 'ultra';

const BILLING_TIER_ORDER: Record<BillingTier, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  enterprise: 3,
  ultra: 4,
};

export function hasRequiredTier(currentTier: BillingTier, minTier: BillingTier): boolean {
  if (!isBillingEnabled()) {
    return true;
  }

  return BILLING_TIER_ORDER[currentTier] >= BILLING_TIER_ORDER[minTier];
}

export function assertTier(currentTier: BillingTier, minTier: BillingTier): BillingTier {
  if (!hasRequiredTier(currentTier, minTier)) {
    throw Errors.forbidden();
  }

  return currentTier;
}

async function resolveUserTier(userId: string): Promise<BillingTier> {
  const [{ db }, { users }, { eq }, { resolveBillingTrialState }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('drizzle-orm'),
    import('@/lib/billing/trial'),
  ]);

  const [row] = await db
    .select({
      tier: users.tier,
      subscriptionStatus: users.subscriptionStatus,
      stripeSubscriptionId: users.stripeSubscriptionId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    throw Errors.notFound('user', userId);
  }

  const trialState = resolveBillingTrialState({
    tier: row.tier as BillingTier | null,
    subscriptionStatus: row.subscriptionStatus,
    stripeSubscriptionId: row.stripeSubscriptionId,
    createdAt: row.createdAt,
  });

  return trialState.effectiveTier;
}

export function requireTier(minTier: BillingTier) {
  return async (userId: string): Promise<BillingTier> => {
    if (!isBillingEnabled()) {
      return 'pro';
    }

    const currentTier = await resolveUserTier(userId);
    assertTier(currentTier, minTier);
    return currentTier;
  };
}

export async function requireTierFromSession(minTier: BillingTier): Promise<{ userId: string; tier: BillingTier }> {
  const { requireAuth } = await import('@/lib/auth/helpers');
  const user = await requireAuth();
  const tier = await requireTier(minTier)(user.id);
  return { userId: user.id, tier };
}

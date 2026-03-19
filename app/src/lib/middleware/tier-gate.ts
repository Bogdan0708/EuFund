import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { Errors } from '@/lib/errors';
import { resolveBillingTrialState } from '@/lib/billing/trial';

export type BillingTier = 'free' | 'plus' | 'pro' | 'enterprise' | 'ultra';

const TIER_RANK: Record<BillingTier, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  enterprise: 3,
  ultra: 4,
};

export function hasRequiredTier(currentTier: BillingTier, minTier: BillingTier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[minTier];
}

export function assertTier(currentTier: BillingTier, minTier: BillingTier): BillingTier {
  if (!hasRequiredTier(currentTier, minTier)) {
    throw Errors.forbidden();
  }
  return currentTier;
}

async function getUserTier(userId: string): Promise<BillingTier> {
  const row = await db
    .select({
      tier: users.tier,
      subscriptionStatus: users.subscriptionStatus,
      stripeSubscriptionId: users.stripeSubscriptionId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return resolveBillingTrialState(row[0] || {}).effectiveTier;
}

export function requireTier(minTier: BillingTier) {
  return async (userId: string): Promise<BillingTier> => {
    const currentTier = await getUserTier(userId);
    return assertTier(currentTier, minTier);
  };
}

export async function requireTierFromSession(minTier: BillingTier): Promise<{ userId: string; tier: BillingTier }> {
  const { requireAuth } = await import('@/lib/auth/helpers');
  const user = await requireAuth();
  const ensureTier = requireTier(minTier);
  const tier = await ensureTier(user.id);

  return { userId: user.id, tier };
}

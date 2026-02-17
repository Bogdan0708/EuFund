import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth/helpers';
import { Errors } from '@/lib/errors';

export type BillingTier = 'free' | 'pro' | 'enterprise';

const TIER_RANK: Record<BillingTier, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};

async function getUserTier(userId: string): Promise<BillingTier> {
  const row = await db
    .select({ tier: users.tier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return (row[0]?.tier || 'free') as BillingTier;
}

export function requireTier(minTier: BillingTier) {
  return async (userId: string): Promise<BillingTier> => {
    const currentTier = await getUserTier(userId);
    if (TIER_RANK[currentTier] < TIER_RANK[minTier]) {
      throw Errors.forbidden();
    }
    return currentTier;
  };
}

export async function requireTierFromSession(minTier: BillingTier): Promise<{ userId: string; tier: BillingTier }> {
  const user = await requireAuth();
  const ensureTier = requireTier(minTier);
  const tier = await ensureTier(user.id);

  return { userId: user.id, tier };
}

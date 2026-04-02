// Billing is disabled — all tier gates are no-ops in single-user dev mode.

export type BillingTier = 'free' | 'plus' | 'pro' | 'enterprise' | 'ultra';

export function hasRequiredTier(_currentTier: BillingTier, _minTier: BillingTier): boolean {
  return true;
}

export function assertTier(currentTier: BillingTier, _minTier: BillingTier): BillingTier {
  return currentTier;
}

export function requireTier(_minTier: BillingTier) {
  return async (_userId: string): Promise<BillingTier> => {
    return 'pro';
  };
}

export async function requireTierFromSession(_minTier: BillingTier): Promise<{ userId: string; tier: BillingTier }> {
  const { requireAuth } = await import('@/lib/auth/helpers');
  const user = await requireAuth();
  return { userId: user.id, tier: 'pro' };
}

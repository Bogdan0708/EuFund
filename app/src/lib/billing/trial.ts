import { logger } from '@/lib/logger';

export type BillingTier = 'free' | 'plus' | 'pro' | 'enterprise' | 'ultra';
export type BillingStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid';

export const FREE_TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialResolutionInput {
  tier?: BillingTier | null;
  subscriptionStatus?: BillingStatus | string | null;
  stripeSubscriptionId?: string | null;
  createdAt?: Date | string | null;
  now?: Date;
}

export interface TrialResolution {
  tier: BillingTier;
  effectiveTier: BillingTier;
  subscriptionStatus: BillingStatus;
  effectiveSubscriptionStatus: BillingStatus;
  isInFreeTrial: boolean;
  trialEndsAt: Date | null;
  trialDaysRemaining: number;
}

export function resolveBillingTrialState(input: TrialResolutionInput): TrialResolution {
  const tier = (input.tier || 'free') as BillingTier;
  const subscriptionStatus = (input.subscriptionStatus || 'none') as BillingStatus;
  const now = input.now ?? new Date();
  const createdAt = input.createdAt ? new Date(input.createdAt) : null;

  const hasStandaloneFreeTrial =
    tier === 'free' &&
    subscriptionStatus === 'none' &&
    !input.stripeSubscriptionId &&
    createdAt instanceof Date &&
    !Number.isNaN(createdAt.getTime());

  if (!hasStandaloneFreeTrial) {
    return {
      tier,
      effectiveTier: tier,
      subscriptionStatus,
      effectiveSubscriptionStatus: subscriptionStatus,
      isInFreeTrial: false,
      trialEndsAt: null,
      trialDaysRemaining: 0,
    };
  }

  const trialEndsAt = new Date(createdAt.getTime() + FREE_TRIAL_DAYS * DAY_MS);
  const isInFreeTrial = now.getTime() < trialEndsAt.getTime();
  const trialDaysRemaining = isInFreeTrial
    ? Math.max(1, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS))
    : 0;

  return {
    tier,
    effectiveTier: isInFreeTrial ? 'pro' : tier,
    subscriptionStatus,
    effectiveSubscriptionStatus: isInFreeTrial ? 'trialing' : subscriptionStatus,
    isInFreeTrial,
    trialEndsAt: isInFreeTrial ? trialEndsAt : null,
    trialDaysRemaining,
  };
}

export function normalizeBillingTier(
  raw: string | null | undefined,
  ctx?: { userId?: string },
): BillingTier {
  if (raw === 'plus') {
    logger.warn({ userId: ctx?.userId, rawTier: raw }, '[billing] legacy tier coerced — schedule cleanup');
    return 'pro';
  }
  if (raw === 'ultra') {
    logger.warn({ userId: ctx?.userId, rawTier: raw }, '[billing] legacy tier coerced — schedule cleanup');
    return 'enterprise';
  }
  if (raw === 'free' || raw === 'pro' || raw === 'enterprise') return raw;
  // Unrecognized non-empty value: surface it as a warn so data corruption
  // is observable. Empty/null/undefined are normal (no tier set yet).
  if (raw != null && raw !== '') {
    logger.warn({ userId: ctx?.userId, rawTier: raw }, '[billing] unrecognized tier — falling back to free');
  }
  return 'free';
}

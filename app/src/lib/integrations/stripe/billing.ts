import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, stripeWebhookEvents } from '@/lib/db/schema';
import { FREE_TRIAL_DAYS, normalizeBillingTier, resolveBillingTrialState } from '@/lib/billing/trial';
import { logger } from '@/lib/logger';
import { invalidateUserTierCache } from '@/lib/middleware/auth';

const log = logger.child({ component: 'stripe-billing' });

export type BillingTier = 'free' | 'pro' | 'enterprise';
export type BillingInterval = 'monthly' | 'yearly';
export type BillingStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid';

export interface BillingInfo {
  userId: string;
  tier: BillingTier;
  effectiveTier: BillingTier;
  subscriptionStatus: BillingStatus;
  effectiveSubscriptionStatus: BillingStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionPeriodEnd: Date | null;
  isInFreeTrial: boolean;
  trialEndsAt: Date | null;
  trialDaysRemaining: number;
  usage: {
    apiCallsThisMonth: number;
    apiCallsLimit: number;
    percentUsed: number;
  };
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface PricingTier {
  tier: BillingTier;
  displayName: string;
  monthlyPriceEur: number;
  yearlyPriceEur: number;
  trialDays: number;
}

// Required env vars:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET
// - STRIPE_PRICE_PRO_MONTHLY
// - STRIPE_PRICE_PRO_YEARLY
// - STRIPE_PRICE_ENTERPRISE_MONTHLY
// - STRIPE_PRICE_ENTERPRISE_YEARLY
// - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is required for Stripe billing integration.');
  }

  stripeClient = new Stripe(stripeSecretKey);
  return stripeClient;
}

function getStripePrices(): Record<Exclude<BillingTier, 'free'>, Record<BillingInterval, string | undefined>> {
  return {
    pro: {
      monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
      yearly: process.env.STRIPE_PRICE_PRO_YEARLY,
    },
    enterprise: {
      monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
      yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
    },
  };
}

const API_CALL_LIMITS: Record<BillingTier, number> = {
  free: 1000,
  pro: 25000,
  enterprise: 200000,
};

export function getPricingTiers(): PricingTier[] {
  return [
    { tier: 'free', displayName: 'Free', monthlyPriceEur: 0, yearlyPriceEur: 0, trialDays: FREE_TRIAL_DAYS },
    { tier: 'pro', displayName: 'Pro', monthlyPriceEur: 29, yearlyPriceEur: 290, trialDays: 0 },
    { tier: 'enterprise', displayName: 'Enterprise', monthlyPriceEur: 99, yearlyPriceEur: 990, trialDays: 0 },
  ];
}

function mapStripeStatus(status: Stripe.Subscription.Status): BillingStatus {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'incomplete':
    case 'unpaid':
      return status;
    case 'incomplete_expired':
      return 'canceled';
    case 'paused':
      return 'past_due';
    default:
      return 'none';
  }
}

export function resolveTierByPriceId(priceId: string | null | undefined): BillingTier {
  if (!priceId) return 'free';
  const prices = getStripePrices();
  const proPriceIds = [prices.pro.monthly, prices.pro.yearly].filter(Boolean);
  const enterprisePriceIds = [prices.enterprise.monthly, prices.enterprise.yearly].filter(Boolean);
  if (proPriceIds.includes(priceId)) return 'pro';
  if (enterprisePriceIds.includes(priceId)) return 'enterprise';
  return 'free';
}

const TIER_RANK: Record<BillingTier, number> = { free: 0, pro: 1, enterprise: 2 };

async function checkIfDowngrade(
  userId: string | undefined,
  customerId: string | null,
  newTier: BillingTier,
): Promise<boolean> {
  const condition = userId ? eq(users.id, userId) : customerId ? eq(users.stripeCustomerId, customerId) : null;
  if (!condition) return false;

  const row = await db.select({ tier: users.tier }).from(users).where(condition).limit(1);
  const currentTier = normalizeBillingTier(row[0]?.tier, { userId: userId ?? undefined });
  return TIER_RANK[newTier] < TIER_RANK[currentTier];
}

export async function getOrCreateCustomer(userId: string, email: string): Promise<string> {
  const stripe = getStripeClient();
  const existing = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!existing[0]) {
    throw new Error('User not found');
  }

  if (existing[0].stripeCustomerId) {
    return existing[0].stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return customer.id;
}

export async function createCheckoutSession(
  userId: string,
  tier: Exclude<BillingTier, 'free'>,
  interval: BillingInterval = 'monthly',
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();
  const selectedPrice = getStripePrices()[tier][interval];
  if (!selectedPrice) {
    throw new Error(`Stripe price not configured for ${tier}/${interval}`);
  }

  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const email = userRows[0]?.email;
  if (!email) {
    throw new Error('User not found');
  }

  const customerId = await getOrCreateCustomer(userId, email);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: selectedPrice, quantity: 1 }],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    client_reference_id: userId,
    metadata: { userId, tier },
    subscription_data: {
      metadata: { userId, tier },
    },
    payment_method_collection: 'always',
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  });

  if (!session.url) {
    throw new Error('Stripe checkout session URL is missing');
  }

  return {
    sessionId: session.id,
    url: session.url,
  };
}

export async function createPortalSession(userId: string, returnUrl: string): Promise<{ url: string }> {
  const stripe = getStripeClient();
  const userRows = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const customerId = userRows[0]?.stripeCustomerId;
  if (!customerId) {
    throw new Error('No Stripe customer found for this user');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId || session.client_reference_id;
  const rawTierFromMetadata = session.metadata?.tier;
  // Outer warn fires only for truly unknown tier strings; plus/ultra get their
  // own '[billing] legacy tier coerced' log from normalizeBillingTier, so we
  // skip them here to avoid double-logging during the legacy migration window.
  if (
    rawTierFromMetadata
    && rawTierFromMetadata !== 'free'
    && rawTierFromMetadata !== 'pro'
    && rawTierFromMetadata !== 'enterprise'
    && rawTierFromMetadata !== 'plus'
    && rawTierFromMetadata !== 'ultra'
  ) {
    log.warn({ rawTierFromMetadata, sessionId: session.id, userId }, '[stripe-webhook] unrecognized tier in checkout metadata — falling back to free');
  }
  const tier = normalizeBillingTier(rawTierFromMetadata, { userId: userId ?? undefined });
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
  const customerId = typeof session.customer === 'string' ? session.customer : null;

  if (!userId) return;

  await db
    .update(users)
    .set({
      tier,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: 'active',
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  invalidateUserTierCache(userId);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const userIdFromMetadata = subscription.metadata?.userId;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  const priceId = subscription.items.data[0]?.price?.id;
  const resolvedTier = resolveTierByPriceId(priceId);

  const isDowngrade = await checkIfDowngrade(userIdFromMetadata, customerId, resolvedTier);
  const periodEndUnix = (subscription as { current_period_end?: number }).current_period_end;
  const updateValues = {
    tier: resolvedTier,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    subscriptionStatus: mapStripeStatus(subscription.status),
    subscriptionPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    ...(isDowngrade ? { apiCallsThisMonth: 0 } : {}),
    updatedAt: new Date(),
  } as const;

  const updated = userIdFromMetadata
    ? await db.update(users).set(updateValues).where(eq(users.id, userIdFromMetadata)).returning({ id: users.id })
    : customerId
      ? await db.update(users).set(updateValues).where(eq(users.stripeCustomerId, customerId)).returning({ id: users.id })
      : [];

  for (const row of updated) invalidateUserTierCache(row.id);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  const userIdFromMetadata = subscription.metadata?.userId;
  const periodEndUnix = (subscription as { current_period_end?: number }).current_period_end;
  const updateValues = {
    tier: 'free' as const,
    stripeSubscriptionId: null,
    subscriptionStatus: 'canceled' as const,
    subscriptionPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    updatedAt: new Date(),
  };

  const updated = userIdFromMetadata
    ? await db.update(users).set(updateValues).where(eq(users.id, userIdFromMetadata)).returning({ id: users.id })
    : customerId
      ? await db.update(users).set(updateValues).where(eq(users.stripeCustomerId, customerId)).returning({ id: users.id })
      : [];

  for (const row of updated) invalidateUserTierCache(row.id);
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  if (!customerId) return;

  const updated = await db
    .update(users)
    .set({
      apiCallsThisMonth: 0,
      subscriptionStatus: 'active',
      updatedAt: new Date(),
    })
    .where(eq(users.stripeCustomerId, customerId))
    .returning({ id: users.id });

  for (const row of updated) invalidateUserTierCache(row.id);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
  if (!customerId) return;

  const updated = await db
    .update(users)
    .set({
      subscriptionStatus: 'past_due',
      updatedAt: new Date(),
    })
    .where(eq(users.stripeCustomerId, customerId))
    .returning({ id: users.id });

  for (const row of updated) invalidateUserTierCache(row.id);
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  // Insert-first idempotency: the unique constraint on event_id is the gate.
  // Note: the dispatch handlers are short-lived DB writes, so the window
  // between claim INSERT and successful return is sub-millisecond. A hard
  // process death inside that window would leave the claim in place and
  // silently no-op subsequent retries; if observed, follow up with a claim
  // row that carries status / claimedAt / processedAt / lastError.
  const claimed = await db
    .insert(stripeWebhookEvents)
    .values({ eventId: event.id, eventType: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });

  if (claimed.length === 0) return;

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }
  } catch (err) {
    // Release the claim so Stripe's retry can re-attempt.
    await db.delete(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id));
    throw err;
  }
}

export class MissingWebhookSecretError extends Error {
  constructor() {
    super('STRIPE_WEBHOOK_SECRET is required for Stripe webhook verification.');
    this.name = 'MissingWebhookSecretError';
  }
}

export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
  // Webhook secret check runs first so a missing secret can't be masked
  // by a missing STRIPE_SECRET_KEY error from getStripeClient().
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new MissingWebhookSecretError();
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

export async function getBillingInfo(userId: string): Promise<BillingInfo> {
  const result = await db
    .select({
      id: users.id,
      tier: users.tier,
      stripeCustomerId: users.stripeCustomerId,
      stripeSubscriptionId: users.stripeSubscriptionId,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionPeriodEnd: users.subscriptionPeriodEnd,
      createdAt: users.createdAt,
      apiCallsThisMonth: users.apiCallsThisMonth,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = result[0];
  if (!row) {
    throw new Error('User not found');
  }

  const trialState = resolveBillingTrialState({
    tier: row.tier,
    subscriptionStatus: row.subscriptionStatus,
    stripeSubscriptionId: row.stripeSubscriptionId,
    createdAt: row.createdAt,
  });
  const apiCallsLimit = API_CALL_LIMITS[trialState.effectiveTier];
  const apiCallsThisMonth = row.apiCallsThisMonth || 0;

  return {
    userId: row.id,
    tier: trialState.tier,
    effectiveTier: trialState.effectiveTier,
    subscriptionStatus: trialState.subscriptionStatus,
    effectiveSubscriptionStatus: trialState.effectiveSubscriptionStatus,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    subscriptionPeriodEnd: row.subscriptionPeriodEnd,
    isInFreeTrial: trialState.isInFreeTrial,
    trialEndsAt: trialState.trialEndsAt,
    trialDaysRemaining: trialState.trialDaysRemaining,
    usage: {
      apiCallsThisMonth,
      apiCallsLimit,
      percentUsed: apiCallsLimit === 0 ? 0 : Math.round((apiCallsThisMonth / apiCallsLimit) * 100),
    },
  };
}

// app/tests/integration/billing-tier-cache.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

// vi.hoisted ensures these are evaluated before vi.mock factories run
// (vi.mock calls are hoisted to the top of the compiled output).
const { dbMock, invalidateUserTierCache } = vi.hoisted(() => {
  function makeChainable() {
    const chain: any = {
      insert: vi.fn(() => chain),
      values: vi.fn(() => chain),
      onConflictDoNothing: vi.fn(() => chain),
      returning: vi.fn(),
      update: vi.fn(() => chain),
      set: vi.fn(() => chain),
      where: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      limit: vi.fn(),
      query: { stripeWebhookEvents: { findFirst: vi.fn() } },
    };
    return chain;
  }
  return {
    dbMock: makeChainable(),
    invalidateUserTierCache: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));

vi.mock('@/lib/middleware/auth', () => ({
  invalidateUserTierCache,
  getUserTier: vi.fn().mockResolvedValue('free'),
  withAIAuth: vi.fn(),
  authenticateAIUser: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}));

import { handleWebhookEvent } from '@/lib/integrations/stripe/billing';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset queued return values on the terminal mocks (clearAllMocks doesn't touch these).
  dbMock.returning.mockReset();
  dbMock.limit.mockReset();
  // checkIfDowngrade() does SELECT().from().where().limit(1) and reads row[0]?.tier.
  // Default to 'pro' so the new tier (resolveTierByPriceId on minimal mock event → 'free') counts as downgrade,
  // matching the integration code path that exercises checkIfDowngrade.
  dbMock.limit.mockResolvedValue([{ tier: 'pro' }]);
  // Default sequence: claim insert returns one row, then update returning yields user id.
  dbMock.returning
    .mockResolvedValueOnce([{ id: 'webhook-event-row-1' }])  // claim insert
    .mockResolvedValueOnce([{ id: 'user-1' }]);              // user update returning
});

function makeSubscriptionEvent(type: string): Stripe.Event {
  return {
    id: `evt_${Date.now()}_${Math.random()}`,
    type,
    data: { object: {
      id: 'sub_test',
      customer: 'cus_test',
      metadata: { userId: 'user-1' },
      items: { data: [{ price: { id: 'price_test_pro_m' } }] },
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
    } },
  } as any;
}
function makeInvoiceEvent(type: string): Stripe.Event {
  return {
    id: `evt_${Date.now()}_${Math.random()}`,
    type,
    data: { object: { id: 'in_test', customer: 'cus_test' } },
  } as any;
}
function makeCheckoutEvent(): Stripe.Event {
  return {
    id: `evt_${Date.now()}_${Math.random()}`,
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_test',
      customer: 'cus_test',
      subscription: 'sub_test',
      metadata: { userId: 'user-1', tier: 'pro' },
      client_reference_id: 'user-1',
    } },
  } as any;
}

describe('webhook handlers invalidate tier cache', () => {
  it('checkout.session.completed', async () => {
    await handleWebhookEvent(makeCheckoutEvent());
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('customer.subscription.updated', async () => {
    await handleWebhookEvent(makeSubscriptionEvent('customer.subscription.updated'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('customer.subscription.deleted', async () => {
    await handleWebhookEvent(makeSubscriptionEvent('customer.subscription.deleted'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('invoice.payment_succeeded', async () => {
    await handleWebhookEvent(makeInvoiceEvent('invoice.payment_succeeded'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
  it('invoice.payment_failed', async () => {
    await handleWebhookEvent(makeInvoiceEvent('invoice.payment_failed'));
    expect(invalidateUserTierCache).toHaveBeenCalledWith('user-1');
  });
});

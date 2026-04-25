// app/tests/integration/stripe-webhooks.test.ts
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import Stripe from 'stripe';
import { captureException } from '@/lib/monitoring/sentry';

// Chainable Drizzle-style mock factory.
// IMPORTANT: this defines per-method implementations once at module load.
// Tests must NOT call vi.resetAllMocks() — that would replace the chain
// implementations with bare vi.fn()s and break the next test.
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

const dbMock = makeChainable();

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/monitoring/sentry', () => ({
  captureException: vi.fn().mockResolvedValue(undefined),
  initSentryIfConfigured: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}));

beforeEach(() => {
  vi.clearAllMocks();          // clears call history; preserves implementations
  // Default: idempotency claim succeeds (insert .returning() returns one row)
  dbMock.returning.mockResolvedValue([{ id: 'webhook-event-id-1' }]);
  // Default: SELECT().limit(1) for checkIfDowngrade reads
  dbMock.limit.mockResolvedValue([{ tier: 'pro' }]);
});

// Helper to build a StripeSignatureVerificationError that passes instanceof.
// stripe-node's actual constructor signature is awkward; setting the prototype
// directly is the most robust pattern.
function makeSignatureError(message = 'No signatures found matching the expected signature for payload'): Stripe.errors.StripeSignatureVerificationError {
  const err = new Error(message);
  Object.setPrototypeOf(err, Stripe.errors.StripeSignatureVerificationError.prototype);
  return err as Stripe.errors.StripeSignatureVerificationError;
}

describe('MissingWebhookSecretError', () => {
  const original = process.env.STRIPE_WEBHOOK_SECRET;
  beforeEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET; });
  afterEach(() => { if (original) process.env.STRIPE_WEBHOOK_SECRET = original; });

  it('constructWebhookEvent throws MissingWebhookSecretError when secret is unset', async () => {
    const { constructWebhookEvent, MissingWebhookSecretError: MissingSecret } = await import('@/lib/integrations/stripe/billing');
    // MissingSecret must be a constructor — if the class isn't exported this assertion catches it
    expect(typeof MissingSecret).toBe('function');
    expect(() => constructWebhookEvent('payload', 'sig')).toThrow(MissingSecret);
  });
});

function makeStripeEvent(type: string, id = 'evt_test_1'): any {
  return {
    id,
    type,
    data: { object: { id: 'sub_test_1', customer: 'cus_test_1', metadata: {}, items: { data: [] }, status: 'active' } },
  };
}

describe('handleWebhookEvent idempotency', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_anything';
  });

  it('concurrent identical deliveries → handler runs exactly once', async () => {
    const { handleWebhookEvent } = await import('@/lib/integrations/stripe/billing');

    // First insert wins (returns row); second loses (returns empty array)
    const returningMock = dbMock.returning as Mock;
    returningMock.mockReset();
    returningMock
      .mockResolvedValueOnce([{ id: 'claim-row-1' }])  // first delivery wins
      .mockResolvedValueOnce([]);                       // second delivery: conflict

    const updateMock = dbMock.update as Mock;

    const event = makeStripeEvent('customer.subscription.updated');
    await Promise.all([handleWebhookEvent(event), handleWebhookEvent(event)]);

    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('handler throws → claim row deleted (so retry can re-claim)', async () => {
    const returningMock = (dbMock as any).returning as Mock;
    returningMock.mockReset();
    returningMock.mockResolvedValueOnce([{ id: 'claim-row-1' }]);

    const updateMock = (dbMock as any).update as Mock;
    // Handler dispatch eventually calls db.update; make it throw
    updateMock.mockImplementationOnce(() => { throw new Error('simulated db failure'); });

    const deleteMock = (dbMock as any).delete as Mock;

    const { handleWebhookEvent } = await import('@/lib/integrations/stripe/billing');
    const event = makeStripeEvent('customer.subscription.updated', 'evt_test_rollback');
    await expect(handleWebhookEvent(event)).rejects.toThrow('simulated db failure');

    expect(deleteMock).toHaveBeenCalled();
  });

  it('replay of already-processed event → no handler call, no new side effects', async () => {
    const returningMock = (dbMock as any).returning as Mock;
    returningMock.mockReset();
    // Already-processed: insert returns empty (conflict)
    returningMock.mockResolvedValueOnce([]);

    const updateMock = (dbMock as any).update as Mock;

    const { handleWebhookEvent } = await import('@/lib/integrations/stripe/billing');
    const event = makeStripeEvent('customer.subscription.updated', 'evt_test_replay');
    await handleWebhookEvent(event);

    expect(updateMock).not.toHaveBeenCalled();
  });
});

function makeRequest(payload: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers,
  });
}

async function loadRouteWithBillingMock(billingMockOverrides: Record<string, unknown>) {
  // Reset module registry so doMock takes effect for the freshly-imported route
  vi.resetModules();
  vi.doMock('@/lib/integrations/stripe/billing', async () => {
    const actual = await vi.importActual<typeof import('@/lib/integrations/stripe/billing')>('@/lib/integrations/stripe/billing');
    return { ...actual, ...billingMockOverrides };
  });
  // Re-mock dependencies that our top-level mocks installed; resetModules cleared them
  vi.doMock('@/lib/db', () => ({ db: dbMock }));
  vi.doMock('@/lib/monitoring/sentry', () => ({
    captureException: captureException as Mock,
    initSentryIfConfigured: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('@/lib/logger', () => ({
    logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
  }));
  const mod = await import('@/app/api/webhooks/stripe/route');
  return mod.POST;
}

describe('POST /api/webhooks/stripe error classification', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_anything';
  });

  it('missing stripe-signature header → 400 before construct', async () => {
    const constructFn = vi.fn();
    const POST = await loadRouteWithBillingMock({ constructWebhookEvent: constructFn });
    const res = await POST(makeRequest('{}', {}) as any);
    expect(res.status).toBe(400);
    expect(constructFn).not.toHaveBeenCalled();
  });

  it('signature verification error → 400, no Sentry capture', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => { throw makeSignatureError(); }),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'bad' }) as any);
    expect(res.status).toBe(400);
    expect(captureException as Mock).not.toHaveBeenCalled();
  });

  it('malformed payload (SyntaxError after signature verifies) → 400', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => { throw new SyntaxError('Unexpected token in JSON'); }),
    });
    const res = await POST(makeRequest('not-json', { 'stripe-signature': 'good' }) as any);
    expect(res.status).toBe(400);
    expect(captureException as Mock).not.toHaveBeenCalled();
  });

  it('missing STRIPE_WEBHOOK_SECRET → 500 + Sentry', async () => {
    const billing = await import('@/lib/integrations/stripe/billing');
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => { throw new billing.MissingWebhookSecretError(); }),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'whatever' }) as any);
    expect(res.status).toBe(500);
    expect(captureException as Mock).toHaveBeenCalled();
  });

  it('handler error → 500 + Sentry', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => ({ id: 'evt_test', type: 'customer.subscription.updated', data: { object: {} } } as any)),
      handleWebhookEvent: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'good' }) as any);
    expect(res.status).toBe(500);
    expect(captureException as Mock).toHaveBeenCalled();
  });

  it('successful event → 200', async () => {
    const POST = await loadRouteWithBillingMock({
      constructWebhookEvent: vi.fn(() => ({ id: 'evt_test', type: 'customer.subscription.updated', data: { object: {} } } as any)),
      handleWebhookEvent: vi.fn().mockResolvedValue(undefined),
    });
    const res = await POST(makeRequest('{}', { 'stripe-signature': 'good' }) as any);
    expect(res.status).toBe(200);
  });
});

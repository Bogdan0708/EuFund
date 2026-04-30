// app/tests/unit/billing/resolve-tier-by-price.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTierByPriceId } from '@/lib/integrations/stripe/billing';

// billing.ts imports invalidateUserTierCache from middleware/auth, which
// transitively imports next-auth/next/server — unavailable in the test env.
vi.mock('@/lib/middleware/auth', () => ({
  invalidateUserTierCache: vi.fn(),
  getUserTier: vi.fn().mockResolvedValue('free'),
  withAIAuth: vi.fn(),
  authenticateAIUser: vi.fn(),
}));
// billing.ts also imports logger
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_test_pro_m';
  process.env.STRIPE_PRICE_PRO_YEARLY = 'price_test_pro_y';
  process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY = 'price_test_ent_m';
  process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = 'price_test_ent_y';
});

afterEach(() => {
  for (const key of [
    'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_YEARLY',
    'STRIPE_PRICE_ENTERPRISE_MONTHLY', 'STRIPE_PRICE_ENTERPRISE_YEARLY',
    'STRIPE_PRICE_PLUS_MONTHLY', 'STRIPE_PRICE_ULTRA_MONTHLY',
  ]) {
    if (key in ORIGINAL_ENV) process.env[key] = ORIGINAL_ENV[key];
    else delete process.env[key];
  }
});

describe('resolveTierByPriceId', () => {
  it('pro monthly → pro', () => {
    expect(resolveTierByPriceId('price_test_pro_m')).toBe('pro');
  });
  it('pro yearly → pro', () => {
    expect(resolveTierByPriceId('price_test_pro_y')).toBe('pro');
  });
  it('enterprise monthly → enterprise', () => {
    expect(resolveTierByPriceId('price_test_ent_m')).toBe('enterprise');
  });
  it('enterprise yearly → enterprise', () => {
    expect(resolveTierByPriceId('price_test_ent_y')).toBe('enterprise');
  });
  it('unknown price → free', () => {
    expect(resolveTierByPriceId('price_unknown')).toBe('free');
  });
  it('null → free', () => {
    expect(resolveTierByPriceId(null)).toBe('free');
  });
  it('STRIPE_PRICE_PLUS_MONTHLY set → still resolves to free (plus tier removed)', () => {
    process.env.STRIPE_PRICE_PLUS_MONTHLY = 'fake_plus_id';
    expect(resolveTierByPriceId('fake_plus_id')).toBe('free');
  });
});

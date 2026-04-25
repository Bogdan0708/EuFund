// app/tests/unit/billing/normalize-tier.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), child: () => ({ warn, error: vi.fn(), info: vi.fn() }) },
}));

import { normalizeBillingTier } from '@/lib/billing/trial';

beforeEach(() => { warn.mockClear(); });

describe('normalizeBillingTier', () => {
  it('coerces plus → pro and emits warn log', () => {
    expect(normalizeBillingTier('plus', { userId: 'u1' })).toBe('pro');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('coerces ultra → enterprise and emits warn log', () => {
    expect(normalizeBillingTier('ultra', { userId: 'u1' })).toBe('enterprise');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('passes through pro unchanged with no log', () => {
    expect(normalizeBillingTier('pro')).toBe('pro');
    expect(warn).not.toHaveBeenCalled();
  });
  it('passes through enterprise unchanged with no log', () => {
    expect(normalizeBillingTier('enterprise')).toBe('enterprise');
    expect(warn).not.toHaveBeenCalled();
  });
  it('passes through free unchanged with no log', () => {
    expect(normalizeBillingTier('free')).toBe('free');
    expect(warn).not.toHaveBeenCalled();
  });
  it('logs warn for unrecognized non-empty tier', () => {
    expect(normalizeBillingTier('admin')).toBe('free');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('does not log for null/undefined/empty (normal for users without a tier)', () => {
    expect(normalizeBillingTier(null)).toBe('free');
    expect(normalizeBillingTier(undefined)).toBe('free');
    expect(normalizeBillingTier('')).toBe('free');
    expect(warn).not.toHaveBeenCalled();
  });
});

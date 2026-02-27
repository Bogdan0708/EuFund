import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: any, val: any) => ({ type: 'eq', col, val })),
}));

// Mock db
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

vi.mock('@/lib/db/schema', () => ({
  featureFlags: {
    key: 'key',
    enabled: 'enabled',
    targeting: 'targeting',
  },
}));

describe('Feature Flags Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module to clear the in-memory cache
    vi.resetModules();
  });

  it('should return false for nonexistent flag', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    const result = await isFeatureEnabled('nonexistent.flag');
    expect(result).toBe(false);
  });

  it('should return false for disabled flag regardless of targeting', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            key: 'test.flag',
            enabled: false,
            targeting: { tiers: ['pro'] },
          }]),
        }),
      }),
    });

    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    const result = await isFeatureEnabled('test.flag', { tier: 'pro' });
    expect(result).toBe(false);
  });

  it('should return true for enabled flag with no targeting', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            key: 'test.flag',
            enabled: true,
            targeting: {},
          }]),
        }),
      }),
    });

    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    const result = await isFeatureEnabled('test.flag');
    expect(result).toBe(true);
  });

  it('should respect tier targeting', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            key: 'pro.feature',
            enabled: true,
            targeting: { tiers: ['pro', 'enterprise'] },
          }]),
        }),
      }),
    });

    const { isFeatureEnabled } = await import('@/lib/feature-flags');

    const resultPro = await isFeatureEnabled('pro.feature', { tier: 'pro' });
    expect(resultPro).toBe(true);

    // Free tier should be denied (but value is cached, so re-import)
    const resultFree = await isFeatureEnabled('pro.feature', { tier: 'free' });
    expect(resultFree).toBe(false);
  });

  it('should have deterministic percentage rollout for same userId', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            key: 'rollout.feature',
            enabled: true,
            targeting: { percentage: 50 },
          }]),
        }),
      }),
    });

    const { isFeatureEnabled } = await import('@/lib/feature-flags');

    const result1 = await isFeatureEnabled('rollout.feature', { userId: 'user-abc' });
    const result2 = await isFeatureEnabled('rollout.feature', { userId: 'user-abc' });
    expect(result1).toBe(result2); // Deterministic
  });

  it('should invalidate cache on invalidateFlagCache call', async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve([{
              key: 'cached.flag',
              enabled: true,
              targeting: {},
            }]);
          }),
        }),
      }),
    }));

    const { isFeatureEnabled, invalidateFlagCache } = await import('@/lib/feature-flags');

    await isFeatureEnabled('cached.flag');
    expect(callCount).toBe(1);

    // Second call should use cache
    await isFeatureEnabled('cached.flag');
    expect(callCount).toBe(1);

    // Invalidate and call again
    invalidateFlagCache('cached.flag');
    await isFeatureEnabled('cached.flag');
    expect(callCount).toBe(2);
  });

  it('should return false on db error (fail-closed)', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        }),
      }),
    });

    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    const result = await isFeatureEnabled('error.flag');
    expect(result).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: any[]) => ({ type: 'and', args })),
  eq: vi.fn((col: any, val: any) => ({ type: 'eq', col, val })),
  lt: vi.fn((col: any, val: any) => ({ type: 'lt', col, val })),
  isNotNull: vi.fn((col: any) => ({ type: 'isNotNull', col })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({ type: 'sql', strings, values }),
    { raw: (s: string) => s },
  ),
}));

const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: mockSelect,
    delete: mockDelete,
    update: mockUpdate,
  },
}));

vi.mock('@/lib/db/schema', () => ({
  users: {
    id: 'id',
    email: 'email',
    fullName: 'fullName',
    phone: 'phone',
    passwordHash: 'passwordHash',
    avatarUrl: 'avatarUrl',
    dateOfBirth: 'dateOfBirth',
    mfaSecret: 'mfaSecret',
    stripeCustomerId: 'stripeCustomerId',
    stripeSubscriptionId: 'stripeSubscriptionId',
    deletedAt: 'deletedAt',
  },
  emailVerificationTokens: {
    expiresAt: 'expiresAt',
  },
  passwordResetTokens: {
    expiresAt: 'expiresAt',
  },
  documents: {
    createdAt: 'createdAt',
    aiSummary: 'aiSummary',
    extractedData: 'extractedData',
  },
}));

const mockLogAudit = vi.fn();
vi.mock('@/lib/legal/audit', () => ({
  logAudit: mockLogAudit,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

describe('Retention Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should count expired tokens in dry run', async () => {
    // Mock: 3 expired email tokens, 2 expired reset tokens, 0 deleted users, 0 old docs
    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex === 1) return Promise.resolve([{ count: 3 }]); // email tokens
          if (callIndex === 2) return Promise.resolve([{ count: 2 }]); // reset tokens
          if (callIndex === 3) return Promise.resolve([]); // deleted users (candidates query)
          if (callIndex === 4) return Promise.resolve([{ count: 0 }]); // old AI docs
          return Promise.resolve([{ count: 0 }]);
        }),
      }),
    }));

    const { runRetentionCleanup } = await import('@/lib/legal/retention-cleanup');
    const result = await runRetentionCleanup(true);

    expect(result.dryRun).toBe(true);
    expect(result.policies[0].policy).toBe('purge_expired_tokens');
    expect(result.policies[0].recordsProcessed).toBe(5);
    expect(result.policies[1].policy).toBe('anonymize_deleted_users');
    expect(result.policies[1].recordsProcessed).toBe(0);
  });

  it('should anonymize users deleted >30 days ago', async () => {
    const oldUser = {
      id: 'abcd1234-5678-90ab-cdef-1234567890ab',
      email: 'old@example.com',
    };

    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex <= 2) return Promise.resolve([{ count: 0 }]); // tokens
          if (callIndex === 3) return Promise.resolve([oldUser]); // deleted users
          if (callIndex === 4) return Promise.resolve([{ count: 0 }]); // AI docs
          return Promise.resolve([{ count: 0 }]);
        }),
      }),
    }));

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const { runRetentionCleanup } = await import('@/lib/legal/retention-cleanup');
    const result = await runRetentionCleanup(false);

    expect(result.dryRun).toBe(false);
    expect(result.policies[1].recordsProcessed).toBe(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.retention_cleanup',
        resourceType: 'user',
        resourceId: oldUser.id,
      }),
    );
  });

  it('should skip already-anonymized users', async () => {
    // The SQL filter `NOT LIKE 'anon_%'` is mocked,
    // so the query should return empty if users are already anonymized
    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex <= 2) return Promise.resolve([{ count: 0 }]);
          if (callIndex === 3) return Promise.resolve([]); // no candidates (all anonymized)
          if (callIndex === 4) return Promise.resolve([{ count: 0 }]);
          return Promise.resolve([{ count: 0 }]);
        }),
      }),
    }));

    const { runRetentionCleanup } = await import('@/lib/legal/retention-cleanup');
    const result = await runRetentionCleanup(false);

    expect(result.policies[1].recordsProcessed).toBe(0);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it('should purge old AI content', async () => {
    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex <= 2) return Promise.resolve([{ count: 0 }]); // tokens
          if (callIndex === 3) return Promise.resolve([]); // no users
          if (callIndex === 4) return Promise.resolve([{ count: 5 }]); // 5 old docs
          return Promise.resolve([{ count: 0 }]);
        }),
      }),
    }));

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const { runRetentionCleanup } = await import('@/lib/legal/retention-cleanup');
    const result = await runRetentionCleanup(false);

    expect(result.policies[2].policy).toBe('purge_old_ai_content');
    expect(result.policies[2].recordsProcessed).toBe(5);
  });

  it('dry run should not modify data', async () => {
    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex <= 2) return Promise.resolve([{ count: 10 }]);
          if (callIndex === 3) return Promise.resolve([
            { id: 'user-1', email: 'test@test.com' },
            { id: 'user-2', email: 'test2@test.com' },
          ]);
          if (callIndex === 4) return Promise.resolve([{ count: 3 }]);
          return Promise.resolve([{ count: 0 }]);
        }),
      }),
    }));

    const { runRetentionCleanup } = await import('@/lib/legal/retention-cleanup');
    const result = await runRetentionCleanup(true);

    expect(result.dryRun).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});

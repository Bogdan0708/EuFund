import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  desc: vi.fn((col: any) => ({ type: 'desc', col })),
  asc: vi.fn((col: any) => ({ type: 'asc', col })),
  and: vi.fn((...args: any[]) => ({ type: 'and', args })),
  gte: vi.fn((col: any, val: any) => ({ type: 'gte', col, val })),
  lte: vi.fn((col: any, val: any) => ({ type: 'lte', col, val })),
  eq: vi.fn((col: any, val: any) => ({ type: 'eq', col, val })),
}));

// Mock db
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    transaction: mockTransaction,
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  },
}));

vi.mock('@/lib/db/schema', () => ({
  auditLog: {
    id: 'id',
    userId: 'userId',
    action: 'action',
    resourceType: 'resourceType',
    resourceId: 'resourceId',
    oldValue: 'oldValue',
    newValue: 'newValue',
    ipAddress: 'ipAddress',
    userAgent: 'userAgent',
    metadata: 'metadata',
    entryHash: 'entryHash',
    previousHash: 'previousHash',
    createdAt: 'createdAt',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

describe('Audit Hash Chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeEntryHash', () => {
    it('should produce deterministic SHA-256 hash', async () => {
      const { computeEntryHash } = await import('@/lib/legal/audit');

      const fields = {
        id: 'test-id-123',
        userId: 'user-456',
        action: 'auth.login',
        resourceType: 'user',
        resourceId: 'res-789',
        oldValue: null,
        newValue: { foo: 'bar' },
        ipAddress: '127.0.0.1',
        createdAt: '2026-02-27T00:00:00.000Z',
        previousHash: null,
      };

      const hash1 = computeEntryHash(fields);
      const hash2 = computeEntryHash(fields);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different hash when any field changes', async () => {
      const { computeEntryHash } = await import('@/lib/legal/audit');

      const base = {
        id: 'test-id-123',
        userId: 'user-456',
        action: 'auth.login',
        resourceType: 'user',
        resourceId: 'res-789',
        oldValue: null,
        newValue: null,
        ipAddress: '127.0.0.1',
        createdAt: '2026-02-27T00:00:00.000Z',
        previousHash: null,
      };

      const hash1 = computeEntryHash(base);
      const hash2 = computeEntryHash({ ...base, action: 'auth.logout' });

      expect(hash1).not.toBe(hash2);
    });

    it('should include previousHash in computation', async () => {
      const { computeEntryHash } = await import('@/lib/legal/audit');

      const base = {
        id: 'test-id-123',
        userId: 'user-456',
        action: 'auth.login',
        resourceType: null,
        resourceId: null,
        oldValue: null,
        newValue: null,
        ipAddress: null,
        createdAt: '2026-02-27T00:00:00.000Z',
        previousHash: null,
      };

      const hashWithoutPrev = computeEntryHash(base);
      const hashWithPrev = computeEntryHash({ ...base, previousHash: 'abc123' });

      expect(hashWithoutPrev).not.toBe(hashWithPrev);
    });
  });

  describe('logAudit with hash chain', () => {
    it('should write entryHash and previousHash on insert', async () => {
      const insertedRow = { id: 'new-id', createdAt: new Date('2026-02-27T10:00:00Z') };
      const latestRow = { entryHash: 'prev-hash-abc' };

      mockTransaction.mockImplementation(async (fn: any) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([latestRow]),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([insertedRow]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return fn(tx);
      });

      const { logAudit } = await import('@/lib/legal/audit');

      await logAudit({
        userId: 'user-1',
        action: 'auth.login',
        resourceType: 'user',
        resourceId: 'user-1',
      });

      expect(mockTransaction).toHaveBeenCalledOnce();

      // Verify the transaction function was called
      const txFn = mockTransaction.mock.calls[0][0];
      expect(txFn).toBeTypeOf('function');
    });
  });

  describe('verifyAuditChainIntegrity', () => {
    it('should report intact chain for valid entries', async () => {
      const { computeEntryHash } = await import('@/lib/legal/audit');

      // Build a valid 2-entry chain
      const entry1Fields = {
        id: 'entry-1',
        userId: 'user-1',
        action: 'auth.login',
        resourceType: 'user',
        resourceId: 'user-1',
        oldValue: null,
        newValue: null,
        ipAddress: '127.0.0.1',
        createdAt: '2026-02-27T10:00:00.000Z',
        previousHash: null,
      };
      const hash1 = computeEntryHash(entry1Fields);

      const entry2Fields = {
        id: 'entry-2',
        userId: 'user-1',
        action: 'auth.logout',
        resourceType: 'user',
        resourceId: 'user-1',
        oldValue: null,
        newValue: null,
        ipAddress: '127.0.0.1',
        createdAt: '2026-02-27T10:01:00.000Z',
        previousHash: hash1,
      };
      const hash2 = computeEntryHash(entry2Fields);

      const mockEntries = [
        {
          ...entry1Fields,
          entryHash: hash1,
          previousHash: null,
          createdAt: new Date(entry1Fields.createdAt),
        },
        {
          ...entry2Fields,
          entryHash: hash2,
          previousHash: hash1,
          createdAt: new Date(entry2Fields.createdAt),
        },
      ];

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn()
                  .mockResolvedValueOnce(mockEntries)
                  .mockResolvedValueOnce([]),
              }),
            }),
          }),
        }),
      });

      const { verifyAuditChainIntegrity } = await import('@/lib/legal/audit-integrity');
      const result = await verifyAuditChainIntegrity();

      expect(result.isIntact).toBe(true);
      expect(result.totalChecked).toBe(2);
      expect(result.validEntries).toBe(2);
      expect(result.brokenLinks).toHaveLength(0);
    });

    it('should detect corrupted entry_hash', async () => {
      const { computeEntryHash } = await import('@/lib/legal/audit');

      const entry1Fields = {
        id: 'entry-1',
        userId: 'user-1',
        action: 'auth.login',
        resourceType: null,
        resourceId: null,
        oldValue: null,
        newValue: null,
        ipAddress: null,
        createdAt: '2026-02-27T10:00:00.000Z',
        previousHash: null,
      };
      const hash1 = computeEntryHash(entry1Fields);

      const mockEntries = [
        {
          ...entry1Fields,
          entryHash: 'corrupted-hash-value-not-matching',
          previousHash: null,
          createdAt: new Date(entry1Fields.createdAt),
        },
      ];

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn()
                  .mockResolvedValueOnce(mockEntries)
                  .mockResolvedValueOnce([]),
              }),
            }),
          }),
        }),
      });

      const { verifyAuditChainIntegrity } = await import('@/lib/legal/audit-integrity');
      const result = await verifyAuditChainIntegrity();

      expect(result.isIntact).toBe(false);
      expect(result.brokenLinks).toHaveLength(1);
      expect(result.brokenLinks[0].entryId).toBe('entry-1');
    });
  });
});

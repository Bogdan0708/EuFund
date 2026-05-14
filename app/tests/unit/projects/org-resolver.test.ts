// app/tests/unit/projects/org-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';

const findManyMock = vi.fn();
const insertReturningMock = vi.fn();
const insertMembersMock = vi.fn();
const userLockLimitMock = vi.fn();
// Ordered-membership chain used by the autoPickOnAmbiguous path:
//   tx.select({...}).from(orgMembers).where(...).orderBy(asc(joinedAt), asc(id))
const orderedMembershipsMock = vi.fn();

// Tag the schema stubs so the mock can route .from(orgMembers) vs .from(users).
vi.mock('@/lib/db/schema', () => ({
  organizations: { id: 'organizations.id', _name: 'organizations' },
  orgMembers: {
    userId: 'org_members.user_id',
    orgId: 'org_members.org_id',
    joinedAt: 'org_members.joined_at',
    id: 'org_members.id',
    _name: 'org_members',
  },
  users: { id: 'users.id', _name: 'users' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c: unknown, v: unknown) => ({ c, v })),
  asc: vi.fn((c: unknown) => ({ asc: c })),
}));

const tx = {
  query: { orgMembers: { findMany: findManyMock } },
  // .select(...).from(table)... — dispatch based on the table passed to .from()
  select: vi.fn(() => ({
    from: vi.fn((table: { _name?: string }) => {
      if (table?._name === 'org_members') {
        // Ordered-list path: .where(...).orderBy(asc, asc)
        return {
          where: vi.fn(() => ({
            orderBy: orderedMembershipsMock,
          })),
        };
      }
      // Default: user-row lock path: .where(...).for('update').limit(1)
      return {
        where: vi.fn(() => ({
          for: vi.fn(() => ({
            limit: userLockLimitMock,
          })),
        })),
      };
    }),
  })),
  insert: vi.fn((table: { _name?: string }) => {
    if (table?._name === 'organizations') {
      return { values: vi.fn(() => ({ returning: insertReturningMock })) };
    }
    return { values: insertMembersMock };
  }),
} as unknown as Parameters<typeof resolveProjectOrgIdInTx>[0];

describe('resolveProjectOrgIdInTx', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    insertReturningMock.mockReset();
    insertMembersMock.mockReset();
    userLockLimitMock.mockReset();
    orderedMembershipsMock.mockReset();
    userLockLimitMock.mockResolvedValue([{ id: 'user-1' }]);
  });

  it('returns requestedOrgId verbatim when provided', async () => {
    const out = await resolveProjectOrgIdInTx(tx, 'user-1', 'org-explicit');
    expect(out).toBe('org-explicit');
    expect(findManyMock).not.toHaveBeenCalled();
    expect(userLockLimitMock).not.toHaveBeenCalled();
  });

  it('returns the single membership orgId when user has one org', async () => {
    findManyMock.mockResolvedValueOnce([{ orgId: 'org-only' }]);
    const out = await resolveProjectOrgIdInTx(tx, 'user-1');
    expect(out).toBe('org-only');
  });

  it('auto-creates a Personal Workspace when user has zero memberships', async () => {
    findManyMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([{ id: 'org-new' }]);
    insertMembersMock.mockResolvedValueOnce(undefined);
    const out = await resolveProjectOrgIdInTx(tx, 'user-1');
    expect(out).toBe('org-new');
    expect(insertMembersMock).toHaveBeenCalledOnce();
  });

  it('throws FondEUError(CONFLICT) on multiple memberships without requestedOrgId (default)', async () => {
    findManyMock.mockResolvedValueOnce([{ orgId: 'a' }, { orgId: 'b' }]);
    await expect(resolveProjectOrgIdInTx(tx, 'user-1')).rejects.toThrow();
  });

  describe('autoPickOnAmbiguous: true', () => {
    it('returns oldest membership orgId on 2+ memberships', async () => {
      // Ordered query returns by joined_at asc — head is oldest.
      orderedMembershipsMock.mockResolvedValueOnce([
        { orgId: 'org-oldest', joinedAt: new Date('2026-01-01'), id: 'm1' },
        { orgId: 'org-middle', joinedAt: new Date('2026-02-01'), id: 'm2' },
        { orgId: 'org-newest', joinedAt: new Date('2026-03-01'), id: 'm3' },
      ]);
      const out = await resolveProjectOrgIdInTx(tx, 'user-1', undefined, {
        autoPickOnAmbiguous: true,
      });
      expect(out).toBe('org-oldest');
      // Did NOT fall through to the throw.
      // And did NOT use the limit:2 findMany path.
      expect(findManyMock).not.toHaveBeenCalled();
    });

    it('returns the single membership orgId without ambiguity', async () => {
      orderedMembershipsMock.mockResolvedValueOnce([
        { orgId: 'org-solo', joinedAt: new Date('2026-01-01'), id: 'm1' },
      ]);
      const out = await resolveProjectOrgIdInTx(tx, 'user-1', undefined, {
        autoPickOnAmbiguous: true,
      });
      expect(out).toBe('org-solo');
    });

    it('still creates a Personal Workspace when user has zero memberships', async () => {
      orderedMembershipsMock.mockResolvedValueOnce([]);
      insertReturningMock.mockResolvedValueOnce([{ id: 'org-fresh' }]);
      insertMembersMock.mockResolvedValueOnce(undefined);
      const out = await resolveProjectOrgIdInTx(tx, 'user-1', undefined, {
        autoPickOnAmbiguous: true,
      });
      expect(out).toBe('org-fresh');
      expect(insertMembersMock).toHaveBeenCalledOnce();
    });

    it('requestedOrgId still wins over auto-pick', async () => {
      const out = await resolveProjectOrgIdInTx(tx, 'user-1', 'explicit-org', {
        autoPickOnAmbiguous: true,
      });
      expect(out).toBe('explicit-org');
      expect(orderedMembershipsMock).not.toHaveBeenCalled();
    });
  });
});

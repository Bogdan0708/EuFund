// app/tests/unit/projects/org-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';
import { FondEUError } from '@/lib/errors';

const findManyMock = vi.fn();
const insertReturningMock = vi.fn();
const insertMembersMock = vi.fn();
const userLockLimitMock = vi.fn();

const tx = {
  query: { orgMembers: { findMany: findManyMock } },
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        for: vi.fn(() => ({
          limit: userLockLimitMock,
        })),
      })),
    })),
  })),
  insert: vi.fn((table) => {
    const isOrgs = table && (table === 'organizations' || (table as any)._name === 'organizations');
    if (isOrgs) {
      return { values: vi.fn(() => ({ returning: insertReturningMock })) };
    }
    return { values: insertMembersMock };
  }),
} as any;

vi.mock('@/lib/db/schema', () => ({
	  organizations: { id: 'organizations.id', _name: 'organizations' },
	  orgMembers: { userId: 'org_members.user_id', orgId: 'org_members.org_id' },
	  users: { id: 'users.id' },
	}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((c: any, v: any) => ({ c, v })) }));

describe('resolveProjectOrgIdInTx', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    insertReturningMock.mockReset();
    insertMembersMock.mockReset();
    userLockLimitMock.mockReset();
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

  it('throws FondEUError(CONFLICT) on multiple memberships without requestedOrgId', async () => {
    findManyMock.mockResolvedValueOnce([{ orgId: 'a' }, { orgId: 'b' }]);
    await expect(resolveProjectOrgIdInTx(tx, 'user-1')).rejects.toThrow();
  });
});

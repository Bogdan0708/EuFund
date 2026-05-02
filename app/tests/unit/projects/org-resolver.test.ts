import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';
import { FondEUError } from '@/lib/errors';
import { organizations as orgsTable } from '@/lib/db/schema';

const findManyMock = vi.fn();
const insertReturningMock = vi.fn();
const insertMembersMock = vi.fn();

const tx = {
  query: { orgMembers: { findMany: findManyMock } },
  insert: vi.fn((table) => {
    if (table === orgsTable) {
      return { values: vi.fn(() => ({ returning: insertReturningMock })) };
    }
    return { values: insertMembersMock };
  }),
} as any;

vi.mock('@/lib/db/schema', () => ({
  organizations: { id: 'organizations.id', _name: 'organizations' },
  orgMembers: { userId: 'org_members.user_id', orgId: 'org_members.org_id' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((c: any, v: any) => ({ c, v })) }));

describe('resolveProjectOrgIdInTx', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    insertReturningMock.mockReset();
    insertMembersMock.mockReset();
  });

  it('returns requestedOrgId verbatim when provided', async () => {
    const out = await resolveProjectOrgIdInTx(tx, 'user-1', 'org-explicit');
    expect(out).toBe('org-explicit');
    expect(findManyMock).not.toHaveBeenCalled();
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
    expect(insertMembersMock).toHaveBeenCalledWith({ userId: 'user-1', orgId: 'org-new', role: 'admin' });
  });

  it('throws FondEUError(CONFLICT) on multiple memberships without requestedOrgId', async () => {
    findManyMock.mockResolvedValueOnce([{ orgId: 'a' }, { orgId: 'b' }]);
    await expect(resolveProjectOrgIdInTx(tx, 'user-1')).rejects.toBeInstanceOf(FondEUError);
  });
});

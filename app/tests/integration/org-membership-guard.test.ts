import { describe, expect, it, vi } from 'vitest';

const MOCK_USER_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_ORG_ID = '22222222-2222-4222-8222-222222222222';
const MOCK_MEMBER_ID = '33333333-3333-4333-8333-333333333333';

describe('requireOrgMembership()', () => {
  it('returns user and membership when user is a member', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({
        user: { id: MOCK_USER_ID, email: 'user@test.com', name: 'Test' },
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({
              id: MOCK_MEMBER_ID,
              orgId: MOCK_ORG_ID,
              userId: MOCK_USER_ID,
              role: 'project_manager',
            }),
          },
        },
      },
      withUserRLS: vi.fn(),
    }));
    vi.doMock('@/lib/db/schema', () => ({
      users: { id: 'id' },
      orgMembers: { orgId: 'orgId', userId: 'userId' },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');
    const result = await requireOrgMembership(MOCK_ORG_ID);

    expect(result.user.id).toBe(MOCK_USER_ID);
    expect(result.membership.role).toBe('project_manager');
    expect(result.membership.orgId).toBe(MOCK_ORG_ID);
  });

  it('throws 403 when user is not a member', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({
        user: { id: MOCK_USER_ID, email: 'user@test.com', name: 'Test' },
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue(undefined),
          },
        },
      },
      withUserRLS: vi.fn(),
    }));
    vi.doMock('@/lib/db/schema', () => ({
      users: { id: 'id' },
      orgMembers: { orgId: 'orgId', userId: 'userId' },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');

    await expect(requireOrgMembership(MOCK_ORG_ID)).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it('throws 403 when user role is below minimum', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({
        user: { id: MOCK_USER_ID, email: 'user@test.com', name: 'Test' },
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({
              id: MOCK_MEMBER_ID,
              orgId: MOCK_ORG_ID,
              userId: MOCK_USER_ID,
              role: 'viewer',
            }),
          },
        },
      },
      withUserRLS: vi.fn(),
    }));
    vi.doMock('@/lib/db/schema', () => ({
      users: { id: 'id' },
      orgMembers: { orgId: 'orgId', userId: 'userId' },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');

    await expect(requireOrgMembership(MOCK_ORG_ID, 'org_admin')).rejects.toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it('passes when role meets minimum requirement', async () => {
    vi.resetModules();

    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn().mockResolvedValue({
        user: { id: MOCK_USER_ID, email: 'user@test.com', name: 'Test' },
      }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({
              id: MOCK_MEMBER_ID,
              orgId: MOCK_ORG_ID,
              userId: MOCK_USER_ID,
              role: 'org_admin',
            }),
          },
        },
      },
      withUserRLS: vi.fn(),
    }));
    vi.doMock('@/lib/db/schema', () => ({
      users: { id: 'id' },
      orgMembers: { orgId: 'orgId', userId: 'userId' },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');
    const result = await requireOrgMembership(MOCK_ORG_ID, 'org_admin');

    expect(result.user.id).toBe(MOCK_USER_ID);
    expect(result.membership.role).toBe('org_admin');
  });
});

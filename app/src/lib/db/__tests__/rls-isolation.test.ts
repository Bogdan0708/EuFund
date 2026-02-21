/**
 * RLS Isolation Tests — F-002 Remediation
 *
 * These tests verify:
 *  1. withUserScope() calls SET LOCAL "app.user_id" so PostgreSQL RLS policies
 *     in rls.sql are activated for every query within the scope.
 *  2. The Drizzle proxy routes all db.* calls through the scoped transaction.
 *  3. requireOrgRole() blocks cross-org access at the application layer.
 *  4. The documents route now enforces org membership (previously missing).
 *
 * Tests marked @requires-db need a live PostgreSQL instance with rls.sql applied
 * and are skipped in unit-test runs (INTEGRATION=true to enable them).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Unit tests: withUserScope mechanics ─────────────────────────
describe('withUserScope', () => {
  it('calls SET LOCAL set_config with the correct userId inside the transaction', async () => {
    // Arrange: mock baseDb.transaction to capture what it executes
    const executedStatements: string[] = [];
    let _capturedFn: ((tx: unknown) => Promise<unknown>) | null = null;

    const mockTx = {
      execute: vi.fn(async (stmt: { queryChunks?: unknown[] }) => {
        // Capture the SQL text from the drizzle sql`` tagged template
        const text = JSON.stringify(stmt);
        executedStatements.push(text);
      }),
      query: { projects: { findMany: vi.fn(async () => []) } },
    };

    const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      _capturedFn = fn;
      return fn(mockTx);
    });

    // We test withUserScope by passing a mock of baseDb.transaction.
    // Import the real implementation but replace the postgres driver internals.
    vi.doMock('postgres', () => ({
      default: vi.fn(() => ({})),
    }));
    vi.doMock('drizzle-orm/postgres-js', () => ({
      drizzle: vi.fn(() => ({
        transaction: mockTransaction,
      })),
    }));

    // Re-import after mock so the module uses our mock driver
    const { withUserScope } = await import('../index');

    const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
    await withUserScope(TEST_USER_ID, async () => 'ok');

    // Assert: transaction was started
    expect(mockTransaction).toHaveBeenCalledOnce();
    // Assert: SET LOCAL was executed inside the transaction
    expect(mockTx.execute).toHaveBeenCalledOnce();
    // Assert: the SQL contains set_config and the userId
    const callArg = JSON.stringify(mockTx.execute.mock.calls[0][0]);
    expect(callArg).toContain('set_config');
    expect(callArg).toContain(TEST_USER_ID);
  });

  it('getCurrentDbUserId() returns userId inside scope, null outside', async () => {
    vi.doMock('postgres', () => ({ default: vi.fn(() => ({})) }));
    vi.doMock('drizzle-orm/postgres-js', () => ({
      drizzle: vi.fn(() => ({
        transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            execute: vi.fn(),
            query: {},
          }),
      })),
    }));

    const { withUserScope, getCurrentDbUserId } = await import('../index');

    // Outside scope: null
    expect(getCurrentDbUserId()).toBeNull();

    const TEST_USER_ID = '00000000-0000-0000-0000-000000000002';
    await withUserScope(TEST_USER_ID, async () => {
      // Inside scope: returns the userId
      expect(getCurrentDbUserId()).toBe(TEST_USER_ID);
    });

    // After scope exits: back to null
    expect(getCurrentDbUserId()).toBeNull();
  });
});

// ─── Unit tests: requireOrgRole blocks cross-org access ──────────
describe('requireOrgRole', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws 403 Forbidden when user is not a member of the org', async () => {
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn(async () => null), // no membership found
          },
        },
      },
      withUserScope: vi.fn(async (_: string, fn: () => Promise<unknown>) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn() }));

    const { requireOrgRole } = await import('@/lib/auth/helpers');

    await expect(
      requireOrgRole(
        '00000000-0000-0000-0000-000000000001', // userId
        '00000000-0000-0000-0000-000000000099', // orgId (user is NOT a member)
        'viewer',
      ),
    ).rejects.toThrow();
  });

  it('throws 403 when user role is below the required minimum', async () => {
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn(async () => ({ role: 'viewer' })), // only a viewer
          },
        },
      },
      withUserScope: vi.fn(async (_: string, fn: () => Promise<unknown>) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn() }));

    const { requireOrgRole } = await import('@/lib/auth/helpers');

    await expect(
      requireOrgRole(
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000099',
        'project_manager', // requires higher role than viewer
      ),
    ).rejects.toThrow();
  });

  it('resolves the role when user has sufficient membership', async () => {
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn(async () => ({ role: 'org_admin' })),
          },
        },
      },
      withUserScope: vi.fn(async (_: string, fn: () => Promise<unknown>) => fn()),
    }));
    vi.doMock('@/lib/auth', () => ({ auth: vi.fn() }));

    const { requireOrgRole } = await import('@/lib/auth/helpers');

    const role = await requireOrgRole(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000099',
      'viewer',
    );
    expect(role).toBe('org_admin');
  });
});

// ─── Unit tests: documents route org auth fix ─────────────────────
describe('GET /api/documents/[id] — org membership enforcement', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 403 when user is not a member of the document org', async () => {
    const mockDocId = '00000000-0000-0000-0000-000000000010';
    const mockOrgId = '00000000-0000-0000-0000-000000000099';
    const userId = '00000000-0000-0000-0000-000000000001';

    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn(async () => ({
        user: { id: userId, email: 'attacker@evil.org', id: userId },
      })),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserScope: vi.fn(async (_: string, fn: () => Promise<unknown>) => fn()),
      db: {
        query: {
          documents: {
            findFirst: vi.fn(async () => ({
              id: mockDocId,
              orgId: mockOrgId,
              projectId: null,
              uploadedBy: 'someone-else',
              deletedAt: null,
              filename: 'secret.pdf',
              mimeType: 'application/pdf',
              fileSize: 1024,
              docType: 'bilant',
              aiSummary: null,
              extractedData: null,
              createdAt: new Date(),
            })),
          },
          orgMembers: {
            // user is NOT a member of mockOrgId
            findFirst: vi.fn(async () => null),
          },
        },
        update: vi.fn(),
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/documents/[id]/route');

    const req = new Request(`http://localhost/api/documents/${mockDocId}`);
    const response = await GET(req as unknown as import('next/server').NextRequest, {
      params: { id: mockDocId },
    });

    expect(response.status).toBe(403);
  });

  it('returns 200 when user is a member of the document org', async () => {
    const mockDocId = '00000000-0000-0000-0000-000000000010';
    const mockOrgId = '00000000-0000-0000-0000-000000000099';
    const userId = '00000000-0000-0000-0000-000000000001';

    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn(async () => ({
        user: { id: userId, email: 'member@myorg.com' },
      })),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserScope: vi.fn(async (_: string, fn: () => Promise<unknown>) => fn()),
      db: {
        query: {
          documents: {
            findFirst: vi.fn(async () => ({
              id: mockDocId,
              orgId: mockOrgId,
              projectId: null,
              uploadedBy: 'someone-else',
              deletedAt: null,
              filename: 'report.pdf',
              mimeType: 'application/pdf',
              fileSize: 2048,
              docType: 'bilant',
              aiSummary: null,
              extractedData: null,
              createdAt: new Date(),
            })),
          },
          orgMembers: {
            // user IS a member with viewer role
            findFirst: vi.fn(async () => ({ role: 'viewer' })),
          },
        },
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/documents/[id]/route');

    const req = new Request(`http://localhost/api/documents/${mockDocId}`);
    const response = await GET(req as unknown as import('next/server').NextRequest, {
      params: { id: mockDocId },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(mockDocId);
  });

  it('blocks document access when document belongs to project in a different org', async () => {
    const mockDocId = '00000000-0000-0000-0000-000000000010';
    const projectId = '00000000-0000-0000-0000-000000000020';
    const foreignOrgId = '00000000-0000-0000-0000-000000000099';
    const userId = '00000000-0000-0000-0000-000000000001';

    vi.doMock('@/lib/auth', () => ({
      auth: vi.fn(async () => ({ user: { id: userId, email: 'attacker@evil.org' } })),
    }));
    vi.doMock('@/lib/db', () => ({
      withUserScope: vi.fn(async (_: string, fn: () => Promise<unknown>) => fn()),
      db: {
        query: {
          documents: {
            findFirst: vi.fn(async () => ({
              id: mockDocId,
              orgId: null,
              projectId,
              uploadedBy: 'someone-else',
              deletedAt: null,
              filename: 'private.pdf',
              mimeType: 'application/pdf',
              fileSize: 512,
              docType: 'bilant',
              aiSummary: null,
              extractedData: null,
              createdAt: new Date(),
            })),
          },
          projects: {
            findFirst: vi.fn(async () => ({
              id: projectId,
              orgId: foreignOrgId, // project belongs to another org
            })),
          },
          orgMembers: {
            // attacker is NOT a member of foreignOrgId
            findFirst: vi.fn(async () => null),
          },
        },
      },
    }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }));

    const { GET } = await import('@/app/api/documents/[id]/route');

    const req = new Request(`http://localhost/api/documents/${mockDocId}`);
    const response = await GET(req as unknown as import('next/server').NextRequest, {
      params: { id: mockDocId },
    });

    expect(response.status).toBe(403);
  });
});

// ─── Integration test stubs (@requires-db) ────────────────────────
// Run with: INTEGRATION=true npx vitest run src/lib/db/__tests__/rls-isolation.test.ts
const INTEGRATION = process.env.INTEGRATION === 'true';

describe.skipIf(!INTEGRATION)('RLS integration — cross-org isolation (@requires-db)', () => {
  /**
   * Pre-conditions (set up in test DB before running):
   *   - Users: userA (member of orgA), userB (member of orgB only)
   *   - Projects: projectA (orgId = orgA)
   *   - rls.sql applied and app.user_id is set via withUserScope
   *
   * These tests verify that RLS policies in rls.sql enforce isolation
   * independently of application-layer requireOrgRole checks.
   */

  it('userB cannot read projectA via db.query.projects with RLS active', async () => {
    const { db, withUserScope } = await import('../index');

    const USER_B_ID = process.env.TEST_USER_B_ID!;
    const PROJECT_A_ID = process.env.TEST_PROJECT_A_ID!;

    const result = await withUserScope(USER_B_ID, async () => {
      return db.query.projects.findFirst({
        where: (p, { eq }) => eq(p.id, PROJECT_A_ID),
      });
    });

    // With RLS active, the policy filters out projects the user is not a member of
    expect(result).toBeNull();
  });

  it('userA can read projectA via db.query.projects with RLS active', async () => {
    const { db, withUserScope } = await import('../index');

    const USER_A_ID = process.env.TEST_USER_A_ID!;
    const PROJECT_A_ID = process.env.TEST_PROJECT_A_ID!;

    const result = await withUserScope(USER_A_ID, async () => {
      return db.query.projects.findFirst({
        where: (p, { eq }) => eq(p.id, PROJECT_A_ID),
      });
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(PROJECT_A_ID);
  });

  it('userB cannot read orgA documents with RLS active', async () => {
    const { db, withUserScope } = await import('../index');

    const USER_B_ID = process.env.TEST_USER_B_ID!;
    const ORG_A_ID = process.env.TEST_ORG_A_ID!;

    const results = await withUserScope(USER_B_ID, async () => {
      return db.query.documents.findMany({
        where: (d, { eq }) => eq(d.orgId, ORG_A_ID),
      });
    });

    // RLS policy documents_org_isolation should return zero rows
    expect(results).toHaveLength(0);
  });

  it('withUserScope without a valid userId blocks all RLS-protected tables', async () => {
    const { db, withUserScope } = await import('../index');

    // Using a non-existent UUID: current_setting returns this ID, no org_members
    // match → all policies return false → empty results (not an error)
    const NONEXISTENT_USER = '00000000-dead-beef-0000-000000000000';

    const result = await withUserScope(NONEXISTENT_USER, async () => {
      return db.query.projects.findMany();
    });

    expect(result).toHaveLength(0);
  });
});

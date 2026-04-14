# P0 Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 confirmed P0 security vulnerabilities: org IDOR (7 endpoints), OAuth dangerous email linking, password reset plaintext token acceptance, and project detail RLS bypass.

**Architecture:** Add a reusable `requireOrgMembership()` helper to `lib/auth/helpers.ts` that verifies the caller belongs to the target org (optionally with a minimum role). Apply it to all 9 unprotected org endpoints. Disable OAuth email auto-linking. Remove plaintext token fallback. Wrap the RLS-bypassed query in `withUserRLS()`.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, NextAuth v5 beta, Vitest

---

### Task 1: Add `requireOrgMembership()` helper

**Files:**
- Modify: `app/src/lib/auth/helpers.ts`
- Create: `app/tests/integration/org-membership-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration/org-membership-guard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('requireOrgMembership', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns membership when user is a member of the org', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'u1', email: 'u1@test.com' } }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({ userId: 'u1', orgId: 'org-1', role: 'viewer' }),
          },
        },
      },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');
    const result = await requireOrgMembership('org-1');
    expect(result.membership.role).toBe('viewer');
    expect(result.user.id).toBe('u1');
  });

  it('throws 403 when user is not a member', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'u1', email: 'u1@test.com' } }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');
    await expect(requireOrgMembership('org-1')).rejects.toThrow();
  });

  it('throws 403 when user role is below minimum', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'u1', email: 'u1@test.com' } }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({ userId: 'u1', orgId: 'org-1', role: 'viewer' }),
          },
        },
      },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');
    await expect(requireOrgMembership('org-1', 'org_admin')).rejects.toThrow();
  });

  it('passes when role meets minimum requirement', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: () => Promise.resolve({ user: { id: 'u1', email: 'u1@test.com' } }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          orgMembers: {
            findFirst: vi.fn().mockResolvedValue({ userId: 'u1', orgId: 'org-1', role: 'admin' }),
          },
        },
      },
    }));

    const { requireOrgMembership } = await import('@/lib/auth/helpers');
    const result = await requireOrgMembership('org-1', 'org_admin');
    expect(result.membership.role).toBe('admin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/org-membership-guard.test.ts`
Expected: FAIL — `requireOrgMembership` is not exported

- [ ] **Step 3: Implement `requireOrgMembership`**

Add to `app/src/lib/auth/helpers.ts` after the existing `requirePlatformAdmin` function:

```typescript
import { db } from '@/lib/db';
import { orgMembers } from '@/lib/db/schema';
import { and } from 'drizzle-orm';

// Role hierarchy: admin > org_admin > project_manager > viewer
const ROLE_RANK: Record<string, number> = {
  admin: 4,
  org_admin: 3,
  project_manager: 2,
  viewer: 1,
};

type OrgRole = 'admin' | 'org_admin' | 'project_manager' | 'viewer';

/**
 * Require the current user to be a member of the specified organization.
 * Optionally require a minimum role level.
 * Returns the user and their membership record, or throws 403.
 */
export async function requireOrgMembership(
  orgId: string,
  minRole?: OrgRole,
): Promise<{ user: SessionUser; membership: { userId: string; orgId: string; role: string } }> {
  const user = await requireAuth();

  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)),
  });

  if (!membership) {
    throw Errors.forbidden();
  }

  if (minRole && (ROLE_RANK[membership.role] ?? 0) < (ROLE_RANK[minRole] ?? 0)) {
    throw Errors.forbidden();
  }

  return { user, membership };
}
```

Note: `db`, `eq`, `and`, `orgMembers`, and `Errors` are already imported in `helpers.ts`. You only need to add the `orgMembers` import from `@/lib/db/schema` and the `and` import from `drizzle-orm` if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/org-membership-guard.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/auth/helpers.ts app/tests/integration/org-membership-guard.test.ts
git commit -m "feat(auth): add requireOrgMembership helper for org-level authorization"
```

---

### Task 2: Fix org IDOR — organizations/[id] routes (GET, PUT, DELETE)

**Files:**
- Modify: `app/src/app/api/v1/organizations/[id]/route.ts`
- Create: `app/tests/integration/org-idor-detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration/org-idor-detail.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

describe('Organization detail IDOR protection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn(), sanitizeForAudit: vi.fn((x: unknown) => x) }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn(), child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));
  });

  it('GET returns 403 when user is not a member of the org', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@test.com' }),
      requireOrgMembership: vi.fn().mockRejectedValue(
        (() => { const e = new Error('Forbidden'); (e as any).statusCode = 403; e.name = 'FondEUError'; return e; })()
      ),
    }));
    vi.doMock('@/lib/db', () => ({ db: { query: { organizations: { findFirst: vi.fn() } } } }));

    const mod = await import('@/app/api/v1/organizations/[id]/route');
    // Need to handle FondEUError properly — reimport from errors
    const { Errors } = await import('@/lib/errors');

    // Re-mock with proper FondEUError
    vi.resetModules();
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@test.com' }),
      requireOrgMembership: vi.fn().mockRejectedValue(Errors.forbidden()),
    }));
    vi.doMock('@/lib/db', () => ({ db: { query: { organizations: { findFirst: vi.fn() } } } }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn(), sanitizeForAudit: vi.fn((x: unknown) => x) }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn(), child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));

    const { GET } = await import('@/app/api/v1/organizations/[id]/route');
    const req = new NextRequest('http://localhost/api/v1/organizations/org-1');
    const res = await GET(req, { params: { id: 'org-1' } });

    expect(res.status).toBe(403);
  });

  it('PUT returns 403 when user is not an admin of the org', async () => {
    const { Errors } = await import('@/lib/errors');

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@test.com' }),
      requireOrgMembership: vi.fn().mockRejectedValue(Errors.forbidden()),
    }));
    vi.doMock('@/lib/db', () => ({ db: { query: { organizations: { findFirst: vi.fn() } } } }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn(), sanitizeForAudit: vi.fn((x: unknown) => x) }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn(), child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));

    const { PUT } = await import('@/app/api/v1/organizations/[id]/route');
    const req = new NextRequest('http://localhost/api/v1/organizations/org-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked' }),
    });
    const res = await PUT(req, { params: { id: 'org-1' } });

    expect(res.status).toBe(403);
  });

  it('DELETE returns 403 when user is not an admin of the org', async () => {
    const { Errors } = await import('@/lib/errors');

    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: 'u1', email: 'u1@test.com' }),
      requireOrgMembership: vi.fn().mockRejectedValue(Errors.forbidden()),
    }));
    vi.doMock('@/lib/db', () => ({ db: { query: { organizations: { findFirst: vi.fn() } } } }));
    vi.doMock('@/lib/legal/audit', () => ({ logAudit: vi.fn(), sanitizeForAudit: vi.fn((x: unknown) => x) }));
    vi.doMock('@/lib/logger', () => ({
      logger: { error: vi.fn(), child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));

    const { DELETE } = await import('@/app/api/v1/organizations/[id]/route');
    const req = new NextRequest('http://localhost/api/v1/organizations/org-1');
    const res = await DELETE(req, { params: { id: 'org-1' } });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/org-idor-detail.test.ts`
Expected: FAIL — routes still use `requireAuth()` only, no 403 returned

- [ ] **Step 3: Apply authorization checks to organizations/[id]/route.ts**

Replace the `requireAuth()` calls in all 3 handlers:

**GET** (line 18-20): Replace `await requireAuth()` with:
```typescript
const { user } = await requireOrgMembership(id);
```
Remove the separate `requireAuth()` call. Add `requireOrgMembership` to the import from `@/lib/auth/helpers`.

**PUT** (line 58-59): Replace `const user = await requireAuth()` with:
```typescript
const { user } = await requireOrgMembership(id, 'org_admin');
```

**DELETE** (line 108-109): Replace `const user = await requireAuth()` with:
```typescript
const { user } = await requireOrgMembership(id, 'admin');
```

Update the import on line 11:
```typescript
import { requireOrgMembership } from '@/lib/auth/helpers';
```
Remove `requireAuth` from the import since it's no longer used directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/org-idor-detail.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/v1/organizations/[id]/route.ts app/tests/integration/org-idor-detail.test.ts
git commit -m "fix(security): add org membership checks to organizations/[id] GET/PUT/DELETE"
```

---

### Task 3: Fix org IDOR — members, approvals, verify, ai-reviews routes

**Files:**
- Modify: `app/src/app/api/v1/organizations/[id]/members/route.ts`
- Modify: `app/src/app/api/v1/organizations/[id]/approvals/route.ts`
- Modify: `app/src/app/api/v1/organizations/[id]/verify/route.ts`
- Modify: `app/src/app/api/v1/organizations/[id]/ai-reviews/route.ts`

- [ ] **Step 1: Fix members/route.ts**

Replace `requireAuth()` in all 3 handlers:

**GET** (line 28): Replace `await requireAuth()` with:
```typescript
await requireOrgMembership(id);
```

**POST** (line 55): Replace `const currentUser = await requireAuth()` with:
```typescript
const { user: currentUser } = await requireOrgMembership(id, 'org_admin');
```

**DELETE** (line 117): Replace `const currentUser = await requireAuth()` with:
```typescript
const { user: currentUser } = await requireOrgMembership(id, 'org_admin');
```

Update import:
```typescript
import { requireOrgMembership } from '@/lib/auth/helpers';
```

- [ ] **Step 2: Fix approvals/route.ts**

**GET** (line 21): Replace `await requireAuth()` with:
```typescript
await requireOrgMembership(orgId);
```

**POST** (line 83): Replace `const user = await requireAuth()` with:
```typescript
const { user } = await requireOrgMembership(orgId, 'org_admin');
```

Update import:
```typescript
import { requireOrgMembership, getPaginationParams } from '@/lib/auth/helpers';
```

- [ ] **Step 3: Fix verify/route.ts**

**POST** (line 18): Replace `const user = await requireAuth()` with:
```typescript
const { user } = await requireOrgMembership(id, 'org_admin');
```

Update import:
```typescript
import { requireOrgMembership } from '@/lib/auth/helpers';
```

- [ ] **Step 4: Fix ai-reviews/route.ts**

**GET** (line 20): Replace `await requireAuth()` with:
```typescript
await requireOrgMembership(orgId);
```

**POST** (line ~81, wherever the handler starts): Replace `const user = await requireAuth()` with:
```typescript
const { user } = await requireOrgMembership(orgId, 'org_admin');
```

Update import:
```typescript
import { requireOrgMembership, getPaginationParams } from '@/lib/auth/helpers';
```

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run: `cd app && npx vitest run`
Expected: 718+ tests PASS, 0 FAIL

- [ ] **Step 6: Commit**

```bash
git add app/src/app/api/v1/organizations/[id]/members/route.ts \
       app/src/app/api/v1/organizations/[id]/approvals/route.ts \
       app/src/app/api/v1/organizations/[id]/verify/route.ts \
       app/src/app/api/v1/organizations/[id]/ai-reviews/route.ts
git commit -m "fix(security): add org membership checks to members, approvals, verify, ai-reviews"
```

---

### Task 4: Disable OAuth dangerous email linking

**Files:**
- Modify: `app/src/lib/auth/index.ts`
- Create: `app/tests/unit/auth-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/auth-config.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Auth config safety', () => {
  it('does not use allowDangerousEmailAccountLinking on any OAuth provider', async () => {
    const authConfigSource = await import('fs').then(fs =>
      fs.readFileSync('src/lib/auth/index.ts', 'utf-8')
    );

    expect(authConfigSource).not.toContain('allowDangerousEmailAccountLinking: true');
  });

  it('signIn callback does not auto-link OAuth accounts by email', async () => {
    const authConfigSource = await import('fs').then(fs =>
      fs.readFileSync('src/lib/auth/index.ts', 'utf-8')
    );

    // The signIn callback should not contain `user.id = existing.id` pattern
    // which auto-links OAuth users to existing accounts
    expect(authConfigSource).not.toMatch(/user\.id\s*=\s*existing\.id/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/auth-config.test.ts`
Expected: FAIL — source still contains `allowDangerousEmailAccountLinking: true`

- [ ] **Step 3: Remove dangerous linking from all 4 providers**

In `app/src/lib/auth/index.ts`:

Remove `allowDangerousEmailAccountLinking: true` from Apple (line 33), Google (line 38), MicrosoftEntraID (line 43), and Facebook (line 48).

Each provider block should just be:
```typescript
Apple({
  clientId: process.env.APPLE_CLIENT_ID!,
  clientSecret: process.env.APPLE_CLIENT_SECRET!,
}),
```

- [ ] **Step 4: Update signIn callback to reject duplicate emails instead of auto-linking**

In the `signIn` callback (around line 98-104), replace:
```typescript
async signIn({ user, account }) {
  if (account?.type === 'oauth' && user.email) {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, user.email),
    });
    if (existing) {
      user.id = existing.id;
    }
  }
  return true;
},
```

With:
```typescript
async signIn({ user, account }) {
  if (account?.type === 'oauth' && user.email) {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, user.email),
      columns: { id: true },
    });
    if (existing) {
      // Reject sign-in: user must use their original auth method
      return false;
    }
  }
  return true;
},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/auth-config.test.ts`
Expected: 2 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `cd app && npx vitest run`
Expected: 718+ tests PASS, 0 FAIL

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/auth/index.ts app/tests/unit/auth-config.test.ts
git commit -m "fix(security): disable OAuth dangerous email linking, reject duplicate emails"
```

---

### Task 5: Remove plaintext password reset token fallback

**Files:**
- Modify: `app/src/lib/email/password-reset.ts`
- Modify: `app/tests/integration/token-storage.test.ts`

- [ ] **Step 1: Fix `verifyPasswordResetToken` — remove plaintext fallback**

In `app/src/lib/email/password-reset.ts`, replace lines 31-40:

```typescript
export async function verifyPasswordResetToken(token: string): Promise<string | null> {
  const now = new Date();
  const tokenHash = hashToken(token);

  const tokenRecord = await db.query.passwordResetTokens.findFirst({
    where: or(
      eq(schema.passwordResetTokens.token, tokenHash),
      eq(schema.passwordResetTokens.token, token),
    ),
  });
```

With:

```typescript
export async function verifyPasswordResetToken(token: string): Promise<string | null> {
  const now = new Date();
  const tokenHash = hashToken(token);

  const tokenRecord = await db.query.passwordResetTokens.findFirst({
    where: eq(schema.passwordResetTokens.token, tokenHash),
  });
```

- [ ] **Step 2: Fix `consumePasswordResetToken` — remove plaintext fallback**

In `app/src/lib/email/password-reset.ts`, replace lines 54-62:

```typescript
export async function consumePasswordResetToken(token: string): Promise<void> {
  try {
    const tokenHash = hashToken(token);
    await db.delete(schema.passwordResetTokens).where(
      or(
        eq(schema.passwordResetTokens.token, tokenHash),
        eq(schema.passwordResetTokens.token, token),
      ),
    );
```

With:

```typescript
export async function consumePasswordResetToken(token: string): Promise<void> {
  try {
    const tokenHash = hashToken(token);
    await db.delete(schema.passwordResetTokens).where(
      eq(schema.passwordResetTokens.token, tokenHash),
    );
```

Also remove the `or` import from `drizzle-orm` on line 2 if no longer used elsewhere in the file.

- [ ] **Step 3: Update the test to expect hashed-only behavior**

In `app/tests/integration/token-storage.test.ts`, replace the test at line 67:

```typescript
it('accepts legacy plaintext password reset tokens during rollout', async () => {
```

With:

```typescript
it('rejects plaintext password reset tokens (only hashed accepted)', async () => {
    const findFirst = vi.fn().mockResolvedValue(null); // Hash won't match plaintext

    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          passwordResetTokens: { findFirst },
        },
      },
      schema: {
        passwordResetTokens: {
          token: 'token',
          id: 'id',
        },
      },
    }));

    const { verifyPasswordResetToken } = await import('@/lib/email/password-reset');
    const userId = await verifyPasswordResetToken('legacy-plaintext-token');

    expect(userId).toBeNull();
    expect(findFirst).toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run tests/integration/token-storage.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/email/password-reset.ts app/tests/integration/token-storage.test.ts
git commit -m "fix(security): remove plaintext password reset token acceptance"
```

---

### Task 6: Fix project detail RLS bypass

**Files:**
- Modify: `app/src/app/api/v1/projects/[id]/route.ts`

- [ ] **Step 1: Fix the RLS-bypassed query**

In `app/src/app/api/v1/projects/[id]/route.ts`, replace lines 47-54:

```typescript
    // Load latest project_documents metadata (submission dossier lives here)
    const [latestDoc] = await db
      .select({ metadata: projectDocuments.metadata })
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, project.id))
      .orderBy(desc(projectDocuments.version))
      .limit(1)
```

With:

```typescript
    // Load latest project_documents metadata (submission dossier lives here)
    const [latestDoc] = await withUserRLS(user.id, async (tx) => {
      return tx
        .select({ metadata: projectDocuments.metadata })
        .from(projectDocuments)
        .where(eq(projectDocuments.projectId, project.id))
        .orderBy(desc(projectDocuments.version))
        .limit(1);
    });
```

Note: `withUserRLS` is already imported on line 6.

- [ ] **Step 2: Run full test suite**

Run: `cd app && npx vitest run`
Expected: 718+ tests PASS, 0 FAIL

- [ ] **Step 3: Commit**

```bash
git add app/src/app/api/v1/projects/[id]/route.ts
git commit -m "fix(security): wrap projectDocuments query in withUserRLS"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean (0 errors)

- [ ] **Step 2: Run full test suite**

Run: `cd app && npx vitest run`
Expected: All tests PASS (718+), 0 FAIL

- [ ] **Step 3: Run lint**

Run: `cd app && npm run lint`
Expected: No new lint errors introduced

- [ ] **Step 4: Verify the org IDOR is fixed by reading the changed files**

Manually verify that:
- `organizations/[id]/route.ts` — all 3 handlers use `requireOrgMembership()`
- `organizations/[id]/members/route.ts` — all 3 handlers use `requireOrgMembership()`
- `organizations/[id]/approvals/route.ts` — both handlers use `requireOrgMembership()`
- `organizations/[id]/verify/route.ts` — POST uses `requireOrgMembership()`
- `organizations/[id]/ai-reviews/route.ts` — both handlers use `requireOrgMembership()`
- `auth/index.ts` — no `allowDangerousEmailAccountLinking: true` anywhere
- `password-reset.ts` — no `or()` in token queries
- `projects/[id]/route.ts` — `projectDocuments` query wrapped in `withUserRLS()`

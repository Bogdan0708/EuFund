# Session-to-Project Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-flow project drafts visible by promoting `agent_sessions` rows into `projects` rows whenever a call is committed to, and backfill the existing 11 promotable orphans.

**Architecture:** New `ensureProjectForSession(ctx, sessionId, opts?)` helper runs inside a single transaction with `SELECT … FOR UPDATE` on `agent_sessions`. Three cases: fresh promotion, already-linked no-op, call-change resync. A `DryRunRollback` sentinel enables identical-code-path dry-run by throwing-then-catching to roll back the transaction. Live trigger sites (`initializeSession`, `setSelectedCall`) call it post-write, wrapped in try/catch — promotion failure is logged but never breaks the parent flow. A one-shot `app/scripts/backfill-session-projects.ts` invokes the same helper for the operator-driven historical backfill.

**Tech Stack:** TypeScript, Drizzle ORM (postgres.js), Vitest with mocked DB, Next.js 14 App Router, existing `withUserRLS` wrapper.

**Spec:** `docs/superpowers/specs/2026-05-02-session-to-project-promotion-design.md` (commit b65c212).

---

## File Map (read this before starting)

| Path | Verb | Responsibility |
|---|---|---|
| `app/src/lib/projects/org-resolver.ts` | CREATE | `resolveProjectOrgIdInTx(tx, userId, requestedOrgId?)` — extracted core; reusable inside any tx. |
| `app/src/lib/projects/promotion.ts` | CREATE | `ensureProjectForSession`, `deriveProjectTitle`, `resolveCallForId`, `DryRunRollback`, types. |
| `app/src/app/api/v1/projects/route.ts` | MODIFY | Replace inline `resolveProjectOrgId` with a thin wrapper around the extracted core. |
| `app/src/lib/legal/audit.ts` | MODIFY | Add `'project.promoted_from_session'` to the `AuditAction` union. |
| `app/src/lib/monitoring/metrics.ts` | MODIFY | Register `project_promotion_total` counter, export `trackProjectPromotion(outcome)`. |
| `app/src/lib/ai/agent/services/preselect.ts` | MODIFY | Thread `requestId` into `InitializeSessionParams`, call helper after insert, extend `InitializeSessionResult` with `projectId`. |
| `app/src/lib/ai/agent/services/application.ts` | MODIFY | Reshape `setSelectedCall` into three branches; call helper post-CAS; extend return shape. |
| `app/src/app/api/v1/projects/preselect/route.ts` | MODIFY | Forward `projectId` in all four `kind:'selected'` JSON responses; pass `requestId` into `initializeSession`. |
| `app/src/lib/preselect/client.ts` | MODIFY | Add `projectId?: string \| null` to `PreselectResponse.selected`. |
| `app/scripts/backfill-session-projects.ts` | CREATE | One-shot script with `--dry-run` (default) and `--confirm`; per-row tally; nonzero exit on failure. |
| `app/package.json` | MODIFY | Add `script:backfill-session-projects` npm entry. |
| `app/tests/unit/projects/org-resolver.test.ts` | CREATE | Unit on extracted org resolver. |
| `app/tests/unit/projects/derive-title.test.ts` | CREATE | Unit on `deriveProjectTitle` four-step fallback. |
| `app/tests/unit/projects/resolve-call.test.ts` | CREATE | Unit on three-prong call resolver + LIMIT 2 disambiguation. |
| `app/tests/integration/project-promotion-helper.test.ts` | CREATE | Helper end-to-end with mocked DB (fresh, already-linked, call-resync, dry-run, missing session/user). |
| `app/tests/integration/preselect-projectid-response.test.ts` | CREATE | Verifies `projectId` is present in preselect HTTP responses. |
| `app/tests/integration/set-selected-call-promotion.test.ts` | CREATE | Three-branch matrix on `setSelectedCall`. |
| `app/tests/unit/scripts/backfill-session-projects.test.ts` | CREATE | Script tally + exit-code behavior with mocked helper. |

---

## Conventions

- Every commit message has `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` on the last line. Use heredoc for safe formatting.
- No `--no-verify`, no `git add .`, no `git add -A`. Stage exact paths.
- Run from `app/` for npm/test commands; from repo root for git commands.
- After every code change: `cd app && npm run typecheck` must pass before commit. Lint failures are non-blocking but should be investigated.

---

### Task 1: Extract `resolveProjectOrgIdInTx` (refactor with parity)

**Files:**
- Create: `app/src/lib/projects/org-resolver.ts`
- Modify: `app/src/app/api/v1/projects/route.ts:18-68`
- Test: `app/tests/unit/projects/org-resolver.test.ts`

**Why first:** Pure refactor with no behavior change. Unblocks the helper (Task 7) which needs to call this from inside its own tx.

- [ ] **Step 1.1: Write the failing test**

```ts
// app/tests/unit/projects/org-resolver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';
import { FondEUError } from '@/lib/errors';

const findManyMock = vi.fn();
const insertReturningMock = vi.fn();
const insertMembersMock = vi.fn();

const tx = {
  query: { orgMembers: { findMany: findManyMock } },
  insert: vi.fn((table) => {
    if (String(table).includes('organizations') || (table as any)?.[Symbol.toStringTag] === 'organizations') {
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
  });

  it('throws FondEUError(CONFLICT) on multiple memberships without requestedOrgId', async () => {
    findManyMock.mockResolvedValueOnce([{ orgId: 'a' }, { orgId: 'b' }]);
    await expect(resolveProjectOrgIdInTx(tx, 'user-1')).rejects.toBeInstanceOf(FondEUError);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/projects/org-resolver.test.ts
```
Expected: FAIL with `Cannot find module '@/lib/projects/org-resolver'`.

- [ ] **Step 1.3: Create the extracted helper**

```ts
// app/src/lib/projects/org-resolver.ts
import { eq } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { organizations, orgMembers } from '@/lib/db/schema';
import { FondEUError } from '@/lib/errors';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Resolves the org context for a project create. Tx-aware so callers can
 * compose this with their own atomic write (e.g., session-to-project
 * promotion needs a Personal Workspace creation that rolls back on dry-run).
 *
 *   - Explicit requestedOrgId → returned verbatim (caller validates membership).
 *   - 1 membership            → that org.
 *   - 0 memberships           → auto-creates a Personal Workspace + admin org_member.
 *   - 2+ memberships          → throws FondEUError(CONFLICT, PROJECT_ORG_REQUIRED).
 */
export async function resolveProjectOrgIdInTx(
  tx: DbTransaction,
  userId: string,
  requestedOrgId?: string,
): Promise<string> {
  if (requestedOrgId) {
    return requestedOrgId;
  }

  const memberships = await tx.query.orgMembers.findMany({
    where: eq(orgMembers.userId, userId),
    columns: { orgId: true },
    limit: 2,
  });

  if (memberships.length === 1) {
    return memberships[0].orgId;
  }

  if (memberships.length === 0) {
    const [org] = await tx
      .insert(organizations)
      .values({ name: `Personal Workspace`, orgType: 'pfa' })
      .returning({ id: organizations.id });

    await tx.insert(orgMembers).values({
      userId,
      orgId: org.id,
      role: 'admin',
    });

    return org.id;
  }

  throw new FondEUError({
    code: 'CONFLICT',
    statusCode: 409,
    messageEn: 'A valid organization context is required to create a project.',
    messageRo: 'Este necesar contextul unei organizații valide pentru a crea proiectul.',
    details: { reason: 'PROJECT_ORG_REQUIRED' },
    retryable: false,
  });
}
```

- [ ] **Step 1.4: Run unit test to verify it passes**

```bash
cd app && npx vitest run tests/unit/projects/org-resolver.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 1.5: Replace inline `resolveProjectOrgId` in the projects route with a wrapper**

Replace lines 18-68 of `app/src/app/api/v1/projects/route.ts` (the existing `resolveProjectOrgId` function) with this thin wrapper. Add the import at the top of the file alongside the existing imports.

```ts
// at the top of the imports (after the existing imports)
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';

// replaces lines 18-68
async function resolveProjectOrgId(userId: string, requestedOrgId?: string): Promise<string> {
  return withUserRLS(userId, (tx) => resolveProjectOrgIdInTx(tx, userId, requestedOrgId));
}
```

Keep the imports of `organizations` and `orgMembers` only if other code in the file uses them. Verify by inspection: the GET handler uses `orgMembers` (line 80-85) — keep that import. `organizations` is no longer used here — drop it from the imports.

- [ ] **Step 1.6: Verify typecheck passes**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 1.7: Run the existing projects-route tests to confirm parity**

```bash
cd app && npx vitest run tests/integration/projects-route.test.ts 2>/dev/null || npx vitest run --grep "projects" 2>&1 | tail -30
```
Expected: existing tests (if any) pass unchanged. If no tests exist for this route, that's fine — typecheck + the new unit test cover correctness.

- [ ] **Step 1.8: Commit**

```bash
git add app/src/lib/projects/org-resolver.ts app/src/app/api/v1/projects/route.ts app/tests/unit/projects/org-resolver.test.ts
git commit -m "$(cat <<'EOF'
refactor(projects): extract resolveProjectOrgIdInTx for tx-aware reuse

Pulls the org resolution logic out of the projects route so the
upcoming session-to-project promotion helper can call it from inside
its own transaction. Behavior unchanged for existing callers — the
route's resolveProjectOrgId becomes a thin wrapper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `project.promoted_from_session` to AuditAction union

**Files:**
- Modify: `app/src/lib/legal/audit.ts:35-56`

- [ ] **Step 2.1: Add the union member**

In `app/src/lib/legal/audit.ts`, find the `// Project` block of the `AuditAction` union (lines 34-56). Insert the new line immediately after `| 'project.create'`:

```ts
  // Project
  | 'project.create'
  | 'project.promoted_from_session'
  | 'project.update'
  // ... rest unchanged
```

- [ ] **Step 2.2: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 2.3: Verify legal-basis routing is unchanged**

Open `app/src/lib/legal/audit.ts` and locate `inferLegalBasis`. Confirm visually that any `project.*` action resolves to `'contract'` (the function uses prefix matching). No code change needed — the new action inherits the prefix's existing routing.

- [ ] **Step 2.4: Commit**

```bash
git add app/src/lib/legal/audit.ts
git commit -m "$(cat <<'EOF'
feat(audit): allow project.promoted_from_session as audit action

Extends the AuditAction union so the upcoming session-to-project
promotion helper can emit audit entries via the canonical logAudit
path. The project.* prefix means inferLegalBasis still resolves to
'contract' with no new branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Register `project_promotion_total` metric

**Files:**
- Modify: `app/src/lib/monitoring/metrics.ts`

- [ ] **Step 3.1: Add the counter registration and helper**

After the existing counter registrations (around line 102 in the metrics module — the last `metrics.counter(...)` call), add:

```ts
metrics.counter('project_promotion_total', 'Session-to-project promotion outcomes');
```

Then, after the existing `trackXxx(...)` exports near the bottom of the file, add:

```ts
export function trackProjectPromotion(
  outcome:
    | 'promoted'
    | 'already_linked'
    | 'synced'
    | 'no_selected_call'
    | 'user_missing'
    | 'session_missing'
    | 'failed',
): void {
  metrics.inc('project_promotion_total', { outcome });
}
```

- [ ] **Step 3.2: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git add app/src/lib/monitoring/metrics.ts
git commit -m "$(cat <<'EOF'
feat(metrics): register project_promotion_total counter

Adds the counter and trackProjectPromotion(outcome) helper used by the
session-to-project promotion module. Single low-cardinality outcome
label across seven values (promoted/already_linked/synced and four
failure modes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Define types and DryRunRollback sentinel

**Files:**
- Create: `app/src/lib/projects/promotion.ts`

**Why a separate task:** Pure type/skeleton commit. Keeps later behavior commits focused on one branch each.

- [ ] **Step 4.1: Create the module skeleton**

```ts
// app/src/lib/projects/promotion.ts
//
// Session-to-project promotion. See spec:
//   docs/superpowers/specs/2026-05-02-session-to-project-promotion-design.md
//
// A projects row is the canonical project shell. An agent_session is an AI
// drafting workspace attached to that project via agent_sessions.project_id.
// This module owns the lifecycle transition that links the two.

import type { ServiceContext } from '@/lib/ai/agent/services/types';

export type CallResolution = 'id' | 'callCode' | 'externalId' | 'unresolved';
export type TitleSource = 'description' | 'messageSummary' | 'fallback';

export type PromotionResult =
  | {
      promoted: true;
      projectId: string;
      created: true;
      titleSource: TitleSource;
      selectedCallResolution: CallResolution;
    }
  | { promoted: true; projectId: string; created: false; synced: boolean }
  | { promoted: false; reason: 'NO_SELECTED_CALL' | 'USER_NOT_FOUND' | 'SESSION_NOT_FOUND' };

export interface EnsureOpts {
  dryRun?: boolean;
}

/**
 * Sentinel for dry-run rollback. Thrown inside the withUserRLS callback to
 * roll back the transaction while carrying the would-be result through the
 * outer catch.
 */
export class DryRunRollback<T> extends Error {
  constructor(public readonly carried: T) {
    super('dry-run rollback');
    this.name = 'DryRunRollback';
  }
}

export async function ensureProjectForSession(
  _ctx: ServiceContext,
  _sessionId: string,
  _opts: EnsureOpts = {},
): Promise<PromotionResult> {
  throw new Error('not implemented');
}
```

- [ ] **Step 4.2: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 4.3: Commit**

```bash
git add app/src/lib/projects/promotion.ts
git commit -m "$(cat <<'EOF'
feat(projects): scaffold session-to-project promotion module

Adds types and DryRunRollback sentinel for the upcoming
ensureProjectForSession helper. Body is a stub that throws — behavior
lands in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `deriveProjectTitle` (pure function, TDD)

**Files:**
- Modify: `app/src/lib/projects/promotion.ts`
- Test: `app/tests/unit/projects/derive-title.test.ts`

- [ ] **Step 5.1: Write the failing tests**

```ts
// app/tests/unit/projects/derive-title.test.ts
import { describe, it, expect } from 'vitest';
import { deriveProjectTitle } from '@/lib/projects/promotion';

const baseSession = {
  selectedCallId: 'CALL-ABC123XYZ',
  messageSummary: null as string | null,
  planningArtifact: null as { preselect?: { description?: string } } | null,
};

describe('deriveProjectTitle', () => {
  it('uses preselect.description when present (truncated to 120, normalized whitespace)', () => {
    const session = {
      ...baseSession,
      planningArtifact: {
        preselect: {
          description: '  We will  build  a  digital   platform   for   ' + 'x'.repeat(200),
        },
      },
    };
    const out = deriveProjectTitle(session, 'ro');
    expect(out.source).toBe('description');
    expect(out.title.length).toBeLessThanOrEqual(120);
    expect(out.title).not.toContain('  ');
    expect(out.title.startsWith('We will build a digital platform')).toBe(true);
  });

  it('falls back to messageSummary when description missing', () => {
    const session = {
      ...baseSession,
      messageSummary: 'Project summary text',
    };
    const out = deriveProjectTitle(session, 'ro');
    expect(out.source).toBe('messageSummary');
    expect(out.title).toBe('Project summary text');
  });

  it('falls back to messageSummary when description below MIN length', () => {
    const session = {
      ...baseSession,
      messageSummary: 'Project summary text',
      planningArtifact: { preselect: { description: 'too short' } },
    };
    const out = deriveProjectTitle(session, 'ro');
    expect(out.source).toBe('messageSummary');
  });

  it('uses Romanian fallback when both are missing (ro locale)', () => {
    const out = deriveProjectTitle(baseSession, 'ro');
    expect(out.source).toBe('fallback');
    expect(out.title).toBe('Proiect nou — CALL-ABC123');
  });

  it('uses English fallback when both are missing (en locale)', () => {
    const out = deriveProjectTitle(baseSession, 'en');
    expect(out.source).toBe('fallback');
    expect(out.title).toBe('Untitled project — CALL-ABC123');
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
cd app && npx vitest run tests/unit/projects/derive-title.test.ts
```
Expected: FAIL with `deriveProjectTitle is not exported`.

- [ ] **Step 5.3: Implement `deriveProjectTitle`**

Add to `app/src/lib/projects/promotion.ts` (above `ensureProjectForSession`):

```ts
import { MIN_DESCRIPTION_LENGTH } from '@/lib/ai/agent/services/preselect';

const TITLE_MAX_LEN = 120;

/** Minimal shape used by the title derivation; kept narrow on purpose. */
export interface SessionForTitle {
  selectedCallId: string;
  messageSummary: string | null;
  planningArtifact: { preselect?: { description?: string } } | null;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd();
}

export function deriveProjectTitle(
  session: SessionForTitle,
  locale: 'ro' | 'en',
): { title: string; source: TitleSource } {
  const desc = session.planningArtifact?.preselect?.description;
  if (typeof desc === 'string') {
    const normalized = normalizeWhitespace(desc);
    if (normalized.length >= MIN_DESCRIPTION_LENGTH) {
      return { title: truncate(normalized, TITLE_MAX_LEN), source: 'description' };
    }
  }

  const summary = session.messageSummary;
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return { title: truncate(normalizeWhitespace(summary), TITLE_MAX_LEN), source: 'messageSummary' };
  }

  const idFragment = session.selectedCallId.slice(0, 12);
  const title = locale === 'en'
    ? `Untitled project — ${idFragment}`
    : `Proiect nou — ${idFragment}`;
  return { title, source: 'fallback' };
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/unit/projects/derive-title.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add app/src/lib/projects/promotion.ts app/tests/unit/projects/derive-title.test.ts
git commit -m "$(cat <<'EOF'
feat(projects): deriveProjectTitle four-step fallback

Pure helper for picking a project title at promotion time:
preselect.description → messageSummary → locale-aware placeholder.
Truncates to 120 chars, normalizes whitespace, gates on
MIN_DESCRIPTION_LENGTH so a one-word description doesn't become
the project name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `resolveCallForId` three-prong probe (TDD)

**Files:**
- Modify: `app/src/lib/projects/promotion.ts`
- Test: `app/tests/unit/projects/resolve-call.test.ts`

- [ ] **Step 6.1: Write the failing tests**

```ts
// app/tests/unit/projects/resolve-call.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveCallForId } from '@/lib/projects/promotion';

vi.mock('@/lib/db/schema', () => ({
  callsForProposals: {
    id: 'calls.id',
    callCode: 'calls.call_code',
    externalId: 'calls.external_id',
    titleRo: 'calls.title_ro',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c: any, v: any) => ({ kind: 'eq', c, v })),
  sql: vi.fn(),
}));

function makeTx(rowsByPredicate: Record<string, Array<{ id: string; titleRo: string | null }>>) {
  const calls: Array<{ predicateKey: string; limit: number }> = [];
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((pred: any) => ({
          limit: vi.fn(async (n: number) => {
            const key = JSON.stringify(pred);
            calls.push({ predicateKey: key, limit: n });
            return rowsByPredicate[key] ?? [];
          }),
        })),
      })),
    })),
  } as any;
  return { tx, calls };
}

const UUID = '11111111-1111-4111-8111-111111111111';

describe('resolveCallForId', () => {
  it('matches by id when input is a UUID and a row exists (resolution=id)', async () => {
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.id', v: UUID })]: [{ id: UUID, titleRo: 'Call A' }],
    });
    const out = await resolveCallForId(tx, UUID);
    expect(out).toEqual({ id: UUID, title: 'Call A', resolution: 'id' });
  });

  it('falls through to callCode when UUID prong misses', async () => {
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.call_code', v: UUID })]: [
        { id: 'real-uuid', titleRo: 'Call B' },
      ],
    });
    const out = await resolveCallForId(tx, UUID);
    expect(out).toEqual({ id: 'real-uuid', title: 'Call B', resolution: 'callCode' });
  });

  it('skips id prong entirely when input is not UUID-shaped', async () => {
    const { tx, calls } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.call_code', v: 'CODE-123' })]: [
        { id: 'cc-id', titleRo: 'Call C' },
      ],
    });
    const out = await resolveCallForId(tx, 'CODE-123');
    expect(out.resolution).toBe('callCode');
    const idProbeRan = calls.some((c) => c.predicateKey.includes('calls.id'));
    expect(idProbeRan).toBe(false);
  });

  it('returns externalId match when exactly one row exists (LIMIT 2)', async () => {
    const { tx, calls } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.external_id', v: 'EXT-1' })]: [
        { id: 'ext-id', titleRo: 'Call D' },
      ],
    });
    const out = await resolveCallForId(tx, 'EXT-1');
    expect(out).toEqual({ id: 'ext-id', title: 'Call D', resolution: 'externalId' });
    const externalCall = calls.find((c) => c.predicateKey.includes('calls.external_id'));
    expect(externalCall?.limit).toBe(2);
  });

  it('returns unresolved when externalId matches multiple rows', async () => {
    const { tx } = makeTx({
      [JSON.stringify({ kind: 'eq', c: 'calls.external_id', v: 'EXT-DUPE' })]: [
        { id: 'a', titleRo: 'A' },
        { id: 'b', titleRo: 'B' },
      ],
    });
    const out = await resolveCallForId(tx, 'EXT-DUPE');
    expect(out).toEqual({ id: null, title: null, resolution: 'unresolved' });
  });

  it('returns unresolved when no prong matches', async () => {
    const { tx } = makeTx({});
    const out = await resolveCallForId(tx, 'UNKNOWN');
    expect(out).toEqual({ id: null, title: null, resolution: 'unresolved' });
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
cd app && npx vitest run tests/unit/projects/resolve-call.test.ts
```
Expected: FAIL with `resolveCallForId is not exported`.

- [ ] **Step 6.3: Implement the resolver**

Add to `app/src/lib/projects/promotion.ts` (above `ensureProjectForSession`, alongside `deriveProjectTitle`):

```ts
import { eq } from 'drizzle-orm';
import { callsForProposals } from '@/lib/db/schema';
import { UUID_RE } from '@/lib/validators/patterns';
import type { Database } from '@/lib/db';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ResolveCallResult {
  id: string | null;
  title: string | null;
  resolution: CallResolution;
}

/**
 * Three-prong probe against calls_for_proposals.
 *   1. id (only if input matches UUID_RE)
 *   2. call_code (globally unique per schema.ts:300)
 *   3. external_id (NOT globally unique — uniqueness is per source_connector_id;
 *      LIMIT 2 + exact-one check; multi-match → unresolved to avoid linking the
 *      wrong FK)
 */
export async function resolveCallForId(
  tx: DbTransaction,
  rawSelectedCallId: string,
): Promise<ResolveCallResult> {
  if (UUID_RE.test(rawSelectedCallId)) {
    const rows = await tx
      .select({ id: callsForProposals.id, titleRo: callsForProposals.titleRo })
      .from(callsForProposals)
      .where(eq(callsForProposals.id, rawSelectedCallId))
      .limit(1);
    if (rows.length === 1) {
      return { id: rows[0].id, title: rows[0].titleRo, resolution: 'id' };
    }
  }

  const codeRows = await tx
    .select({ id: callsForProposals.id, titleRo: callsForProposals.titleRo })
    .from(callsForProposals)
    .where(eq(callsForProposals.callCode, rawSelectedCallId))
    .limit(1);
  if (codeRows.length === 1) {
    return { id: codeRows[0].id, title: codeRows[0].titleRo, resolution: 'callCode' };
  }

  const extRows = await tx
    .select({ id: callsForProposals.id, titleRo: callsForProposals.titleRo })
    .from(callsForProposals)
    .where(eq(callsForProposals.externalId, rawSelectedCallId))
    .limit(2);
  if (extRows.length === 1) {
    return { id: extRows[0].id, title: extRows[0].titleRo, resolution: 'externalId' };
  }

  return { id: null, title: null, resolution: 'unresolved' };
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/unit/projects/resolve-call.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add app/src/lib/projects/promotion.ts app/tests/unit/projects/resolve-call.test.ts
git commit -m "$(cat <<'EOF'
feat(projects): resolveCallForId three-prong probe

Probes calls_for_proposals by id (UUID-only), then call_code, then
external_id. The external_id branch uses LIMIT 2 with an exact-one
check — external_id is unique only per source_connector_id, so a
multi-match must return unresolved rather than linking the wrong FK.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ensureProjectForSession` — fresh promotion branch (TDD)

**Files:**
- Modify: `app/src/lib/projects/promotion.ts`
- Test: `app/tests/integration/project-promotion-helper.test.ts`

**Spec reference:** Steps 1, 2, B1–B6, 8 (commit), 9 (audit) of the transaction shape.

- [ ] **Step 7.1: Write the failing test (fresh-promotion happy path)**

```ts
// app/tests/integration/project-promotion-helper.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionRow = {
  id: 'sess-1',
  user_id: 'user-1',
  project_id: null,
  selected_call_id: 'CODE-123',
  locale: 'ro',
  message_summary: null,
  planning_artifact: { preselect: { description: 'A '.repeat(60) + 'long enough description' } },
};

const txState: any = {};
const projectInsertRows: Array<any> = [];
const sessionUpdates: Array<any> = [];

function buildTx() {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async (_n: number) => {
            // first SELECT: agent_sessions FOR UPDATE
            // second SELECT: users existence check
            // third+: call resolver — will be tested in dedicated tests
            const phase = txState.selectPhase ?? 'session';
            if (phase === 'session') {
              txState.selectPhase = 'user';
              return [sessionRow];
            }
            if (phase === 'user') {
              txState.selectPhase = 'call';
              return [{ id: 'user-1' }];
            }
            return [];
          }),
          for: vi.fn(() => ({
            limit: vi.fn(async () => [sessionRow]),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: any) => {
        projectInsertRows.push(row);
        return { returning: vi.fn(async () => [{ id: 'new-proj-1' }]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((row: any) => {
        sessionUpdates.push(row);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    query: { orgMembers: { findMany: vi.fn(async () => [{ orgId: 'org-1' }]) } },
  } as any;
}

vi.mock('@/lib/db', () => {
  const tx = buildTx();
  return {
    withUserRLS: vi.fn(async (_uid: string, fn: (t: any) => Promise<any>) => fn(tx)),
  };
});
vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'sess.id', userId: 'sess.user_id', projectId: 'sess.project_id', selectedCallId: 'sess.selected_call_id', locale: 'sess.locale', messageSummary: 'sess.message_summary', planningArtifact: 'sess.planning_artifact', updatedAt: 'sess.updated_at' },
  projects: { id: 'projects.id', metadata: 'projects.metadata', callId: 'projects.call_id', updatedAt: 'projects.updated_at' },
  users: { id: 'users.id' },
  callsForProposals: { id: 'calls.id', callCode: 'calls.call_code', externalId: 'calls.external_id', titleRo: 'calls.title_ro' },
  organizations: { id: 'org.id' },
  orgMembers: { userId: 'om.user_id', orgId: 'om.org_id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c: any, v: any) => ({ kind: 'eq', c, v })),
  and: vi.fn((...preds: any[]) => ({ kind: 'and', preds })),
  sql: vi.fn(),
}));
vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/monitoring/metrics', () => ({
  trackProjectPromotion: vi.fn(),
}));
vi.mock('@/lib/validators/patterns', () => ({ UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i }));

import { ensureProjectForSession } from '@/lib/projects/promotion';
import { logAudit } from '@/lib/legal/audit';
import { trackProjectPromotion } from '@/lib/monitoring/metrics';

const ctx = {
  userId: 'user-1',
  sessionId: 'sess-1',
  requestId: 'req-1',
  now: new Date('2026-05-02T00:00:00Z'),
} as any;

describe('ensureProjectForSession — fresh promotion', () => {
  beforeEach(() => {
    txState.selectPhase = 'session';
    projectInsertRows.length = 0;
    sessionUpdates.length = 0;
    vi.clearAllMocks();
  });

  it('promotes a session with selectedCallId and null projectId', async () => {
    const out = await ensureProjectForSession(ctx, 'sess-1');
    expect(out).toMatchObject({
      promoted: true,
      created: true,
      projectId: 'new-proj-1',
      selectedCallResolution: expect.any(String),
      titleSource: expect.any(String),
    });
    expect(projectInsertRows).toHaveLength(1);
    expect(sessionUpdates).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.promoted_from_session',
      resourceType: 'project',
      resourceId: 'new-proj-1',
    }));
    expect(trackProjectPromotion).toHaveBeenCalledWith('promoted');
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/integration/project-promotion-helper.test.ts
```
Expected: FAIL — current `ensureProjectForSession` throws "not implemented".

- [ ] **Step 7.3: Implement the fresh-promotion path**

Replace the stub `ensureProjectForSession` in `app/src/lib/projects/promotion.ts` with the full implementation. Add the imports.

```ts
// imports at the top of the file (in addition to what's already there)
import { and, eq, sql } from 'drizzle-orm';
import { withUserRLS } from '@/lib/db';
import { agentSessions, projects, users } from '@/lib/db/schema';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { trackProjectPromotion } from '@/lib/monitoring/metrics';
import { resolveProjectOrgIdInTx } from '@/lib/projects/org-resolver';

const log = logger.child({ component: 'project-promotion' });

interface PendingAudit {
  kind: 'promoted' | 'call_resynced';
  projectId: string;
  rawSelectedCallId: string;
  resolvedCallId: string | null;
  selectedCallResolution: CallResolution;
  titleSource?: TitleSource;
}

export async function ensureProjectForSession(
  ctx: ServiceContext,
  sessionId: string,
  opts: EnsureOpts = {},
): Promise<PromotionResult> {
  const { userId, requestId } = ctx;
  let pendingAudit: PendingAudit | null = null;

  try {
    const result = await withUserRLS(userId, async (tx) => {
      // Step 1 — lock session, ownership-checked
      const sessionRows = await tx
        .select({
          id: agentSessions.id,
          userId: agentSessions.userId,
          projectId: agentSessions.projectId,
          selectedCallId: agentSessions.selectedCallId,
          locale: agentSessions.locale,
          messageSummary: agentSessions.messageSummary,
          planningArtifact: agentSessions.planningArtifact,
        })
        .from(agentSessions)
        .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
        .for('update')
        .limit(1);

      if (sessionRows.length === 0) {
        return { promoted: false, reason: 'SESSION_NOT_FOUND' as const };
      }
      const session = sessionRows[0];

      if (session.projectId === null && session.selectedCallId === null) {
        return { promoted: false, reason: 'NO_SELECTED_CALL' as const };
      }

      if (session.projectId !== null) {
        // Branch A: already linked. Implemented in Task 8.
        throw new Error('already-linked branch not yet implemented (Task 8)');
      }

      // Branch B: fresh promotion
      const userRows = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (userRows.length === 0) {
        return { promoted: false, reason: 'USER_NOT_FOUND' as const };
      }

      const orgId = await resolveProjectOrgIdInTx(tx, userId);

      const callResult = await resolveCallForId(tx, session.selectedCallId!);
      const titleResult = deriveProjectTitle(
        {
          selectedCallId: session.selectedCallId!,
          messageSummary: session.messageSummary,
          planningArtifact: session.planningArtifact as { preselect?: { description?: string } } | null,
        },
        session.locale as 'ro' | 'en',
      );

      const [created] = await tx
        .insert(projects)
        .values({
          orgId,
          userId,
          callId: callResult.id,
          createdBy: userId,
          title: titleResult.title,
          status: 'ciorna',
          currentVersion: 1,
          metadata: {
            agentSessionId: sessionId,
            rawSelectedCallId: session.selectedCallId!,
            resolvedCallTitle: callResult.title,
            titleSource: titleResult.source,
            selectedCallResolution: callResult.resolution,
            promotedAt: ctx.now.toISOString(),
          },
        })
        .returning({ id: projects.id });

      await tx
        .update(agentSessions)
        .set({ projectId: created.id, updatedAt: new Date() })
        .where(eq(agentSessions.id, sessionId));

      pendingAudit = {
        kind: 'promoted',
        projectId: created.id,
        rawSelectedCallId: session.selectedCallId!,
        resolvedCallId: callResult.id,
        selectedCallResolution: callResult.resolution,
        titleSource: titleResult.source,
      };

      const promotionResult: PromotionResult = {
        promoted: true,
        projectId: created.id,
        created: true,
        titleSource: titleResult.source,
        selectedCallResolution: callResult.resolution,
      };

      // Step 8 — dry-run sentinel. Implemented in Task 9.
      if (opts.dryRun) {
        throw new Error('dry-run not yet implemented (Task 9)');
      }

      return promotionResult;
    });

    // Step 9 — post-commit audit + metric
    if (pendingAudit) {
      await logAudit({
        userId,
        action: 'project.promoted_from_session',
        resourceType: 'project',
        resourceId: pendingAudit.projectId,
        metadata: {
          agentSessionId: sessionId,
          rawSelectedCallId: pendingAudit.rawSelectedCallId,
          resolvedCallId: pendingAudit.resolvedCallId,
          selectedCallResolution: pendingAudit.selectedCallResolution,
          titleSource: pendingAudit.titleSource,
          kind: pendingAudit.kind,
          requestId,
        },
      });
    }

    if (result.promoted) {
      const outcome = result.created ? 'promoted' : ((result as any).synced ? 'synced' : 'already_linked');
      trackProjectPromotion(outcome as any);
      log.info({ sessionId, projectId: result.projectId, outcome }, 'session promoted');
    } else {
      const map = {
        NO_SELECTED_CALL: 'no_selected_call',
        USER_NOT_FOUND: 'user_missing',
        SESSION_NOT_FOUND: 'session_missing',
      } as const;
      trackProjectPromotion(map[result.reason]);
      log.warn({ sessionId, reason: result.reason }, 'session not promotable');
    }

    return result;
  } catch (e) {
    log.error({ sessionId, error: e instanceof Error ? e.message : String(e) }, 'promotion failed');
    throw e;
  }
}
```

- [ ] **Step 7.4: Run the fresh-promotion test to verify it passes**

```bash
cd app && npx vitest run tests/integration/project-promotion-helper.test.ts
```
Expected: the fresh-promotion test passes.

- [ ] **Step 7.5: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 7.6: Commit**

```bash
git add app/src/lib/projects/promotion.ts app/tests/integration/project-promotion-helper.test.ts
git commit -m "$(cat <<'EOF'
feat(projects): ensureProjectForSession fresh-promotion path

Implements the locked-and-decide flow for promoting an agent_session
to a projects row when the session has selectedCallId set and no
linked project. Audit + metric emitted post-commit. Already-linked
and dry-run branches stubbed; covered in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Already-linked branch (no-op + call-resync)

**Files:**
- Modify: `app/src/lib/projects/promotion.ts`
- Modify: `app/tests/integration/project-promotion-helper.test.ts`

- [ ] **Step 8.1: Write failing tests for the already-linked branch**

Append to `app/tests/integration/project-promotion-helper.test.ts`:

```ts
describe('ensureProjectForSession — already linked', () => {
  beforeEach(() => {
    txState.selectPhase = 'session';
    vi.clearAllMocks();
  });

  it('returns synced=false when callId matches project metadata.rawSelectedCallId', async () => {
    sessionRow.project_id = 'existing-proj';
    sessionRow.selected_call_id = 'CODE-123';
    txState.projectRow = {
      id: 'existing-proj',
      metadata: { rawSelectedCallId: 'CODE-123', resolvedCallTitle: 'Call X' },
      call_id: 'old-call-uuid',
    };
    const out = await ensureProjectForSession(ctx, 'sess-1');
    expect(out).toMatchObject({ promoted: true, created: false, synced: false, projectId: 'existing-proj' });
    expect(logAudit).not.toHaveBeenCalled();
    expect(trackProjectPromotion).toHaveBeenCalledWith('already_linked');
    sessionRow.project_id = null;
  });

  it('syncs project.callId + metadata when session.selectedCallId differs', async () => {
    sessionRow.project_id = 'existing-proj';
    sessionRow.selected_call_id = 'NEW-CODE-999';
    txState.projectRow = {
      id: 'existing-proj',
      metadata: { rawSelectedCallId: 'CODE-123', resolvedCallTitle: 'Call X', existingExtra: 'keep-me' },
      call_id: 'old-call-uuid',
    };
    const out = await ensureProjectForSession(ctx, 'sess-1');
    expect(out).toMatchObject({ promoted: true, created: false, synced: true, projectId: 'existing-proj' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.promoted_from_session',
      metadata: expect.objectContaining({ kind: 'call_resynced' }),
    }));
    expect(trackProjectPromotion).toHaveBeenCalledWith('synced');
    sessionRow.project_id = null;
  });
});
```

The test scaffolding above expects the `tx` to expose the project lock SELECT. Update the `buildTx()` factory to also return `txState.projectRow` when the second `select` chain queries `projects` — augment the factory:

```ts
// inside buildTx(), replace the existing tx.select with a smarter version:
select: vi.fn(() => ({
  from: vi.fn((table: any) => ({
    where: vi.fn(() => ({
      limit: vi.fn(async (_n: number) => {
        const phase = txState.selectPhase ?? 'session';
        if (phase === 'session') {
          txState.selectPhase = sessionRow.project_id ? 'project_lock' : 'user';
          return [sessionRow];
        }
        if (phase === 'project_lock') {
          txState.selectPhase = 'call';
          return [txState.projectRow];
        }
        if (phase === 'user') {
          txState.selectPhase = 'call';
          return [{ id: 'user-1' }];
        }
        return [];
      }),
      for: vi.fn(() => ({
        limit: vi.fn(async () => {
          const phase = txState.selectPhase ?? 'session';
          if (phase === 'session') {
            txState.selectPhase = sessionRow.project_id ? 'project_lock' : 'user';
            return [sessionRow];
          }
          if (phase === 'project_lock') {
            txState.selectPhase = 'call';
            return [txState.projectRow];
          }
          return [];
        }),
      })),
    })),
  })),
})),
```

- [ ] **Step 8.2: Run tests to verify they fail**

```bash
cd app && npx vitest run tests/integration/project-promotion-helper.test.ts
```
Expected: the two new tests fail (current code throws `already-linked branch not yet implemented`).

- [ ] **Step 8.3: Implement the already-linked branch**

In `app/src/lib/projects/promotion.ts`, replace the `throw new Error('already-linked branch not yet implemented (Task 8)');` line with the full Branch A logic:

```ts
if (session.projectId !== null) {
  // Branch A: already linked. Lock the project row and check whether the
  // session's selectedCallId still matches what we recorded at promotion time.
  const projectRows = await tx
    .select({
      id: projects.id,
      metadata: projects.metadata,
      callId: projects.callId,
    })
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .for('update')
    .limit(1);
  if (projectRows.length === 0) {
    // Project row vanished (hard-deleted somehow). Treat as session_missing
    // for telemetry — there is nothing to sync into.
    return { promoted: false, reason: 'SESSION_NOT_FOUND' as const };
  }
  const project = projectRows[0];
  const existingMetadata = (project.metadata ?? {}) as Record<string, unknown>;
  const recordedCallId = existingMetadata.rawSelectedCallId as string | undefined;

  if (recordedCallId === session.selectedCallId) {
    // True no-op
    return { promoted: true, projectId: project.id, created: false, synced: false };
  }

  // Either the session's call changed, or the metadata never recorded one
  // (defensive: project was linked by some other code path).
  const callResult = await resolveCallForId(tx, session.selectedCallId!);
  await tx
    .update(projects)
    .set({
      callId: callResult.id,
      metadata: {
        ...existingMetadata,
        agentSessionId: sessionId,
        rawSelectedCallId: session.selectedCallId,
        resolvedCallTitle: callResult.title,
        selectedCallResolution: callResult.resolution,
        // promotedAt deliberately preserved from existing metadata
      },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id));

  pendingAudit = {
    kind: 'call_resynced',
    projectId: project.id,
    rawSelectedCallId: session.selectedCallId!,
    resolvedCallId: callResult.id,
    selectedCallResolution: callResult.resolution,
  };

  return { promoted: true, projectId: project.id, created: false, synced: true };
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/integration/project-promotion-helper.test.ts
```
Expected: all tests pass (fresh-promotion + 2 already-linked).

- [ ] **Step 8.5: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 8.6: Commit**

```bash
git add app/src/lib/projects/promotion.ts app/tests/integration/project-promotion-helper.test.ts
git commit -m "$(cat <<'EOF'
feat(projects): already-linked + call-resync branches in promotion helper

Adds Branch A handling: project row locked via FOR UPDATE, comparison
against project.metadata.rawSelectedCallId. True no-op when matching;
sync of project.callId + metadata (preserving existing keys, leaving
promotedAt frozen) when the session's selectedCallId has changed.
Audit fires with kind: 'call_resynced'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Dry-run via DryRunRollback sentinel

**Files:**
- Modify: `app/src/lib/projects/promotion.ts`
- Modify: `app/tests/integration/project-promotion-helper.test.ts`

- [ ] **Step 9.1: Write failing test**

Append to the integration test file:

```ts
describe('ensureProjectForSession — dry run', () => {
  beforeEach(() => {
    txState.selectPhase = 'session';
    sessionRow.project_id = null;
    sessionRow.selected_call_id = 'CODE-123';
    projectInsertRows.length = 0;
    sessionUpdates.length = 0;
    vi.clearAllMocks();
  });

  it('returns the would-be result without committing audit or metric', async () => {
    const out = await ensureProjectForSession(ctx, 'sess-1', { dryRun: true });
    expect(out).toMatchObject({ promoted: true, created: true, projectId: 'new-proj-1' });
    expect(logAudit).not.toHaveBeenCalled();
    expect(trackProjectPromotion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/integration/project-promotion-helper.test.ts
```
Expected: FAIL — current code throws `dry-run not yet implemented`.

- [ ] **Step 9.3: Implement DryRunRollback wiring**

In `app/src/lib/projects/promotion.ts`, find the section near the bottom of the inner callback that currently reads:

```ts
      // Step 8 — dry-run sentinel. Implemented in Task 9.
      if (opts.dryRun) {
        throw new Error('dry-run not yet implemented (Task 9)');
      }

      return promotionResult;
```

Replace with:

```ts
      if (opts.dryRun) {
        throw new DryRunRollback(promotionResult);
      }

      return promotionResult;
```

The same treatment applies to the already-linked sync branch's return — extract the result building and apply DryRunRollback before return. To keep the function readable, restructure the inner callback's return path so every branch goes through a single `return result` seam, with `if (opts.dryRun) throw new DryRunRollback(result)` immediately before. Concretely, replace the two `return { promoted: true, ... }` lines in Branch A with:

```ts
  // (no-op branch)
  const result: PromotionResult = { promoted: true, projectId: project.id, created: false, synced: false };
  if (opts.dryRun) throw new DryRunRollback(result);
  return result;

  // (sync branch — after the UPDATE and pendingAudit assignment)
  const result: PromotionResult = { promoted: true, projectId: project.id, created: false, synced: true };
  if (opts.dryRun) throw new DryRunRollback(result);
  return result;
```

Then wrap the outer `await withUserRLS(...)` call to catch `DryRunRollback` and pull the carried result. Update the helper's outer try/catch:

```ts
let result: PromotionResult;
try {
  result = await withUserRLS(userId, async (tx) => { /* …existing body… */ });
} catch (e) {
  if (e instanceof DryRunRollback) {
    // dry-run: tx rolled back, audit/metric must not fire
    return e.carried as PromotionResult;
  }
  log.error({ sessionId, error: e instanceof Error ? e.message : String(e) }, 'promotion failed');
  throw e;
}

// post-commit audit + metric path (only reached on real commit)
if (pendingAudit) { /* …existing logAudit call… */ }
if (result.promoted) { /* …existing trackProjectPromotion call… */ }
else { /* …existing not-promotable telemetry… */ }
return result;
```

- [ ] **Step 9.4: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/integration/project-promotion-helper.test.ts
```
Expected: all tests pass (fresh + already-linked + dry-run).

- [ ] **Step 9.5: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 9.6: Commit**

```bash
git add app/src/lib/projects/promotion.ts app/tests/integration/project-promotion-helper.test.ts
git commit -m "$(cat <<'EOF'
feat(projects): DryRunRollback sentinel for ensureProjectForSession

Identical-code-path dry-run: throw the sentinel inside the tx to roll
back, catch outside withUserRLS to recover the carried result. Audit
and metric do not fire on the rollback path so operator dry-runs do
not pollute production counters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wire `ensureProjectForSession` into `initializeSession`

**Files:**
- Modify: `app/src/lib/ai/agent/services/preselect.ts:93-190`
- Modify: `app/src/app/api/v1/projects/preselect/route.ts:220-245, 326-346`
- Test: `app/tests/integration/preselect-projectid-response.test.ts`

- [ ] **Step 10.1: Write failing test for the response shape**

```ts
// app/tests/integration/preselect-projectid-response.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const initializeSessionMock = vi.fn();
const setSelectedCallMock = vi.fn();

vi.mock('@/lib/ai/agent/services/preselect', () => ({
  initializeSession: initializeSessionMock,
  rankCandidates: vi.fn().mockResolvedValue([
    { callId: 'CODE-1', title: 'Call 1', score: 0.9, program: 'PNRR', sourceUrl: '' },
    { callId: 'CODE-2', title: 'Call 2', score: 0.5, program: 'PNRR', sourceUrl: '' },
  ]),
  decideSelection: vi.fn().mockReturnValue({ kind: 'selected', callId: 'CODE-1', candidates: [] }),
  MIN_DESCRIPTION_LENGTH: 40,
}));
vi.mock('@/lib/ai/agent/services/application', () => ({ setSelectedCall: setSelectedCallMock }));
vi.mock('@/lib/auth/helpers', () => ({ requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }) }));
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue({ ok: true, headers: {} }),
}));
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn().mockResolvedValue({ matches: [{ callId: 'CODE-1' }] }),
}));

import { POST } from '@/app/api/v1/projects/preselect/route';

describe('preselect route — projectId in response', () => {
  beforeEach(() => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true';
    initializeSessionMock.mockReset();
    setSelectedCallMock.mockReset();
  });

  it('returns projectId on rank+select success', async () => {
    initializeSessionMock.mockResolvedValueOnce({
      sessionId: 'sess-1', phase: 'structuring', blueprintKind: 'structured', projectId: 'proj-1',
    });
    const req = new Request('http://x/api/v1/projects/preselect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'A description that is long enough to pass.', locale: 'ro' }),
    });
    const res = await POST(req as any);
    const json = await res.json();
    expect(json).toMatchObject({ kind: 'selected', sessionId: 'sess-1', projectId: 'proj-1' });
  });

  it('returns projectId: null when initializeSession reports null projectId', async () => {
    initializeSessionMock.mockResolvedValueOnce({
      sessionId: 'sess-2', phase: 'research', blueprintKind: 'none', projectId: null,
    });
    const req = new Request('http://x/api/v1/projects/preselect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'A description that is long enough to pass.', locale: 'ro' }),
    });
    const res = await POST(req as any);
    const json = await res.json();
    expect(json.projectId).toBeNull();
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/integration/preselect-projectid-response.test.ts
```
Expected: FAIL — `initializeSession` does not yet return `projectId`, and the route doesn't forward it.

- [ ] **Step 10.3: Modify `initializeSession`**

In `app/src/lib/ai/agent/services/preselect.ts`:

1. Add `requestId: string` to the `InitializeSessionParams` interface.
2. Add `projectId: string | null` to the `InitializeSessionResult` interface.
3. After the `await logAudit(...)` call at line 174-187 (which logs `session.preselect_completed`), insert the promotion call. Use a try/catch that defaults `projectId` to `null` on failure.

```ts
// Add to imports at the top of the file
import { ensureProjectForSession } from '@/lib/projects/promotion'

// Update InitializeSessionParams (around line 93)
export interface InitializeSessionParams {
  userId: string
  description: string
  locale: 'ro' | 'en'
  selectedCallId: string
  selectedScore: number
  candidates: Candidate[]
  excludeCallIdsApplied: string[]
  requestId: string                    // NEW
}

// Update InitializeSessionResult (around line 103)
export interface InitializeSessionResult {
  sessionId: string
  phase: 'structuring' | 'research'
  blueprintKind: BlueprintKind
  projectId: string | null             // NEW
}

// Replace the final `return { sessionId: row.id, phase, blueprintKind }` at line 189
let projectId: string | null = null
try {
  const promoteResult = await ensureProjectForSession(
    { userId, sessionId: row.id, requestId: params.requestId, now: new Date() },
    row.id,
  )
  if (promoteResult.promoted) projectId = promoteResult.projectId
} catch (err) {
  // Promotion failure does NOT unwind the session insert — the session is
  // already committed and the user can still resume by sessionId. Log and
  // surface projectId=null so the client doesn't try to navigate to a
  // nonexistent /proiecte/[id].
  log.error(
    { userId, sessionId: row.id, error: err instanceof Error ? err.message : String(err) },
    'session_promotion_failed',
  )
}

return { sessionId: row.id, phase, blueprintKind, projectId }
```

- [ ] **Step 10.4: Update preselect route to thread `requestId` and forward `projectId`**

In `app/src/app/api/v1/projects/preselect/route.ts`, locate the two callers of `initializeSession` (around lines 221 and 326) and update them:

```ts
// Confirm-new mode (around line 220)
const result = await initializeSession({
  userId: user.id,
  description: parsed.description,
  locale: parsed.locale,
  selectedCallId: parsed.confirmCandidateId,
  selectedScore: 1,
  candidates: [{ callId: parsed.confirmCandidateId, title: parsed.confirmCandidateId, score: 1 }],
  excludeCallIdsApplied: [],
  requestId: ctx.requestId,            // NEW (use the existing ctx)
})
return NextResponse.json({
  kind: 'selected',
  sessionId: result.sessionId,
  selectedCallId: parsed.confirmCandidateId,
  candidates: [{ callId: parsed.confirmCandidateId, title: parsed.confirmCandidateId, score: 1 }],
  blueprintKind: result.blueprintKind,
  phase: result.phase,
  projectId: result.projectId,         // NEW
})

// Rank+select branch (around line 326)
const result = await initializeSession({
  userId: user.id,
  description: parsed.description,
  locale: parsed.locale,
  selectedCallId: decision.callId,
  selectedScore: decision.candidates[0].score,
  candidates: decision.candidates,
  excludeCallIdsApplied: parsed.excludeCallIds ?? [],
  requestId: ctx.requestId,            // NEW
})
return NextResponse.json({
  kind: 'selected',
  sessionId: result.sessionId,
  selectedCallId: decision.callId,
  candidates: decision.candidates,
  blueprintKind: result.blueprintKind,
  phase: result.phase,
  projectId: result.projectId,         // NEW
})
```

- [ ] **Step 10.5: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/integration/preselect-projectid-response.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 10.6: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 10.7: Commit**

```bash
git add app/src/lib/ai/agent/services/preselect.ts app/src/app/api/v1/projects/preselect/route.ts app/tests/integration/preselect-projectid-response.test.ts
git commit -m "$(cat <<'EOF'
feat(preselect): wire session promotion into initializeSession

Both rank+select and confirm-new paths now call
ensureProjectForSession after the agent_sessions insert and surface
the resulting projectId (or null on failure) in the JSON response.
Failure inside the helper logs but does not unwind the committed
session — the user can still resume by sessionId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Reshape `setSelectedCall` with three explicit branches

**Files:**
- Modify: `app/src/lib/ai/agent/services/application.ts:572-627`
- Modify: `app/src/app/api/v1/projects/preselect/route.ts:178-201, 270-299`
- Test: `app/tests/integration/set-selected-call-promotion.test.ts`

- [ ] **Step 11.1: Write failing test for the three branches**

```ts
// app/tests/integration/set-selected-call-promotion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureMock = vi.fn();
const verifyOwnershipMock = vi.fn();
const auditMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/projects/promotion', () => ({ ensureProjectForSession: ensureMock }));
vi.mock('@/lib/legal/audit', () => ({ logAudit: auditMock }));

const session: any = {
  id: 'sess-1',
  userId: 'user-1',
  selectedCallId: 'OLD-CALL',
  projectId: null,
  stateVersion: 3,
  outlineFrozen: false,
};

const updateChain = {
  set: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: 'sess-1' }]),
    })),
  })),
};
const dbMock = {
  update: vi.fn(() => updateChain),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([{ stateVersion: session.stateVersion }]),
      })),
    })),
  })),
};
vi.mock('@/lib/db', () => ({ db: dbMock, withUserRLS: vi.fn() }));
vi.mock('@/lib/db/schema', () => ({ agentSessions: { id: 'sess.id', stateVersion: 'sess.state_version' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }));

vi.mock('@/lib/ai/agent/services/types', async () => ({
  ...(await vi.importActual<any>('@/lib/ai/agent/services/types')),
}));

vi.mock('@/lib/ai/agent/policy/matrix', () => ({
  POLICY_MATRIX: {
    setSelectedCall: { auditAction: 'session.call_selected', code: 'POLICY_OUTLINE_ALREADY_FROZEN' },
  },
  assertPolicy: vi.fn(),
}));

// verifySessionOwnership lives in context-helpers and is imported by
// application.ts; mock it at its source module so the import resolves to
// our stub rather than the real DB-touching implementation.
vi.mock('@/lib/ai/agent/services/context-helpers', () => ({
  verifySessionOwnership: vi.fn().mockImplementation(async () => session),
}));

import * as appSvc from '@/lib/ai/agent/services/application';

const ctx = { userId: 'user-1', sessionId: 'sess-1', requestId: 'req-1', now: new Date() } as any;

describe('setSelectedCall — promotion integration', () => {
  beforeEach(() => {
    ensureMock.mockReset();
    auditMock.mockReset();
    Object.assign(session, { selectedCallId: 'OLD-CALL', projectId: null, stateVersion: 3, outlineFrozen: false });
  });

  it('same callId + linked → no-op return with existing projectId', async () => {
    session.selectedCallId = 'CALL-X';
    session.projectId = 'proj-existing';
    const out = await appSvc.setSelectedCall(ctx, { sessionId: 'sess-1', callId: 'CALL-X', expectedStateVersion: 3 });
    expect(out).toEqual({ newStateVersion: 3, projectId: 'proj-existing' });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('same callId + unlinked → skip CAS/audit, run promotion, return existing stateVersion', async () => {
    session.selectedCallId = 'CALL-X';
    session.projectId = null;
    ensureMock.mockResolvedValueOnce({ promoted: true, projectId: 'proj-new', created: true, titleSource: 'description', selectedCallResolution: 'callCode' });
    const out = await appSvc.setSelectedCall(ctx, { sessionId: 'sess-1', callId: 'CALL-X', expectedStateVersion: 3 });
    expect(out).toEqual({ newStateVersion: 3, projectId: 'proj-new' });
    expect(auditMock).not.toHaveBeenCalled();
    expect(ensureMock).toHaveBeenCalledOnce();
  });

  it('different callId → CAS+audit then promotion, returns new stateVersion', async () => {
    session.selectedCallId = 'OLD-CALL';
    session.projectId = null;
    ensureMock.mockResolvedValueOnce({ promoted: true, projectId: 'proj-new', created: true, titleSource: 'fallback', selectedCallResolution: 'unresolved' });
    const out = await appSvc.setSelectedCall(ctx, { sessionId: 'sess-1', callId: 'NEW-CALL', expectedStateVersion: 3 });
    expect(out).toEqual({ newStateVersion: 4, projectId: 'proj-new' });
    expect(auditMock).toHaveBeenCalledOnce();
    expect(ensureMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/integration/set-selected-call-promotion.test.ts
```
Expected: FAIL — current `setSelectedCall` doesn't return `projectId` and doesn't have the same-call-unlinked branch.

- [ ] **Step 11.3: Reshape `setSelectedCall`**

In `app/src/lib/ai/agent/services/application.ts`, replace the entire body of `setSelectedCall` (lines 572-627) with the three-branch version. Add the import.

```ts
// Add to imports at the top of the file
// LAYER NOTE: lib/projects/promotion is an intentional downstream dependency
// of this service — promotion is the post-commit hook for setSelectedCall and
// runs after the agent state mutation lands. Future cleanup of service
// dependencies should preserve this.
import { ensureProjectForSession } from '@/lib/projects/promotion'

// Replace the existing setSelectedCall (lines 572-627)
export async function setSelectedCall(
  ctx: ServiceContext,
  input: { sessionId: string; callId: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number; projectId: string | null }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // Branch 1: true no-op (same callId, already linked).
  if (session.selectedCallId === input.callId && session.projectId !== null) {
    return { newStateVersion: session.stateVersion, projectId: session.projectId }
  }

  // Branch 2: same callId, no project yet. Skip policy + CAS + audit;
  // run promotion and return existing stateVersion. This works even
  // under outline-frozen because no logical reselection is happening.
  if (session.selectedCallId === input.callId && session.projectId === null) {
    let projectId: string | null = null
    try {
      const result = await ensureProjectForSession(ctx, input.sessionId)
      if (result.promoted) projectId = result.projectId
    } catch (err) {
      // Promotion failure does not break the caller — log and continue.
      // The session's logical state is untouched; client can retry.
    }
    return { newStateVersion: session.stateVersion, projectId }
  }

  // Branch 3: different callId. Standard policy + CAS + audit, then promotion.
  assertPolicy(POLICY_MATRIX.setSelectedCall, session as unknown as AgentSession)

  const newStateVersion = session.stateVersion + 1
  const casCall = await db
    .update(agentSessions)
    .set({
      selectedCallId: input.callId,
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    })
    .where(and(
      eq(agentSessions.id, input.sessionId),
      eq(agentSessions.stateVersion, input.expectedStateVersion),
    ))
    .returning({ id: agentSessions.id })

  if (casCall.length === 0) {
    const [current] = await db
      .select({ stateVersion: agentSessions.stateVersion })
      .from(agentSessions)
      .where(eq(agentSessions.id, input.sessionId))
      .limit(1)
    throw new ConcurrencyError(input.expectedStateVersion, current?.stateVersion ?? -1)
  }

  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.setSelectedCall.auditAction,
    resourceType: 'agent_session',
    resourceId: input.sessionId,
    metadata: { callId: input.callId, previousCallId: session.selectedCallId, requestId: ctx.requestId },
  })

  let projectId: string | null = null
  try {
    const result = await ensureProjectForSession(ctx, input.sessionId)
    if (result.promoted) projectId = result.projectId
  } catch (err) {
    // Promotion failure does not break the caller — log and continue.
  }

  return { newStateVersion, projectId }
}
```

- [ ] **Step 11.4: Update the two `setSelectedCall` callers in the preselect route to forward `projectId`**

In `app/src/app/api/v1/projects/preselect/route.ts`:

```ts
// Confirm-override mode (around line 178)
const setResult = await setSelectedCall(ctx, {
  sessionId: parsed.sessionId,
  callId: target,
  expectedStateVersion: parsed.expectedStateVersion!,
})
// ...
return NextResponse.json({
  kind: 'selected',
  sessionId: parsed.sessionId,
  selectedCallId: target,
  candidates: [{ callId: target, title: target, score: 1 }],
  projectId: setResult.projectId,        // NEW
})

// Override-rerank mode (around line 271)
const setResult = await setSelectedCall(overrideCtx, {
  sessionId: parsed.sessionId,
  callId: decision.callId,
  expectedStateVersion: parsed.expectedStateVersion!,
})
// ...
return NextResponse.json({
  kind: 'selected',
  sessionId: parsed.sessionId,
  selectedCallId: decision.callId,
  candidates: decision.candidates,
  projectId: setResult.projectId,        // NEW
})
```

(The original code captured `await setSelectedCall(...)` without binding to a variable. Restructure to bind, as shown.)

- [ ] **Step 11.5: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/integration/set-selected-call-promotion.test.ts tests/integration/preselect-projectid-response.test.ts
```
Expected: all pass.

- [ ] **Step 11.6: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 11.7: Commit**

```bash
git add app/src/lib/ai/agent/services/application.ts app/src/app/api/v1/projects/preselect/route.ts app/tests/integration/set-selected-call-promotion.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): three-branch setSelectedCall with promotion hook

Splits the idempotent fast-path: same callId + linked is a true
no-op; same callId + unlinked still runs promotion (skipping policy
gate and CAS so it works under outline-frozen). Different callId
goes through the standard CAS+audit path then runs promotion.
Return shape extends with projectId (string or null) and the two
override callers forward it in their JSON responses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Update `lib/preselect/client.ts` PreselectResponse type

**Files:**
- Modify: `app/src/lib/preselect/client.ts:18-31`

- [ ] **Step 12.1: Add `projectId` to the selected variant**

In `app/src/lib/preselect/client.ts`:

```ts
export type PreselectResponse =
  | {
      kind: 'selected'
      sessionId: string
      selectedCallId: string
      candidates: Candidate[]
      blueprintKind?: 'structured' | 'raw_evidence' | 'none'
      phase?: 'structuring' | 'research'
      projectId?: string | null            // NEW
    }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'no_match'; reason: string }
```

- [ ] **Step 12.2: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 12.3: Commit**

```bash
git add app/src/lib/preselect/client.ts
git commit -m "$(cat <<'EOF'
feat(preselect/client): expose projectId on PreselectResponse.selected

Forward-compatible additive type change so client callers can read
the promoted projectId. Optional + nullable: null means promotion
was attempted server-side and failed (logged), absent means a stale
client typing the old shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Backfill script

**Files:**
- Create: `app/scripts/backfill-session-projects.ts`
- Modify: `app/package.json`
- Test: `app/tests/unit/scripts/backfill-session-projects.test.ts`

- [ ] **Step 13.1: Write the script**

```ts
#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════
// Session-to-Project Backfill (operator-driven, dry-run by default)
// ═══════════════════════════════════════════════════════════════════════
//
// Usage:
//   cd app
//   # Dry-run (default; no DB writes — but does take row locks briefly)
//   npx tsx --env-file=.env.local scripts/backfill-session-projects.ts
//
//   # Apply (commits changes for each promotable session)
//   npx tsx --env-file=.env.local scripts/backfill-session-projects.ts --confirm
//
//   # Limit to N rows (staged rollout)
//   npx tsx --env-file=.env.local scripts/backfill-session-projects.ts --confirm --limit 5
//
// IMPORTANT — dry-run mechanics:
// The script invokes the same ensureProjectForSession() that the live
// trigger sites use. In dry-run mode the helper opens a transaction,
// runs every step (including Personal Workspace org creation for users
// with zero memberships), then rolls back via DryRunRollback. Operators
// will NOT see audit-log entries or project_promotion_total metric
// increments after a dry-run — this is correct behavior, not a silent
// failure.

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '../src/lib/db/schema';
import { ensureProjectForSession } from '../src/lib/projects/promotion';
import type { ServiceContext } from '../src/lib/ai/agent/services/types';

const CONFIRM = process.argv.includes('--confirm');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT: number | null = limitIdx >= 0 && process.argv[limitIdx + 1]
  ? parseInt(process.argv[limitIdx + 1], 10)
  : null;

if (!process.env.DATABASE_URL) {
  console.error('error: DATABASE_URL must be set');
  process.exit(1);
}

interface CandidateRow {
  id: string;
  user_id: string;
  selected_call_id: string;
  user_exists: boolean;
}

interface Tally {
  promoted: number;
  alreadyLinked: number;
  syncedCall: number;
  skippedNoSelectedCall: number;
  skippedMissingUser: number;
  failed: number;
}

async function main() {
  const sqlClient = postgres(process.env.DATABASE_URL!, { max: 1 });
  const _db = drizzle(sqlClient, { schema });

  const candidates = await sqlClient<CandidateRow[]>`
    SELECT s.id, s.user_id, s.selected_call_id,
           (u.id IS NOT NULL) AS user_exists
    FROM agent_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.project_id IS NULL AND s.selected_call_id IS NOT NULL
    ORDER BY s.created_at
    ${LIMIT !== null ? sqlClient`LIMIT ${LIMIT}` : sqlClient``}
  `;

  console.log(`mode: ${CONFIRM ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`candidates: ${candidates.length}`);
  console.log('');

  const tally: Tally = {
    promoted: 0, alreadyLinked: 0, syncedCall: 0,
    skippedNoSelectedCall: 0, skippedMissingUser: 0, failed: 0,
  };

  let anyFailure = false;

  for (const row of candidates) {
    if (!row.user_exists) {
      tally.skippedMissingUser++;
      console.log(`SKIP missing-user  | ${row.id} | user=${row.user_id}`);
      continue;
    }

    const ctx: ServiceContext = {
      userId: row.user_id,
      sessionId: row.id,
      requestId: crypto.randomUUID(),
      now: new Date(),
    };

    try {
      const result = await ensureProjectForSession(ctx, row.id, { dryRun: !CONFIRM });
      if (result.promoted) {
        if (result.created) {
          tally.promoted++;
          console.log(`PROMOTE            | ${row.id} | call=${row.selected_call_id} | proj=${result.projectId} | resolution=${result.selectedCallResolution} | titleSource=${result.titleSource}`);
        } else if ((result as any).synced === true) {
          tally.syncedCall++;
          console.log(`SYNC               | ${row.id} | call=${row.selected_call_id} | proj=${result.projectId}`);
        } else {
          tally.alreadyLinked++;
          console.log(`NOOP already-linked| ${row.id} | proj=${result.projectId}`);
        }
      } else {
        if (result.reason === 'NO_SELECTED_CALL') {
          tally.skippedNoSelectedCall++;
          console.log(`SKIP no-call       | ${row.id}`);
        } else if (result.reason === 'USER_NOT_FOUND') {
          tally.skippedMissingUser++;
          console.log(`SKIP missing-user  | ${row.id}`);
        } else {
          tally.failed++;
          anyFailure = true;
          console.log(`FAIL ${result.reason} | ${row.id}`);
        }
      }
    } catch (err) {
      tally.failed++;
      anyFailure = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR              | ${row.id} | ${msg}`);
    }
  }

  console.log('');
  console.log('summary:');
  console.log(`  promoted             : ${tally.promoted}`);
  console.log(`  alreadyLinked        : ${tally.alreadyLinked}`);
  console.log(`  syncedCall           : ${tally.syncedCall}`);
  console.log(`  skippedNoSelectedCall: ${tally.skippedNoSelectedCall}`);
  console.log(`  skippedMissingUser   : ${tally.skippedMissingUser}`);
  console.log(`  failed               : ${tally.failed}`);

  await sqlClient.end();
  process.exit(anyFailure ? 1 : 0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 13.2: Add npm script entry**

In `app/package.json`, under the `"scripts"` block, add:

```json
"script:backfill-session-projects": "npx tsx --env-file=.env.local scripts/backfill-session-projects.ts"
```

(Place it alphabetically near the other `script:` or operational scripts; if none exist, near the `db:seed` line is fine.)

- [ ] **Step 13.3: Write the unit test (mocked helper)**

```ts
// app/tests/unit/scripts/backfill-session-projects.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureMock = vi.fn();
vi.mock('@/lib/projects/promotion', () => ({ ensureProjectForSession: ensureMock }));

// We test the per-row decision logic by extracting it into an importable
// helper. Refactor the script to expose `processRow(row, opts)` for
// testability — see Step 13.4.
import { processRow, type Tally } from '../../../scripts/backfill-session-projects';

function newTally(): Tally {
  return { promoted: 0, alreadyLinked: 0, syncedCall: 0, skippedNoSelectedCall: 0, skippedMissingUser: 0, failed: 0 };
}

describe('backfill-session-projects processRow', () => {
  beforeEach(() => ensureMock.mockReset());

  it('skips missing-user without calling helper', async () => {
    const tally = newTally();
    const failed = await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: false }, { confirm: false }, tally);
    expect(tally.skippedMissingUser).toBe(1);
    expect(ensureMock).not.toHaveBeenCalled();
    expect(failed).toBe(false);
  });

  it('counts promoted on created=true return', async () => {
    ensureMock.mockResolvedValueOnce({ promoted: true, created: true, projectId: 'p1', titleSource: 'description', selectedCallResolution: 'callCode' });
    const tally = newTally();
    await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: true }, { confirm: true }, tally);
    expect(tally.promoted).toBe(1);
  });

  it('counts syncedCall on created=false synced=true', async () => {
    ensureMock.mockResolvedValueOnce({ promoted: true, created: false, synced: true, projectId: 'p1' });
    const tally = newTally();
    await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: true }, { confirm: true }, tally);
    expect(tally.syncedCall).toBe(1);
  });

  it('flips failed=true on thrown helper error', async () => {
    ensureMock.mockRejectedValueOnce(new Error('boom'));
    const tally = newTally();
    const failed = await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: true }, { confirm: true }, tally);
    expect(tally.failed).toBe(1);
    expect(failed).toBe(true);
  });
});
```

- [ ] **Step 13.4: Refactor the script to export `processRow` and `Tally`**

Edit `app/scripts/backfill-session-projects.ts` to extract the per-row body into an exported function. Replace the inner `for (const row of candidates) { ... }` block with a call to `processRow`, and export the helper + `Tally` type:

```ts
export interface Tally {
  promoted: number;
  alreadyLinked: number;
  syncedCall: number;
  skippedNoSelectedCall: number;
  skippedMissingUser: number;
  failed: number;
}

interface ProcessOpts { confirm: boolean }

export async function processRow(
  row: CandidateRow,
  opts: ProcessOpts,
  tally: Tally,
): Promise<boolean> {
  if (!row.user_exists) {
    tally.skippedMissingUser++;
    console.log(`SKIP missing-user  | ${row.id} | user=${row.user_id}`);
    return false;
  }

  const ctx: ServiceContext = {
    userId: row.user_id,
    sessionId: row.id,
    requestId: crypto.randomUUID(),
    now: new Date(),
  };

  try {
    const result = await ensureProjectForSession(ctx, row.id, { dryRun: !opts.confirm });
    if (result.promoted) {
      if (result.created) {
        tally.promoted++;
        console.log(`PROMOTE            | ${row.id} | call=${row.selected_call_id} | proj=${result.projectId} | resolution=${result.selectedCallResolution} | titleSource=${result.titleSource}`);
      } else if ((result as any).synced === true) {
        tally.syncedCall++;
        console.log(`SYNC               | ${row.id} | call=${row.selected_call_id} | proj=${result.projectId}`);
      } else {
        tally.alreadyLinked++;
        console.log(`NOOP already-linked| ${row.id} | proj=${result.projectId}`);
      }
      return false;
    }
    if (result.reason === 'NO_SELECTED_CALL') {
      tally.skippedNoSelectedCall++;
      console.log(`SKIP no-call       | ${row.id}`);
      return false;
    }
    if (result.reason === 'USER_NOT_FOUND') {
      tally.skippedMissingUser++;
      console.log(`SKIP missing-user  | ${row.id}`);
      return false;
    }
    tally.failed++;
    console.log(`FAIL ${result.reason} | ${row.id}`);
    return true;
  } catch (err) {
    tally.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ERROR              | ${row.id} | ${msg}`);
    return true;
  }
}
```

Then in `main()`, replace the inline body with:

```ts
let anyFailure = false;
for (const row of candidates) {
  const failed = await processRow(row, { confirm: CONFIRM }, tally);
  if (failed) anyFailure = true;
}
```

Also export `CandidateRow`:

```ts
export interface CandidateRow {
  id: string;
  user_id: string;
  selected_call_id: string;
  user_exists: boolean;
}
```

- [ ] **Step 13.5: Run tests to verify they pass**

```bash
cd app && npx vitest run tests/unit/scripts/backfill-session-projects.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 13.6: Verify typecheck**

```bash
cd app && npm run typecheck
```
Expected: zero errors.

- [ ] **Step 13.7: Dry-run the script against the dev DB to confirm shape**

```bash
cd app && npm run script:backfill-session-projects 2>&1 | tail -30
```
Expected: prints `mode: DRY-RUN`, `candidates: 11`, per-row outcomes, summary footer with `failed: 0`. No DB writes.

- [ ] **Step 13.8: Commit**

```bash
git add app/scripts/backfill-session-projects.ts app/package.json app/tests/unit/scripts/backfill-session-projects.test.ts
git commit -m "$(cat <<'EOF'
feat(scripts): backfill-session-projects one-shot recovery

Operator-driven script that invokes the same ensureProjectForSession
helper used live, with --confirm required to write. Default mode is
dry-run (rolls back via DryRunRollback). Per-row tally + nonzero exit
on any failure. processRow extracted for unit testing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: End-to-end verification + apply backfill

**Files:** none modified.

- [ ] **Step 14.1: Run the full test suite**

```bash
cd app && npm run test
```
Expected: all tests pass. Investigate and fix any unrelated failures before proceeding.

- [ ] **Step 14.2: Run typecheck and lint**

```bash
cd app && npm run typecheck && npm run lint
```
Expected: zero typecheck errors. Lint warnings acceptable per project policy (`ignoreDuringBuilds: true`); investigate any new errors.

- [ ] **Step 14.3: Manual smoke against dev DB — dry-run**

Confirm the docker stack is up:

```bash
docker ps | grep eu-funds
```
Expected: `eu-funds-postgres-1`, `eu-funds-redis-1`, `eu-funds-qdrant-1` all running.

```bash
cd app && npm run script:backfill-session-projects
```
Expected output: `mode: DRY-RUN`, `candidates: 11`, lines for each promotable session, summary `promoted: 11, alreadyLinked: 0, syncedCall: 0, skippedNoSelectedCall: 0, skippedMissingUser: 0, failed: 0`. Note: all 11 will resolve as `selectedCallResolution=unresolved` per the verified dev data.

- [ ] **Step 14.4: Manual smoke — verify dry-run wrote nothing**

```bash
docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c "
  SELECT COUNT(*) AS active_sessions_no_project
  FROM agent_sessions
  WHERE status='active' AND project_id IS NULL AND selected_call_id IS NOT NULL;
"
```
Expected: still `11`. Dry-run did not link.

- [ ] **Step 14.5: Apply the backfill in dev**

```bash
cd app && npm run script:backfill-session-projects -- --confirm
```
Expected: same per-row table, summary `promoted: 11`. Exit code 0.

- [ ] **Step 14.6: Verify backfill effect**

```bash
docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c "
  SELECT
    (SELECT COUNT(*) FROM agent_sessions WHERE project_id IS NOT NULL) AS linked_sessions,
    (SELECT COUNT(*) FROM projects WHERE metadata->>'agentSessionId' IS NOT NULL) AS promoted_projects,
    (SELECT COUNT(*) FROM audit_log WHERE action = 'project.promoted_from_session') AS promotion_audit_entries;
"
```
Expected: `linked_sessions = 11`, `promoted_projects = 11`, `promotion_audit_entries = 11`.

- [ ] **Step 14.7: Smoke the live preselect path in the browser**

Open the dev server (`http://localhost:3002` per the project's CLAUDE.md), log in, navigate to `/ro/proiecte/nou`, type a project description, watch network for `POST /api/v1/projects/preselect`, confirm response includes `projectId: "..."`. Then visit `/ro/proiecte` and confirm the project appears in the list.

- [ ] **Step 14.8: Final commit (only if any cleanup/fixes were needed)**

If steps 14.1–14.7 surfaced no issues, no commit needed for this task. If small fixes were required, commit them with a descriptive message.

---

## Final Self-Review Checklist (run before declaring complete)

- [ ] Spec coverage: every spec section has at least one task. Cross-reference:
  - Mental model + naming → Tasks 1-4
  - Helper contract → Tasks 4-9
  - Trigger sites (initializeSession + setSelectedCall three branches) → Tasks 10, 11
  - Public response/type changes → Tasks 10, 11, 12
  - AuditAction union → Task 2
  - Metric counter + dry-run suppression → Tasks 3, 9
  - Backfill script + missing-user mock test → Task 13
  - Soft-delete follow-up: spec note only, no task (correct)
  - Sections-tab integration follow-up: spec note only, no task (correct)
- [ ] No placeholder text in any code block.
- [ ] Type names consistent across tasks: `PromotionResult`, `CallResolution`, `TitleSource`, `EnsureOpts`, `DryRunRollback`, `SessionForTitle`, `ResolveCallResult`, `Tally`, `CandidateRow`.
- [ ] Function names consistent: `ensureProjectForSession`, `deriveProjectTitle`, `resolveCallForId`, `resolveProjectOrgIdInTx`, `trackProjectPromotion`, `processRow`.
- [ ] Audit action used everywhere: `'project.promoted_from_session'`.
- [ ] Metric name used everywhere: `'project_promotion_total'`.
- [ ] Each commit only stages exact paths (no `git add .`).

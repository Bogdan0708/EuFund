# Document Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DOCX-centric file dump with a markdown-native document workspace where users can view, edit, and refine AI-generated proposal sections inline — with DOCX as on-demand export.

**Architecture:** Workspace edits flow through the existing session-backed versioning system. A new `editProjectSection()` function uses `FOR UPDATE` row locking (same pattern as `transitionSectionState()`) to guarantee atomic version-row + session-context updates with clean 409 on concurrent edits. Project-level API endpoints are thin proxies that resolve project → session via `resolveProjectWorkspace()`. MDXEditor provides WYSIWYG markdown editing; react-markdown + remark-gfm renders previews.

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM + postgres.js, @mdxeditor/editor, react-markdown, remark-gfm, rehype-sanitize

**Spec:** `docs/superpowers/specs/2026-04-08-document-workspace-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `app/src/lib/ai/orchestrator/workspace.ts` | `resolveProjectWorkspace()`, `editProjectSection()`, `syncProjectDocumentSnapshot()`, `normalizeSections()` |
| `app/tests/integration/workspace.test.ts` | Tests for workspace resolver, editor, snapshot sync |
| `app/src/app/api/v1/projects/[id]/sections/route.ts` | GET all sections for a project |
| `app/src/app/api/v1/projects/[id]/sections/[sectionId]/route.ts` | GET single section, PATCH section content |
| `app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts` | POST state transition proxy |
| `app/src/app/api/v1/projects/[id]/sections/[sectionId]/export/route.ts` | GET section DOCX export |
| `app/src/app/api/v1/workspace/route.ts` | GET aggregate workspace data for /documente |
| `app/tests/integration/sections-api.test.ts` | Tests for sections API endpoints |
| `app/src/components/ui/markdown-render.tsx` | react-markdown + remark-gfm + rehype-sanitize wrapper |
| `app/src/components/ui/section-state-badge.tsx` | draft/reviewed/approved badge component |
| `app/src/components/editor/section-editor.tsx` | MDXEditor wrapper with dynamic import |
| `app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx` | Section editor page |
| `app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx` | Sections tab for project detail |

### Modified Files

| File | Change |
|------|--------|
| `app/src/lib/validators/index.ts` | Add `editSectionContentSchema`, `transitionSectionStateSchema` |
| `app/src/lib/ai/orchestrator/engine.ts` | Remove per-section DOCX loop (lines 391-405) |
| `app/src/app/api/v1/projects/[id]/export/route.ts` | Use `resolveProjectWorkspace()` for session-first reads |
| `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx` | Add Sections tab + `?tab=` query param |
| `app/src/app/[locale]/(dashboard)/documente/page.tsx` | Rewrite as workspace |
| `app/src/messages/ro.json` | Add sectionEditor + workspace keys |
| `app/src/messages/en.json` | Add sectionEditor + workspace keys |

---

### Task 1: Validation Schemas + Section Normalizer

**Files:**
- Modify: `app/src/lib/validators/index.ts`
- Create: `app/src/lib/ai/orchestrator/workspace.ts`
- Test: `app/tests/integration/workspace.test.ts`

- [ ] **Step 1: Add validation schemas**

Add to `app/src/lib/validators/index.ts` after `updateProjectSectionSchema` (line 80):

```typescript
export const editSectionContentSchema = z.object({
  content: z.string().min(1).max(100_000),
  title: z.string().min(1).max(500).optional(),
  expectedCurrentVersion: z.number().int().min(1),
});

export const transitionSectionStateSchema = z.object({
  state: z.enum(['draft', 'reviewed', 'approved']),
  expectedCurrentVersion: z.number().int().min(1),
  reason: z.string().max(500).optional(),
});
```

- [ ] **Step 2: Write the failing test for normalizeSections**

Create `app/tests/integration/workspace.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('normalizeSections', () => {
  it('fills missing versioning fields with defaults', async () => {
    const { normalizeSections } = await import('@/lib/ai/orchestrator/workspace');

    const raw = [
      { id: 'sec-1', title: 'Context', content: 'Hello', order: 1, source: 'generated', metadata: {} },
    ];

    const result = normalizeSections(raw as any, '2026-01-01T00:00:00Z');
    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('draft');
    expect(result[0].currentVersion).toBe(1);
    expect(result[0].versionCount).toBe(1);
    expect(result[0].contentHash).toHaveLength(64); // SHA-256 hex
    expect(result[0].lastStateChangeAt).toBe('2026-01-01T00:00:00Z');
    expect(result[0].lastStateChangeBy).toBeNull();
  });

  it('preserves already-complete sections unchanged', async () => {
    const { normalizeSections } = await import('@/lib/ai/orchestrator/workspace');

    const complete = [{
      id: 'sec-1', title: 'Context', content: 'Hello', order: 1,
      source: 'generated' as const,
      state: 'approved' as const, currentVersion: 3, versionCount: 3,
      contentHash: 'abc123', lastStateChangeAt: '2026-03-01T00:00:00Z',
      lastStateChangeBy: '22222222-2222-4222-8222-222222222222',
      metadata: { model: 'gpt-4', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-03-01T00:00:00Z', checksum: 'abc' },
    }];

    const result = normalizeSections(complete, '2026-01-01T00:00:00Z');
    expect(result[0].state).toBe('approved');
    expect(result[0].currentVersion).toBe(3);
    expect(result[0].contentHash).toBe('abc123');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/workspace.test.ts`
Expected: FAIL — module `@/lib/ai/orchestrator/workspace` does not exist.

- [ ] **Step 4: Implement normalizeSections**

Create `app/src/lib/ai/orchestrator/workspace.ts`:

```typescript
import { hashContent } from './section-versions';
import type { SectionResult } from './types';

/**
 * Fills in missing versioning fields for legacy/incomplete section data.
 * Used when reading from projectDocuments snapshots that predate the versioning system.
 */
export function normalizeSections(
  sections: unknown[],
  fallbackCreatedAt: string,
): SectionResult[] {
  return sections.map((raw) => {
    const s = raw as Record<string, unknown>;
    const content = typeof s.content === 'string' ? s.content : '';
    return {
      id: String(s.id ?? ''),
      title: String(s.title ?? ''),
      content,
      order: typeof s.order === 'number' ? s.order : 0,
      source: (s.source as SectionResult['source']) ?? 'generated',
      state: (s.state as SectionResult['state']) ?? 'draft',
      currentVersion: typeof s.currentVersion === 'number' ? s.currentVersion : 1,
      versionCount: typeof s.versionCount === 'number' ? s.versionCount : 1,
      contentHash: typeof s.contentHash === 'string' && s.contentHash.length > 0
        ? s.contentHash
        : hashContent(content),
      lastStateChangeAt: typeof s.lastStateChangeAt === 'string'
        ? s.lastStateChangeAt
        : fallbackCreatedAt,
      lastStateChangeBy: typeof s.lastStateChangeBy === 'string'
        ? s.lastStateChangeBy
        : null,
      metadata: (s.metadata ?? {}) as SectionResult['metadata'],
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/workspace.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/lib/validators/index.ts app/src/lib/ai/orchestrator/workspace.ts app/tests/integration/workspace.test.ts && git commit -m "feat(workspace): add validation schemas and section normalizer"
```

---

### Task 2: resolveProjectWorkspace

**Files:**
- Modify: `app/src/lib/ai/orchestrator/workspace.ts`
- Test: `app/tests/integration/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `app/tests/integration/workspace.test.ts`:

```typescript
import { vi, beforeEach } from 'vitest';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

describe('resolveProjectWorkspace', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockDb(overrides: {
    project?: Record<string, unknown> | null;
    sessions?: Record<string, unknown>[];
    snapshotDoc?: Record<string, unknown> | null;
    maxVersions?: Record<string, number>;
  }) {
    const project = overrides.project ?? { id: PROJECT_ID, userId: USER_ID, deletedAt: null };
    const sessions = overrides.sessions ?? [];
    const snapshotDoc = overrides.snapshotDoc ?? null;
    const maxVersions = overrides.maxVersions ?? {};

    vi.doMock('@/lib/db', () => {
      const handler = {
        get(_target: unknown, prop: string) {
          if (prop === 'select') return () => handler;
          if (prop === 'from') return () => handler;
          if (prop === 'where') return () => handler;
          if (prop === 'orderBy') return () => handler;
          if (prop === 'limit') return () => handler;
          if (prop === 'groupBy') return () => handler;
          if (prop === 'then') return undefined;
          return () => handler;
        },
      };
      // We need to mock at a higher level — use the actual mock patterns from the codebase
      return {
        db: new Proxy({}, handler),
        withUserRLS: vi.fn().mockImplementation(async (_userId: string, fn: (tx: unknown) => unknown) => {
          const txProxy = {
            query: {
              projects: {
                findFirst: vi.fn().mockResolvedValue(project),
              },
            },
          };
          return fn(txProxy);
        }),
      };
    });

    vi.doMock('@/lib/db/schema', () => ({
      projects: { id: 'id', userId: 'user_id', deletedAt: 'deleted_at' },
      workflowSessions: { id: 'id', projectId: 'project_id', userId: 'user_id', status: 'status', updatedAt: 'updated_at', context: 'context' },
      projectDocuments: { id: 'id', projectId: 'project_id', version: 'version', sections: 'sections', createdAt: 'created_at', updatedAt: 'updated_at' },
      sectionVersions: { sessionId: 'session_id', sectionId: 'section_id', version: 'version' },
    }));

    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
      and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
      inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
      desc: vi.fn((col: unknown) => ({ type: 'desc', col })),
      isNull: vi.fn((col: unknown) => ({ type: 'isNull', col })),
      sql: { raw: vi.fn() },
      max: vi.fn(),
    }));
  }

  it('returns null when project does not exist', async () => {
    mockDb({ project: null });
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => new Proxy({}, { get: () => vi.fn() }) },
    }));

    const { resolveProjectWorkspace } = await import('@/lib/ai/orchestrator/workspace');
    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID);
    expect(result).toBeNull();
  });

  it('returns snapshot mode when no qualifying session', async () => {
    mockDb({
      sessions: [],
      snapshotDoc: {
        id: 'doc-1', projectId: PROJECT_ID, version: 1,
        sections: [{ id: 'sec-1', title: 'T', content: 'C', order: 1 }],
        createdAt: new Date('2026-01-01'),
      },
    });
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => new Proxy({}, { get: () => vi.fn() }) },
    }));

    const { resolveProjectWorkspace } = await import('@/lib/ai/orchestrator/workspace');
    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('snapshot');
    expect(result!.sections).toHaveLength(1);
    expect(result!.sections[0].state).toBe('draft'); // normalized
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/workspace.test.ts`
Expected: FAIL — `resolveProjectWorkspace` is not exported.

- [ ] **Step 3: Implement resolveProjectWorkspace**

Add to `app/src/lib/ai/orchestrator/workspace.ts`:

```typescript
import { db, withUserRLS } from '@/lib/db';
import { projects, workflowSessions, projectDocuments, sectionVersions } from '@/lib/db/schema';
import { eq, and, inArray, desc, isNull, max } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'workspace' });

export interface ProjectWorkspace {
  project: typeof projects.$inferSelect;
  session: typeof workflowSessions.$inferSelect | null;
  snapshotDoc: typeof projectDocuments.$inferSelect | null;
  mode: 'session' | 'snapshot';
  sections: SectionResult[];
}

const QUALIFYING_STATUSES = ['active', 'paused', 'completed'] as const;
const PREFERRED_STATUSES = ['active', 'paused'] as const;

export async function resolveProjectWorkspace(
  projectId: string,
  userId: string,
): Promise<ProjectWorkspace | null> {
  // 1. Load project with RLS
  const project = await withUserRLS(userId, async (tx) => {
    return tx.query.projects.findFirst({
      where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
    });
  });

  if (!project) return null;

  // 2. Find best session: active/paused first, then latest completed
  const qualifyingSessions = await db
    .select()
    .from(workflowSessions)
    .where(and(
      eq(workflowSessions.projectId, projectId),
      eq(workflowSessions.userId, userId),
      inArray(workflowSessions.status, [...QUALIFYING_STATUSES]),
    ))
    .orderBy(desc(workflowSessions.updatedAt));

  // Prefer active/paused over completed
  let session = qualifyingSessions.find(
    (s) => PREFERRED_STATUSES.includes(s.status as typeof PREFERRED_STATUSES[number]),
  ) ?? qualifyingSessions[0] ?? null;

  // 3. Load snapshot doc (fallback)
  const [snapshotDoc] = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.projectId, projectId))
    .orderBy(desc(projectDocuments.version))
    .limit(1);

  // 4. Determine mode and extract sections
  if (session) {
    const ctx = session.context as { projectSections?: unknown[] } | null;
    let sections = normalizeSections(
      ctx?.projectSections ?? [],
      session.createdAt.toISOString(),
    );

    // Defense-in-depth: drift reconciliation
    if (sections.length > 0) {
      sections = await reconcileDrift(session.id, sections);
    }

    return { project, session, snapshotDoc: snapshotDoc ?? null, mode: 'session', sections };
  }

  if (snapshotDoc) {
    const rawSections = (snapshotDoc.sections ?? []) as unknown[];
    const sections = normalizeSections(rawSections, snapshotDoc.createdAt.toISOString());
    return { project, session: null, snapshotDoc, mode: 'snapshot', sections };
  }

  // No session, no snapshot — return empty workspace
  return { project, session: null, snapshotDoc: null, mode: 'snapshot', sections: [] };
}

/**
 * Defense-in-depth: detects if section_versions has newer rows than session context.
 * If drift found, patches session context from version rows and persists the fix.
 * Should never trigger in normal operation.
 */
async function reconcileDrift(
  sessionId: string,
  sections: SectionResult[],
): Promise<SectionResult[]> {
  try {
    const maxVersionRows = await db
      .select({
        sectionId: sectionVersions.sectionId,
        maxVersion: max(sectionVersions.version).as('max_version'),
      })
      .from(sectionVersions)
      .where(eq(sectionVersions.sessionId, sessionId))
      .groupBy(sectionVersions.sectionId);

    const maxVersionMap = new Map(
      maxVersionRows.map((r) => [r.sectionId, Number(r.maxVersion)]),
    );

    const drifted = sections.filter(
      (s) => (maxVersionMap.get(s.id) ?? 0) > s.currentVersion,
    );

    if (drifted.length === 0) return sections;

    log.warn({ sessionId, driftedSectionIds: drifted.map((s) => s.id) }, 'Section version drift detected, reconciling');

    // Load the latest version rows for drifted sections
    const latestRows: Array<typeof sectionVersions.$inferSelect> = [];
    for (const section of drifted) {
      const targetVersion = maxVersionMap.get(section.id)!;
      const [row] = await db
        .select()
        .from(sectionVersions)
        .where(and(
          eq(sectionVersions.sessionId, sessionId),
          eq(sectionVersions.sectionId, section.id),
          eq(sectionVersions.version, targetVersion),
        ))
        .limit(1);
      if (row) latestRows.push(row);
    }

    // Rebuild sections from version rows
    const patchMap = new Map(latestRows.map((row) => [row.sectionId, row]));
    const reconciled = sections.map((s) => {
      const patch = patchMap.get(s.id);
      if (!patch) return s;
      return {
        ...s,
        content: patch.content,
        contentHash: patch.contentHash,
        title: patch.title,
        currentVersion: patch.version,
        versionCount: patch.version,
        state: 'draft' as const,
        source: 'edited' as const,
        lastStateChangeAt: patch.createdAt.toISOString(),
        lastStateChangeBy: patch.createdBy,
      };
    });

    // Persist the fix to session context — merge into existing context to preserve
    // other fields (matchedCalls, actionPlan, etc.) per engine convention
    const [freshSession] = await db
      .select({ context: workflowSessions.context })
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .limit(1);
    const existingCtx = (freshSession?.context ?? {}) as Record<string, unknown>;

    await db
      .update(workflowSessions)
      .set({
        context: { ...existingCtx, projectSections: reconciled },
        updatedAt: new Date(),
      })
      .where(eq(workflowSessions.id, sessionId));

    return reconciled;
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err), sessionId }, 'Drift reconciliation failed, returning original sections');
    return sections;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/workspace.test.ts`
Expected: PASS (the mock-heavy tests may need adjustment depending on how Drizzle is mocked — adapt mocks to pass).

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/lib/ai/orchestrator/workspace.ts app/tests/integration/workspace.test.ts && git commit -m "feat(workspace): add resolveProjectWorkspace with session precedence and drift reconciliation"
```

---

### Task 3: editProjectSection + syncProjectDocumentSnapshot

**Files:**
- Modify: `app/src/lib/ai/orchestrator/workspace.ts`
- Test: `app/tests/integration/workspace.test.ts`

- [ ] **Step 1: Write the failing test for editProjectSection**

Add to `app/tests/integration/workspace.test.ts`:

```typescript
describe('editProjectSection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws ConcurrentModification when expectedCurrentVersion is stale', async () => {
    const section = {
      id: 'sec-1', title: 'Context', content: 'Old text', order: 1,
      source: 'generated' as const,
      state: 'draft' as const, currentVersion: 3, versionCount: 3,
      contentHash: 'oldhash',
      lastStateChangeAt: '2026-04-05T00:00:00Z', lastStateChangeBy: USER_ID,
      metadata: { model: 'gpt-4', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-05T00:00:00Z', checksum: 'abc' },
    };

    vi.doMock('@/lib/db', () => ({
      db: {
        transaction: vi.fn().mockImplementation(async (fn: Function) => {
          const tx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => [
                    { id: SESSION_ID, context: { projectSections: [section] } },
                  ],
                }),
              }),
            }),
            insert: () => ({ values: vi.fn() }),
            update: () => ({ set: () => ({ where: vi.fn() }) }),
          };
          return fn(tx);
        }),
      },
    }));
    vi.doMock('@/lib/db/schema', () => ({
      workflowSessions: {},
      sectionVersions: {},
      projectDocuments: {},
    }));
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn(), and: vi.fn(), desc: vi.fn(),
    }));
    vi.doMock('@/lib/legal/audit', () => ({
      logAudit: vi.fn(),
    }));
    vi.doMock('@/lib/ai/orchestrator/pubsub', () => ({
      persistAndPublishSectionUpdatedEvent: vi.fn(),
    }));
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => new Proxy({}, { get: () => vi.fn() }) },
    }));

    const { editProjectSection } = await import('@/lib/ai/orchestrator/workspace');
    const { SectionVersionError } = await import('@/lib/ai/orchestrator/section-versions');

    await expect(editProjectSection({
      sessionId: SESSION_ID,
      sectionId: 'sec-1',
      content: 'New text',
      expectedCurrentVersion: 2, // stale! section is at version 3
      userId: USER_ID,
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/workspace.test.ts`
Expected: FAIL — `editProjectSection` not exported.

- [ ] **Step 3: Implement editProjectSection and syncProjectDocumentSnapshot**

Add to `app/src/lib/ai/orchestrator/workspace.ts`:

```typescript
import { logAudit } from '@/lib/legal/audit';
import { persistAndPublishSectionUpdatedEvent } from './pubsub';
import { SectionVersionError } from './section-versions';

export interface EditSectionOpts {
  sessionId: string;
  sectionId: string;
  content: string;
  title?: string;
  expectedCurrentVersion: number;
  userId: string;
}

/**
 * Edit a section's content within a session. Uses FOR UPDATE row locking
 * (same pattern as transitionSectionState) to guarantee atomic version-row
 * + session-context updates with clean 409 on concurrent edits.
 */
export async function editProjectSection(opts: EditSectionOpts): Promise<SectionResult> {
  const { sessionId, sectionId, content, title, expectedCurrentVersion, userId } = opts;
  const now = new Date().toISOString();

  let pendingAudit: Parameters<typeof logAudit>[0] | null = null;
  let projectId: string | null = null;

  const updatedSection = await db.transaction(async (tx) => {
    // Lock session row — concurrent edits block here
    const [session] = await tx
      .select()
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .for('update');

    if (!session) {
      throw new SectionVersionError('SectionNotFound', `Session ${sessionId} not found`);
    }

    projectId = session.projectId;
    const ctx = session.context as { projectSections?: SectionResult[] };
    const sections = ctx.projectSections ?? [];
    const idx = sections.findIndex((s) => s.id === sectionId);

    if (idx < 0) {
      throw new SectionVersionError('SectionNotFound', `Section ${sectionId} not found in session ${sessionId}`);
    }

    const section = sections[idx];

    // Optimistic lock check
    if (section.currentVersion !== expectedCurrentVersion) {
      throw new SectionVersionError(
        'ConcurrentModification',
        `Section ${sectionId} has been modified since the client read`,
        { currentVersion: section.currentVersion },
      );
    }

    const newContentHash = hashContent(content);
    const newVersion = section.currentVersion + 1;

    // Legacy backfill: if no version row exists for the current version,
    // insert a baseline row with the old content first. This matches the
    // pattern in persistSectionChanges() (section-versions.ts:116-144)
    // and ensures rollback/integrity checks work on older sessions.
    const [existingRow] = await tx
      .select()
      .from(sectionVersions)
      .where(and(
        eq(sectionVersions.sessionId, sessionId),
        eq(sectionVersions.sectionId, sectionId),
        eq(sectionVersions.version, section.currentVersion),
      ))
      .limit(1);

    if (!existingRow) {
      const baselineHash = hashContent(section.content);
      await tx.insert(sectionVersions).values({
        sessionId,
        sectionId,
        version: section.currentVersion,
        content: section.content,
        contentHash: baselineHash,
        title: section.title,
        metadata: section.metadata,
        reason: 'legacy_backfill',
        createdBy: userId,
      });
    }

    // Insert new version row
    await tx.insert(sectionVersions).values({
      sessionId,
      sectionId,
      version: newVersion,
      content,
      contentHash: newContentHash,
      title: title ?? section.title,
      metadata: section.metadata,
      reason: 'user_edit',
      createdBy: userId,
    });

    // Build updated section
    const updated: SectionResult = {
      ...section,
      content,
      title: title ?? section.title,
      contentHash: newContentHash,
      source: 'edited',
      state: 'draft',
      currentVersion: newVersion,
      versionCount: section.versionCount + 1,
      lastStateChangeAt: now,
      lastStateChangeBy: userId,
    };

    // Update session context atomically
    const updatedSections = [...sections];
    updatedSections[idx] = updated;

    await tx
      .update(workflowSessions)
      .set({
        context: { ...ctx, projectSections: updatedSections },
        updatedAt: new Date(),
      })
      .where(eq(workflowSessions.id, sessionId));

    pendingAudit = {
      userId,
      action: 'section.edited',
      resourceType: 'workflow_session',
      resourceId: sessionId,
      metadata: {
        sectionId,
        fromVersion: section.currentVersion,
        toVersion: newVersion,
        contentHash: newContentHash,
        previousState: section.state,
      },
    };

    return updated;
  });

  // Post-commit: audit, snapshot sync, event publish
  if (pendingAudit) {
    await logAudit(pendingAudit);
  }

  if (projectId) {
    const ctx = await db
      .select({ context: workflowSessions.context })
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .limit(1);
    const allSections = (ctx[0]?.context as { projectSections?: SectionResult[] })?.projectSections ?? [];
    await syncProjectDocumentSnapshot(projectId, allSections);
  }

  try {
    await persistAndPublishSectionUpdatedEvent(sessionId, sectionId, updatedSection);
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err), sessionId, sectionId }, 'Section updated event publish failed');
  }

  return updatedSection;
}

/**
 * Best-effort sync: updates the latest projectDocuments row with current sections.
 * Creates a new row if none exists.
 */
export async function syncProjectDocumentSnapshot(
  projectId: string,
  sections: SectionResult[],
): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(desc(projectDocuments.version))
      .limit(1);

    if (existing) {
      await db
        .update(projectDocuments)
        .set({
          sections: sections as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(eq(projectDocuments.id, existing.id));
    } else {
      await db.insert(projectDocuments).values({
        projectId,
        version: 1,
        sections: sections as unknown as Record<string, unknown>[],
      });
    }
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err), projectId }, 'Snapshot sync failed');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/lib/ai/orchestrator/workspace.ts app/tests/integration/workspace.test.ts && git commit -m "feat(workspace): add editProjectSection with FOR UPDATE locking and snapshot sync"
```

---

### Task 4: GET Sections API

**Files:**
- Create: `app/src/app/api/v1/projects/[id]/sections/route.ts`
- Test: `app/tests/integration/sections-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration/sections-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

describe('GET /api/v1/projects/:id/sections', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns sections with session mode when session exists', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue({
        project: { id: PROJECT_ID },
        session: { id: SESSION_ID },
        snapshotDoc: null,
        mode: 'session',
        sections: [
          { id: 'sec-1', title: 'Context', content: 'Hello', order: 1, state: 'draft', currentVersion: 1, versionCount: 1, contentHash: 'abc', lastStateChangeAt: '2026-01-01T00:00:00Z', lastStateChangeBy: null, source: 'generated', metadata: {} },
        ],
      }),
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/sections/route');
    const req = new Request('http://localhost/api/v1/projects/' + PROJECT_ID + '/sections');
    const res = await GET(req, { params: { id: PROJECT_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('session');
    expect(body.readOnly).toBe(false);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.sections).toHaveLength(1);
  });

  it('returns readOnly true when no session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue({
        project: { id: PROJECT_ID },
        session: null,
        snapshotDoc: { id: 'doc-1', version: 1 },
        mode: 'snapshot',
        sections: [],
      }),
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/sections/route');
    const req = new Request('http://localhost/api/v1/projects/' + PROJECT_ID + '/sections');
    const res = await GET(req, { params: { id: PROJECT_ID } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('snapshot');
    expect(body.readOnly).toBe(true);
    expect(body.sessionId).toBeNull();
  });

  it('returns 404 when project not found', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue(null),
    }));

    const { GET } = await import('@/app/api/v1/projects/[id]/sections/route');
    const req = new Request('http://localhost/api/v1/projects/' + PROJECT_ID + '/sections');
    const res = await GET(req, { params: { id: PROJECT_ID } });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/sections-api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GET sections route**

Create `app/src/app/api/v1/projects/[id]/sections/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace } from '@/lib/ai/orchestrator/workspace';
import { Errors, FondEUError } from '@/lib/errors';

type Params = { params: { id: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        Errors.validation('id', 'ID de proiect invalid', 'Invalid project ID').toResponse('ro'),
        { status: 400 },
      );
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace) {
      return NextResponse.json(
        Errors.notFound('project', id).toResponse('ro'),
        { status: 404 },
      );
    }

    return NextResponse.json({
      sections: workspace.sections,
      sessionId: workspace.session?.id ?? null,
      source: workspace.mode,
      readOnly: workspace.mode === 'snapshot',
      version: workspace.snapshotDoc?.version ?? 0,
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/sections-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/app/api/v1/projects/\[id\]/sections/route.ts app/tests/integration/sections-api.test.ts && git commit -m "feat(workspace): add GET /api/v1/projects/:id/sections endpoint"
```

---

### Task 5: PATCH Section + State Transition + Export APIs

**Files:**
- Create: `app/src/app/api/v1/projects/[id]/sections/[sectionId]/route.ts`
- Create: `app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts`
- Create: `app/src/app/api/v1/projects/[id]/sections/[sectionId]/export/route.ts`
- Test: `app/tests/integration/sections-api.test.ts` (append)

- [ ] **Step 1: Add PATCH test to sections-api.test.ts**

Append to `app/tests/integration/sections-api.test.ts`:

```typescript
describe('PATCH /api/v1/projects/:id/sections/:sectionId', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns 400 when workspace is read-only (snapshot mode)', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID }),
    }));
    vi.doMock('@/lib/ai/orchestrator/workspace', () => ({
      resolveProjectWorkspace: vi.fn().mockResolvedValue({
        project: { id: PROJECT_ID },
        session: null,
        mode: 'snapshot',
        sections: [],
      }),
      editProjectSection: vi.fn(),
    }));

    const { PATCH } = await import('@/app/api/v1/projects/[id]/sections/[sectionId]/route');
    const req = new Request('http://localhost/test', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'New', expectedCurrentVersion: 1 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, { params: { id: PROJECT_ID, sectionId: 'sec-1' } });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/sections-api.test.ts`
Expected: FAIL

- [ ] **Step 3: Create PATCH/GET single section route**

Create `app/src/app/api/v1/projects/[id]/sections/[sectionId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace, editProjectSection } from '@/lib/ai/orchestrator/workspace';
import { SectionVersionError } from '@/lib/ai/orchestrator/section-versions';
import { editSectionContentSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';

type Params = { params: { id: string; sectionId: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROR_STATUS: Record<string, number> = {
  SectionNotFound: 404,
  ConcurrentModification: 409,
};

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, sectionId } = params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace) {
      return NextResponse.json(Errors.notFound('project', id).toResponse('ro'), { status: 404 });
    }

    const section = workspace.sections.find((s) => s.id === sectionId);
    if (!section) {
      return NextResponse.json(Errors.notFound('section', sectionId).toResponse('ro'), { status: 404 });
    }

    return NextResponse.json({
      section,
      sessionId: workspace.session?.id ?? null,
      source: workspace.mode,
      readOnly: workspace.mode === 'snapshot',
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, sectionId } = params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace) {
      return NextResponse.json(Errors.notFound('project', id).toResponse('ro'), { status: 404 });
    }

    if (workspace.mode === 'snapshot' || !workspace.session) {
      return NextResponse.json(
        Errors.validation('session', 'Nu se poate edita fără o sesiune activă', 'Cannot edit without an active session').toResponse('ro'),
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = editSectionContentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 });
    }

    const section = await editProjectSection({
      sessionId: workspace.session.id,
      sectionId,
      content: parsed.data.content,
      title: parsed.data.title,
      expectedCurrentVersion: parsed.data.expectedCurrentVersion,
      userId: user.id,
    });

    return NextResponse.json({ section });
  } catch (error) {
    if (error instanceof SectionVersionError) {
      return NextResponse.json(
        { code: error.code, message: error.message, ...(error.details ?? {}) },
        { status: ERROR_STATUS[error.code] ?? 500 },
      );
    }
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
```

- [ ] **Step 4: Create state transition proxy route**

Create `app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace, syncProjectDocumentSnapshot } from '@/lib/ai/orchestrator/workspace';
import { transitionSectionState, SectionVersionError } from '@/lib/ai/orchestrator/section-versions';
import { transitionSectionStateSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';

type Params = { params: { id: string; sectionId: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROR_STATUS: Record<string, number> = {
  SectionNotFound: 404,
  InvalidStateTransition: 400,
  FailedSectionCannotBeApproved: 400,
  ConcurrentModification: 409,
  VersionIntegrityMismatch: 500,
};

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, sectionId } = params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace || !workspace.session) {
      return NextResponse.json(
        Errors.validation('session', 'Nu se poate modifica fără o sesiune activă', 'Cannot modify without an active session').toResponse('ro'),
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = transitionSectionStateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const section = await transitionSectionState({
      sessionId: workspace.session.id,
      sectionId,
      toState: parsed.data.state,
      expectedCurrentVersion: parsed.data.expectedCurrentVersion,
      userId: user.id,
      reason: parsed.data.reason,
    });

    // Best-effort snapshot sync after state change.
    // Must re-read session row because transitionSectionState() updated it
    // in its own transaction — workspace.session.context is stale.
    try {
      const { db } = await import('@/lib/db');
      const { workflowSessions } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const [freshSession] = await db
        .select({ context: workflowSessions.context })
        .from(workflowSessions)
        .where(eq(workflowSessions.id, workspace.session!.id))
        .limit(1);
      const freshCtx = freshSession?.context as { projectSections?: SectionResult[] } | null;
      if (freshCtx?.projectSections) {
        await syncProjectDocumentSnapshot(id, freshCtx.projectSections);
      }
    } catch {
      // Best-effort — snapshot may be stale until next edit
    }

    return NextResponse.json({ section });
  } catch (error) {
    if (error instanceof SectionVersionError) {
      return NextResponse.json(
        { code: error.code, message: error.message, ...(error.details ?? {}) },
        { status: ERROR_STATUS[error.code] ?? 500 },
      );
    }
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
```

- [ ] **Step 5: Create section export route**

Create `app/src/app/api/v1/projects/[id]/sections/[sectionId]/export/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace } from '@/lib/ai/orchestrator/workspace';
import { generateSectionDocx } from '@/lib/export/section-docx';
import { Errors, FondEUError } from '@/lib/errors';

type Params = { params: { id: string; sectionId: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, sectionId } = params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace) {
      return NextResponse.json(Errors.notFound('project', id).toResponse('ro'), { status: 404 });
    }

    const section = workspace.sections.find((s) => s.id === sectionId);
    if (!section) {
      return NextResponse.json(Errors.notFound('section', sectionId).toResponse('ro'), { status: 404 });
    }

    const buffer = generateSectionDocx({
      title: section.title,
      content: section.content,
      order: section.order,
    });

    const filename = `${section.order}-${section.title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.docx`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
```

- [ ] **Step 6: Run tests**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/integration/sections-api.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/app/api/v1/projects/\[id\]/sections/ app/tests/integration/sections-api.test.ts && git commit -m "feat(workspace): add PATCH section, state transition, and export API endpoints"
```

---

### Task 6: Workspace Aggregate API + Engine Cleanup + Export Fix

**Files:**
- Create: `app/src/app/api/v1/workspace/route.ts`
- Modify: `app/src/lib/ai/orchestrator/engine.ts`
- Modify: `app/src/app/api/v1/projects/[id]/export/route.ts`

- [ ] **Step 1: Create workspace aggregate endpoint**

Create `app/src/app/api/v1/workspace/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { db } from '@/lib/db';
import { projects, workflowSessions, projectDocuments, projectFiles } from '@/lib/db/schema';
import { eq, and, inArray, isNull, desc, sql, count } from 'drizzle-orm';
import { Errors, FondEUError } from '@/lib/errors';
import { normalizeSections } from '@/lib/ai/orchestrator/workspace';
import type { SectionResult } from '@/lib/ai/orchestrator/types';

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth();

    // Load user's projects (max 50)
    const userProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.userId, user.id), isNull(projects.deletedAt)))
      .orderBy(desc(projects.updatedAt))
      .limit(50);

    if (userProjects.length === 0) {
      return NextResponse.json({ projects: [] });
    }

    const projectIds = userProjects.map((p) => p.id);

    // Load best session per project (active/paused preferred, then completed)
    const allSessions = await db
      .select()
      .from(workflowSessions)
      .where(and(
        inArray(workflowSessions.projectId, projectIds),
        eq(workflowSessions.userId, user.id),
        inArray(workflowSessions.status, ['active', 'paused', 'completed']),
      ))
      .orderBy(desc(workflowSessions.updatedAt));

    // Pick best session per project
    const sessionByProject = new Map<string, typeof workflowSessions.$inferSelect>();
    for (const s of allSessions) {
      if (!s.projectId) continue;
      const existing = sessionByProject.get(s.projectId);
      if (!existing) {
        sessionByProject.set(s.projectId, s);
      } else if (
        ['active', 'paused'].includes(s.status) &&
        !['active', 'paused'].includes(existing.status)
      ) {
        sessionByProject.set(s.projectId, s);
      }
    }

    // Load snapshot docs
    const allDocs = await db
      .select()
      .from(projectDocuments)
      .where(inArray(projectDocuments.projectId, projectIds))
      .orderBy(desc(projectDocuments.version));

    const docByProject = new Map<string, typeof projectDocuments.$inferSelect>();
    for (const d of allDocs) {
      if (!docByProject.has(d.projectId)) {
        docByProject.set(d.projectId, d);
      }
    }

    // Count uploaded files per project (exclude generated DOCX artifacts)
    const fileCounts = await db
      .select({
        projectId: projectFiles.projectId,
        fileCount: count().as('file_count'),
      })
      .from(projectFiles)
      .where(and(
        inArray(projectFiles.projectId, projectIds),
        eq(projectFiles.category, 'uploaded'),
      ))
      .groupBy(projectFiles.projectId);

    const fileCountMap = new Map(fileCounts.map((f) => [f.projectId, Number(f.fileCount)]));

    // Build response
    const result = userProjects.map((p) => {
      const session = sessionByProject.get(p.id);
      const doc = docByProject.get(p.id);

      let sections: SectionResult[] = [];
      let mode: 'session' | 'snapshot' = 'snapshot';

      if (session) {
        const ctx = session.context as { projectSections?: unknown[] } | null;
        sections = normalizeSections(ctx?.projectSections ?? [], session.createdAt.toISOString());
        mode = 'session';
      } else if (doc) {
        sections = normalizeSections((doc.sections ?? []) as unknown[], doc.createdAt.toISOString());
      }

      const stateBreakdown = { draft: 0, reviewed: 0, approved: 0 };
      for (const s of sections) {
        if (s.state in stateBreakdown) stateBreakdown[s.state as keyof typeof stateBreakdown]++;
      }

      return {
        id: p.id,
        title: p.title,
        sectionCount: sections.length,
        stateBreakdown,
        lastEditedAt: (session?.updatedAt ?? doc?.updatedAt ?? p.updatedAt).toISOString(),
        mode,
        hasUploadedFiles: (fileCountMap.get(p.id) ?? 0) > 0,
      };
    });

    return NextResponse.json({ projects: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
```

- [ ] **Step 2: Remove per-section DOCX generation from engine**

In `app/src/lib/ai/orchestrator/engine.ts`, remove lines 391-405 (the for-loop that generates a DOCX per section and uploads to GCS). Keep the submission forms generation below it (starting around line 410).

The section to remove looks like:

```typescript
    for (const section of sections) {
      const buffer = generateSectionDocx({ title: section.title, content: section.content, order: section.order })
      const storagePath = buildSectionStoragePath(project.id, section.order, section.title)
      const savedPath = await putObject(storagePath, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      await db.insert(projectFiles).values({
        projectId: project.id,
        userId: ctx.userId,
        filename: storagePath.split('/').pop()!,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: buffer.length,
        storagePath: savedPath,
        category: 'generated',
        description: `Secțiune propunere: ${section.title}`,
      })
    }
```

Also clean up the imports at line 387 — remove `generateSectionDocx` and `buildSectionStoragePath` from the dynamic import (keep `generateFormDocx` and `buildFormStoragePath`).

- [ ] **Step 3: Update export route to use resolveProjectWorkspace**

Replace the content of `app/src/app/api/v1/projects/[id]/export/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace } from '@/lib/ai/orchestrator/workspace';
import { generateDocx } from '@/lib/export/docx';
import { Errors, FondEUError } from '@/lib/errors';
import type { SectionResult } from '@/lib/ai/orchestrator/types';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const projectId = params.id;
    const format = req.nextUrl.searchParams.get('format') || 'docx';

    if (format !== 'docx') {
      return NextResponse.json(
        Errors.validation('format', 'Only DOCX export is currently supported', 'Doar export DOCX este disponibil momentan').toResponse('ro'),
        { status: 400 },
      );
    }

    // Use resolveProjectWorkspace — reads from session if available, falls back to snapshot
    const workspace = await resolveProjectWorkspace(projectId, user.id);
    if (!workspace) {
      return NextResponse.json(Errors.notFound('project', projectId).toResponse('ro'), { status: 404 });
    }

    if (workspace.sections.length === 0) {
      return NextResponse.json(
        Errors.validation('sections', 'No project sections found for export', 'Nu există secțiuni de proiect pentru export').toResponse('ro'),
        { status: 400 },
      );
    }

    const buffer = await generateDocx(workspace.sections, {
      projectTitle: workspace.project.title,
      program: undefined,
    });

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${workspace.project.title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.docx"`,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run`
Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/app/api/v1/workspace/route.ts app/src/lib/ai/orchestrator/engine.ts app/src/app/api/v1/projects/\[id\]/export/route.ts && git commit -m "feat(workspace): add aggregate API, remove per-section DOCX, fix export to read from session"
```

---

### Task 7: Install Dependencies + UI Components

**Files:**
- Create: `app/src/components/ui/markdown-render.tsx`
- Create: `app/src/components/ui/section-state-badge.tsx`
- Create: `app/src/components/editor/section-editor.tsx`

- [ ] **Step 1: Install dependencies**

```bash
cd /home/godja/Dev/EU-Funds/app && npm install @mdxeditor/editor react-markdown remark-gfm rehype-sanitize
```

- [ ] **Step 2: Create MarkdownRender component**

Create `app/src/components/ui/markdown-render.tsx`:

```typescript
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownRenderProps {
  content: string;
  className?: string;
}

export function MarkdownRender({ content, className }: MarkdownRenderProps) {
  return (
    <div className={`prose prose-sm max-w-none text-on-surface-variant ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-on-surface mt-4 mb-1.5">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-on-surface mt-3 mb-1">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-sm text-on-surface-variant leading-relaxed my-1.5">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-5 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-5 my-2 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-on-surface-variant leading-relaxed">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-on-surface">{children}</strong>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-sm border border-outline-variant/20">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-outline-variant/20 px-3 py-1.5 bg-surface-container text-left font-semibold text-on-surface">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-outline-variant/20 px-3 py-1.5">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: Create SectionStateBadge component**

Create `app/src/components/ui/section-state-badge.tsx`:

```typescript
interface SectionStateBadgeProps {
  state: 'draft' | 'reviewed' | 'approved';
  className?: string;
}

const STATE_CONFIG: Record<string, { label: string; labelEn: string; className: string }> = {
  draft: { label: 'Ciornă', labelEn: 'Draft', className: 'bg-surface-container text-on-surface-variant' },
  reviewed: { label: 'Verificat', labelEn: 'Reviewed', className: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Aprobat', labelEn: 'Approved', className: 'bg-green-50 text-green-700' },
};

export function SectionStateBadge({ state, className }: SectionStateBadgeProps) {
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className} ${className ?? ''}`}>
      {config.label}
    </span>
  );
}
```

- [ ] **Step 4: Create MDXEditor wrapper**

Create `app/src/components/editor/section-editor.tsx`:

```typescript
'use client';

import dynamic from 'next/dynamic';
import { forwardRef } from 'react';

const MDXEditor = dynamic(
  () => import('@mdxeditor/editor').then((mod) => {
    const { MDXEditor, headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, linkPlugin, toolbarPlugin, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, CreateLink } = mod;

    const Editor = forwardRef<unknown, { markdown: string; onChange: (md: string) => void; readOnly?: boolean }>(
      function EditorInner({ markdown, onChange, readOnly }, _ref) {
        return (
          <MDXEditor
            markdown={markdown}
            onChange={onChange}
            readOnly={readOnly}
            contentEditableClassName="prose prose-sm max-w-none min-h-[400px] p-4 text-on-surface-variant focus:outline-none"
            plugins={[
              headingsPlugin(),
              listsPlugin(),
              quotePlugin(),
              thematicBreakPlugin(),
              linkPlugin(),
              ...(readOnly ? [] : [toolbarPlugin({
                toolbarContents: () => (
                  <>
                    <BlockTypeSelect />
                    <BoldItalicUnderlineToggles />
                    <ListsToggle />
                    <CreateLink />
                  </>
                ),
              })]),
            ]}
          />
        );
      },
    );
    Editor.displayName = 'MDXEditorInner';
    return Editor;
  }),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-surface-container rounded-xl min-h-[400px]" />
    ),
  },
);

interface SectionEditorProps {
  value: string;
  onChange: (md: string) => void;
  readOnly?: boolean;
}

export function SectionEditor({ value, onChange, readOnly }: SectionEditorProps) {
  return (
    <div className="border border-outline-variant/20 rounded-xl overflow-hidden bg-surface">
      <MDXEditor markdown={value} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit`
Expected: No type errors from new components.

- [ ] **Step 6: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/package.json app/package-lock.json app/src/components/ui/markdown-render.tsx app/src/components/ui/section-state-badge.tsx app/src/components/editor/section-editor.tsx && git commit -m "feat(workspace): install editor deps, add MarkdownRender, SectionStateBadge, SectionEditor components"
```

---

### Task 8: i18n Keys

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`

- [ ] **Step 1: Add Romanian translations**

Add to `app/src/messages/ro.json` inside the top-level object (after the last existing key):

```json
  "sectionEditor": {
    "save": "Salvează",
    "saving": "Se salvează...",
    "saved": "Salvat",
    "exportDocx": "Exportă DOCX",
    "exportFullDocx": "Exportă Propunerea DOCX",
    "backToProject": "Înapoi la Proiect",
    "unsavedChanges": "Aveți modificări nesalvate. Sigur doriți să părăsiți pagina?",
    "version": "Versiunea {version}",
    "editTitle": "Editează titlul",
    "stateDraft": "Ciornă",
    "stateReviewed": "Verificat",
    "stateApproved": "Aprobat",
    "lastEdited": "Ultima editare {time}",
    "autoSaved": "Salvat automat",
    "conflictError": "Secțiunea a fost modificată de altcineva. Reîncărcați pentru a vedea ultima versiune.",
    "readOnlyBanner": "Vizualizare. Porniți o sesiune AI pentru a edita.",
    "noSections": "Nicio secțiune generată. Folosiți Asistentul AI pentru a crea propunerea.",
    "sectionCount": "{count} secțiuni",
    "openWorkspace": "Deschide Spațiul de Lucru"
  },
  "workspace": {
    "title": "Documente",
    "subtitle": "Spațiul de lucru pentru propuneri",
    "generatedDocuments": "Documente Generate",
    "uploadedFiles": "Fișiere Încărcate",
    "noProjects": "Niciun proiect cu secțiuni generate.",
    "filterAll": "Toate",
    "filterDraft": "Ciornă",
    "filterReviewed": "Verificat",
    "filterApproved": "Aprobat"
  }
```

- [ ] **Step 2: Add English translations**

Add the same structure to `app/src/messages/en.json`:

```json
  "sectionEditor": {
    "save": "Save",
    "saving": "Saving...",
    "saved": "Saved",
    "exportDocx": "Export DOCX",
    "exportFullDocx": "Export Proposal DOCX",
    "backToProject": "Back to Project",
    "unsavedChanges": "You have unsaved changes. Are you sure you want to leave?",
    "version": "Version {version}",
    "editTitle": "Edit title",
    "stateDraft": "Draft",
    "stateReviewed": "Reviewed",
    "stateApproved": "Approved",
    "lastEdited": "Last edited {time}",
    "autoSaved": "Auto-saved",
    "conflictError": "This section has been modified by someone else. Reload to see the latest version.",
    "readOnlyBanner": "View only. Start an AI session to edit.",
    "noSections": "No sections generated yet. Use the AI Assistant to create your proposal.",
    "sectionCount": "{count} sections",
    "openWorkspace": "Open Workspace"
  },
  "workspace": {
    "title": "Documents",
    "subtitle": "Proposal workspace",
    "generatedDocuments": "Generated Documents",
    "uploadedFiles": "Uploaded Files",
    "noProjects": "No projects with generated sections.",
    "filterAll": "All",
    "filterDraft": "Draft",
    "filterReviewed": "Reviewed",
    "filterApproved": "Approved"
  }
```

- [ ] **Step 3: Add sections tab key to projectDetail**

In both `ro.json` and `en.json`, add `"sections": "Secțiuni"` / `"sections": "Sections"` inside `"projectDetail" > "tabs"` object (alongside the existing `overview`, `documents`, `tasks`, `timeline` keys).

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/messages/ro.json app/src/messages/en.json && git commit -m "feat(workspace): add i18n keys for section editor and workspace"
```

---

### Task 9: Section Editor Page

**Files:**
- Create: `app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx`

- [ ] **Step 1: Create the section editor page**

Create `app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';
import { SectionStateBadge } from '@/components/ui/section-state-badge';
import { SectionEditor } from '@/components/editor/section-editor';
import type { SectionResult } from '@/lib/ai/orchestrator/types';

type SectionsResponse = {
  sections: SectionResult[];
  sessionId: string | null;
  source: 'session' | 'snapshot';
  readOnly: boolean;
};

export default function SectionEditorPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('sectionEditor');
  const projectId = params.id as string;
  const sectionId = params.sectionId as string;

  const [section, setSection] = useState<SectionResult | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef<number>(0);

  // Fetch section data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/sections`);
        if (!res.ok) throw new Error('Failed to load sections');
        const data: SectionsResponse = await res.json();
        const sec = data.sections.find((s) => s.id === sectionId);
        if (!sec) throw new Error('Section not found');

        setSection(sec);
        setContent(sec.content);
        setTitle(sec.title);
        setReadOnly(data.readOnly);
        versionRef.current = sec.currentVersion;
      } catch {
        setError('Failed to load section');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, sectionId]);

  // Auto-save
  const save = useCallback(async (contentToSave: string, titleToSave: string) => {
    if (readOnly || !section) return;
    setSaveStatus('saving');
    setError(null);

    try {
      const res = await fetch(`/api/v1/projects/${projectId}/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentToSave,
          title: titleToSave,
          expectedCurrentVersion: versionRef.current,
        }),
      });

      if (res.status === 409) {
        setError(t('conflictError'));
        setSaveStatus('error');
        return;
      }

      if (!res.ok) throw new Error('Save failed');

      const data = await res.json();
      versionRef.current = data.section.currentVersion;
      setSection(data.section);
      setIsDirty(false);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [projectId, sectionId, readOnly, section, t]);

  // Debounced auto-save on content change
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setIsDirty(true);
    setSaveStatus('idle');

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      save(newContent, title);
    }, 3000);
  }, [save, title]);

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-8 space-y-6">
        <div className="animate-pulse bg-surface-container rounded-xl h-8 w-48" />
        <div className="animate-pulse bg-surface-container rounded-xl h-[500px]" />
      </div>
    );
  }

  if (error && !section) {
    return (
      <div className="max-w-5xl mx-auto py-8 text-center">
        <p className="text-on-surface-variant">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8">
      {/* Breadcrumb */}
      <button
        onClick={() => router.push(`/${params.locale}/proiecte/${projectId}?tab=sections`)}
        className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface mb-6 transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t('backToProject')}
      </button>

      {/* Read-only banner */}
      {readOnly && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-700">
          {t('readOnlyBanner')}
        </div>
      )}

      {/* Title + status bar */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1">
          {readOnly ? (
            <h1 className="text-2xl font-bold text-on-surface">{title}</h1>
          ) : (
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setIsDirty(true); }}
              className="text-2xl font-bold text-on-surface bg-transparent border-none outline-none w-full focus:ring-0 p-0"
              placeholder={t('editTitle')}
            />
          )}
          <div className="flex items-center gap-3 mt-2">
            {section && <SectionStateBadge state={section.state} />}
            <span className="text-xs text-on-surface-variant">
              {t('version', { version: versionRef.current })}
            </span>
          </div>
        </div>

        {/* Save status */}
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="text-xs text-on-surface-variant">{t('saving')}</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-green-600">{t('saved')}</span>
          )}
          {saveStatus === 'error' && error && (
            <span className="text-xs text-red-600">{error}</span>
          )}
          {!readOnly && (
            <button
              onClick={() => save(content, title)}
              disabled={!isDirty || saveStatus === 'saving'}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {t('save')}
            </button>
          )}
          <a
            href={`/api/v1/projects/${projectId}/sections/${sectionId}/export?format=docx`}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            {t('exportDocx')}
          </a>
        </div>
      </div>

      {/* Editor */}
      <SectionEditor
        value={content}
        onChange={handleContentChange}
        readOnly={readOnly}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx" && git commit -m "feat(workspace): add section editor page with auto-save and conflict handling"
```

---

### Task 10: Sections Tab + Project Detail Integration

**Files:**
- Create: `app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`

- [ ] **Step 1: Create SectionsTabContent**

Create `app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Icon } from '@/components/ui/ds-icon';
import { MarkdownRender } from '@/components/ui/markdown-render';
import { SectionStateBadge } from '@/components/ui/section-state-badge';
import type { SectionResult } from '@/lib/ai/orchestrator/types';

interface SectionsResponse {
  sections: SectionResult[];
  sessionId: string | null;
  source: 'session' | 'snapshot';
  readOnly: boolean;
}

export function SectionsTabContent({ projectId }: { projectId: string }) {
  const params = useParams();
  const locale = params.locale as string;
  const t = useTranslations('sectionEditor');
  const [data, setData] = useState<SectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/sections`);
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse bg-surface-container rounded-xl h-32" />
        ))}
      </div>
    );
  }

  if (!data || data.sections.length === 0) {
    return (
      <div className="text-center py-16">
        <Icon name="article" size={48} className="text-on-surface-variant/30 mx-auto mb-4" />
        <p className="text-on-surface-variant">{t('noSections')}</p>
      </div>
    );
  }

  const sorted = [...data.sections].sort((a, b) => a.order - b.order);

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-on-surface-variant">
          {t('sectionCount', { count: data.sections.length })}
        </p>
        <a
          href={`/api/v1/projects/${projectId}/export?format=docx`}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 transition-colors"
        >
          <Icon name="download" size={16} />
          {t('exportFullDocx')}
        </a>
      </div>

      {/* Section cards */}
      <div className="space-y-3">
        {sorted.map((section, i) => (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-surface border border-outline-variant/15 rounded-xl p-5 hover:border-outline-variant/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-bold text-on-surface-variant bg-surface-container rounded-full w-6 h-6 flex items-center justify-center">
                    {section.order}
                  </span>
                  <h3 className="text-base font-semibold text-on-surface truncate">{section.title}</h3>
                  <SectionStateBadge state={section.state} />
                  <span className="text-xs text-on-surface-variant">v{section.currentVersion}</span>
                </div>
                <div className="line-clamp-3 overflow-hidden">
                  <MarkdownRender content={section.content.slice(0, 300)} />
                </div>
              </div>

              <a
                href={data.readOnly ? undefined : `/${locale}/proiecte/${projectId}/sectiuni/${section.id}`}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${
                  data.readOnly
                    ? 'text-on-surface-variant/50 cursor-not-allowed'
                    : 'text-primary hover:bg-primary/10'
                }`}
              >
                <Icon name={data.readOnly ? 'visibility' : 'edit'} size={16} />
                {data.readOnly ? 'View' : 'Edit'}
              </a>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Sections tab to project detail page**

Modify `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`:

1. Add import at the top:
```typescript
import { SectionsTabContent } from './components/SectionsTabContent';
```

2. Read `?tab=` query param to set initial active tab. Add `useSearchParams` import and replace the `useState` for `activeTab` (around line 453):
```typescript
// Add to imports:
import { useRouter, useParams, useSearchParams } from 'next/navigation';

// Replace: const [activeTab, setActiveTab] = useState('overview');
// With:
const searchParams = useSearchParams();
const tabParam = searchParams.get('tab');
const [activeTab, setActiveTab] = useState(tabParam ?? 'overview');
```

Note: `useSearchParams()` is hydration-safe — it returns the same value on server and client, avoiding SSR mismatch flashes that `window.location.search` would cause.

3. Add the Sections tab trigger inside the `<Tabs.List>` (around line 600, after the overview TabTrigger):
```typescript
<TabTrigger value="sections">{t('tabs.sections')}</TabTrigger>
```

4. Add the Sections tab content (after the overview `Tabs.Content` block, around line 762):
```typescript
{activeTab === 'sections' && (
  <Tabs.Content value="sections" forceMount asChild>
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
    >
      <SectionsTabContent projectId={id} />
    </motion.div>
  </Tabs.Content>
)}
```

- [ ] **Step 3: Verify build**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx" "app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx" && git commit -m "feat(workspace): add Sections tab to project detail page"
```

---

### Task 11: Rewrite Documents Page as Workspace

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/documente/page.tsx`

- [ ] **Step 1: Read current documents page**

Read `app/src/app/[locale]/(dashboard)/documente/page.tsx` to understand the current structure, motion patterns, and styling.

- [ ] **Step 2: Rewrite the documents page**

Replace the content of `app/src/app/[locale]/(dashboard)/documente/page.tsx` with a workspace layout. The page should:

- Fetch from `GET /api/v1/workspace` (single request)
- Show "Generated Documents" section with project cards showing: title, section count, state breakdown badges, last edited, mode indicator
- Each card links to `/proiecte/[id]?tab=sections`
- "Export DOCX" quick action per card
- Filter chips: All / Draft / Reviewed / Approved
- Search by project title
- Show "Uploaded Files" section below (fetch from existing `/api/v1/projects/{id}/files` for projects that have uploaded files)
- Use the same animation patterns (`motion.div`, `staggerContainer`, `staggerItem`) as the current page
- Use `useTranslations('workspace')` for all strings
- Keep the existing header/layout chrome

The full component code should follow the patterns in the existing documents page (motion imports, Icon component, responsive grid, skeleton loaders) but replace the file-card grid with project-card grid using workspace data. Each project card shows:

```
┌────────────────────────────────────────────┐
│ Project Title                    [Export]   │
│ 7 secțiuni  ●3 draft ●2 reviewed ●2 approved │
│ Last edited: Apr 5, 2026         [Open →]  │
└────────────────────────────────────────────┘
```

- [ ] **Step 3: Verify build**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Run all tests**

Run: `cd /home/godja/Dev/EU-Funds/app && npx vitest run`
Expected: All tests pass (no existing tests depend on the old documents page).

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/documente/page.tsx" && git commit -m "feat(workspace): rewrite /documente as markdown-first document workspace"
```

---

### Task 12: Final Build Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /home/godja/Dev/EU-Funds/app && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 3: Run lint**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run lint
```
Expected: No new lint errors (pre-existing ignored via `ignoreDuringBuilds`).

- [ ] **Step 4: Run build**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run build
```
Expected: Build succeeds. MDXEditor dynamic import with `ssr: false` should not cause SSR issues.

- [ ] **Step 5: Commit any fixes**

If any step above fails, fix the issue and commit:
```bash
cd /home/godja/Dev/EU-Funds && git add -A && git commit -m "fix(workspace): build/lint/type fixes"
```

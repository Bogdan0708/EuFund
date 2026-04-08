# Knowledge Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DB-backed knowledge layer to the V3 agent so each proposal compounds learning from previous sessions — reusing accepted sections, ranking patterns by smoothed success rate, and injecting project-specific context into generation with hard token budgets.

**Architecture:** Two new tables (`session_knowledge`, `proposal_patterns`) sit between agent sessions and the retrieval layer. A nullable `projectId` FK on `agent_sessions` enables cross-session compounding once projects are created. Write-back is idempotent and post-persist (inside the same try block as `persistSessionState`), not fire-and-forget async. Two separate tools — `retrieve_session_context` and `retrieve_call_evidence` — keep retrieval contracts clean. `generate_section` composes both with a hard 2500-char injection budget. Pattern ranking uses Wilson score lower bound with a minimum-support threshold.

**Tech Stack:** Drizzle ORM (PostgreSQL), Zod, Vitest, existing V3 agent tool system

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `app/src/lib/ai/knowledge/session-knowledge.ts` | CRUD for session_knowledge table |
| `app/src/lib/ai/knowledge/proposal-patterns.ts` | CRUD + Wilson-ranked retrieval for proposal_patterns |
| `app/src/lib/ai/knowledge/write-back.ts` | Idempotent post-persist hooks: section accept, phase transition, pattern distillation |
| `app/src/lib/ai/agent/tools/retrieve-session-context.ts` | Read tool: query session knowledge for drafting context |
| `app/tests/unit/session-knowledge.test.ts` | Tests for session_knowledge schema + CRUD |
| `app/tests/unit/proposal-patterns.test.ts` | Tests for proposal_patterns CRUD + Wilson ranking |
| `app/tests/unit/knowledge-write-back.test.ts` | Tests for write-back hooks |
| `app/tests/unit/agent-tool-retrieve-session-context.test.ts` | Tests for the new tool |

### Modified files
| File | Change |
|------|--------|
| `app/src/lib/db/schema.ts` | Add `session_knowledge`, `proposal_patterns` tables + `projectId` nullable FK on `agent_sessions` |
| `app/src/lib/ai/agent/types.ts` | Add `projectId` to `AgentSession`, add `knowledge_updated` checkpoint type |
| `app/src/lib/ai/agent/tools/generate-section.ts` | Compose session context + best pattern into prompt with 2500-char hard budget |
| `app/src/lib/ai/agent/tools/registry.ts` | Register `retrieve_session_context` as read tool |
| `app/src/lib/ai/agent/tools/index.ts` | Import new tool module |
| `app/src/lib/ai/agent/runtime.ts` | Call idempotent write-back inside persistSessionState path |
| `app/src/lib/ai/agent/prompt.ts` | Show session knowledge summary in system prompt |
| `app/src/app/api/ai/agent/route.ts` | Map `projectId` in `mapSessionRow` |
| `app/scripts/generate-knowledge-vault.ts` | Extend to export wiki/projects/* and wiki/patterns/* |

---

## Design Decisions (addressing code review findings)

### Finding 1: No project identity on AgentSession
**Fix:** Add nullable `projectId` FK to `agent_sessions` schema + `AgentSession` type. Phase 1 scopes all knowledge by `sessionId`. When a project is eventually created and linked (via a future `link_project` tool or completion handler), a backfill query updates `session_knowledge.projectId` — enabling cross-session retrieval. Table is named `session_knowledge` (not `project_knowledge`) to match the phase 1 reality.

### Finding 2: Retrieval tool contract underspecified
**Fix:** Keep `retrieve_call_evidence` unchanged (callId + query + maxChunks). Add a separate `retrieve_session_context` tool (sessionId from ToolContext, optional kind filter). `generate_section` composes both explicitly — no overloaded retrieval.

### Finding 3: Fire-and-forget write-back is risky
**Fix:** ALL write-back (section accept AND phase transition) runs inside `persistSessionState()` after the DB writes succeed, within the same try/catch. Uses `onConflictDoUpdate` (upsert by session+slug) so retries and duplicate calls are safe. `persistSessionState` receives a `writeBackContext` parameter carrying the action type, any phase transition that occurred, and the relevant section/phase data. No write-back code exists in the tool loop or elsewhere in `runAgentTurn`.

### Finding 4: Raw accept-rate ranking
**Fix:** Replace `timesAccepted / timesUsed` with Wilson score lower bound (95% confidence). Minimum support threshold of 3 uses — patterns below threshold sort last regardless of rate. This prevents one-hit wonders from dominating.

### Finding 5: Prompt bloat
**Fix:** Hard injection budget in `generate_section`:
- Max 1 pattern (top-ranked by Wilson score), truncated to 1500 chars
- Max 1 session brief summary, truncated to 800 chars
- **Final assembled clamp:** `MAX_KNOWLEDGE_CONTEXT_CHARS = 2500` applied to the concatenated `knowledgeContext` string AFTER assembly, before injection into the system prompt. This is the enforced hard cap — individual component limits are just pre-trim optimization.
- Pattern and brief are clearly delimited with `REFERENCE PATTERN` and `PROJECT BRIEF` headers
- These replace (not add to) the existing empty `sources: []` in the generation prompt

---

## Task 1: Schema — agent_sessions.projectId + session_knowledge + proposal_patterns

**Files:**
- Modify: `app/src/lib/db/schema.ts:870-890` (agent_sessions) and after line ~959
- Modify: `app/src/lib/ai/agent/types.ts:57-74`
- Modify: `app/src/app/api/ai/agent/route.ts:119-138`
- Test: `app/tests/unit/session-knowledge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/tests/unit/session-knowledge.test.ts
import { describe, it, expect } from 'vitest'
import {
  agentSessions,
  sessionKnowledge, sessionKnowledgeKindEnum,
  proposalPatterns,
} from '@/lib/db/schema'

describe('knowledge layer schema', () => {
  it('agent_sessions has projectId column', () => {
    expect(Object.keys(agentSessions)).toContain('projectId')
  })

  it('exports sessionKnowledge table with required columns', () => {
    const cols = Object.keys(sessionKnowledge)
    expect(cols).toContain('id')
    expect(cols).toContain('sessionId')
    expect(cols).toContain('projectId')
    expect(cols).toContain('kind')
    expect(cols).toContain('slug')
    expect(cols).toContain('title')
    expect(cols).toContain('contentMd')
    expect(cols).toContain('frontmatter')
    expect(cols).toContain('sourceRefs')
    expect(cols).toContain('derivedFromSectionId')
    expect(cols).toContain('createdAt')
    expect(cols).toContain('updatedAt')
  })

  it('exports sessionKnowledgeKindEnum with expected values', () => {
    expect(sessionKnowledgeKindEnum.enumValues).toEqual([
      'brief', 'evidence_map', 'risks', 'budget_rationale',
      'decision_log', 'section_pattern',
    ])
  })

  it('exports proposalPatterns table with required columns', () => {
    const cols = Object.keys(proposalPatterns)
    expect(cols).toContain('id')
    expect(cols).toContain('program')
    expect(cols).toContain('sectionType')
    expect(cols).toContain('title')
    expect(cols).toContain('contentMd')
    expect(cols).toContain('frontmatter')
    expect(cols).toContain('derivedFromSections')
    expect(cols).toContain('timesUsed')
    expect(cols).toContain('timesAccepted')
    expect(cols).toContain('avgRegenCount')
    expect(cols).toContain('lastUsedAt')
    expect(cols).toContain('createdAt')
    expect(cols).toContain('updatedAt')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/session-knowledge.test.ts`
Expected: FAIL — `sessionKnowledge` not exported, `agentSessions` missing `projectId`

- [ ] **Step 3: Add projectId to agent_sessions schema**

In `app/src/lib/db/schema.ts`, add to the `agentSessions` table definition (after `userId` line ~872):

```typescript
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
```

- [ ] **Step 4: Add session_knowledge and proposal_patterns tables**

In `app/src/lib/db/schema.ts`, add after the `agentCheckpoints` table (after line ~959, before `discoveredCalls`):

```typescript
// ── Knowledge Layer Tables ─────────────────────────────────────

export const sessionKnowledgeKindEnum = pgEnum('session_knowledge_kind', [
  'brief', 'evidence_map', 'risks', 'budget_rationale',
  'decision_log', 'section_pattern',
])

export const sessionKnowledge = pgTable('session_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  kind: sessionKnowledgeKindEnum('kind').notNull(),
  slug: varchar('slug', { length: 200 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  contentMd: text('content_md').notNull(),
  frontmatter: jsonb('frontmatter').notNull().default({}),
  sourceRefs: jsonb('source_refs').notNull().default([]),
  derivedFromSectionId: uuid('derived_from_section_id').references(() => agentSections.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxSessionKind: index('idx_session_knowledge_session_kind').on(table.sessionId, table.kind),
  idxProjectKind: index('idx_session_knowledge_project_kind').on(table.projectId, table.kind),
  uniqSessionSlug: uniqueIndex('uniq_session_knowledge_session_slug').on(table.sessionId, table.slug),
}))

export const proposalPatterns = pgTable('proposal_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  program: varchar('program', { length: 50 }).notNull(),
  sectionType: varchar('section_type', { length: 100 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  contentMd: text('content_md').notNull(),
  frontmatter: jsonb('frontmatter').notNull().default({}),
  derivedFromSections: jsonb('derived_from_sections').notNull().default([]),
  timesUsed: integer('times_used').notNull().default(0),
  timesAccepted: integer('times_accepted').notNull().default(0),
  avgRegenCount: real('avg_regen_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxProgramSection: index('idx_proposal_patterns_program_section').on(table.program, table.sectionType),
  idxTimesUsed: index('idx_proposal_patterns_used').on(table.timesUsed),
}))
```

- [ ] **Step 5: Add projectId to AgentSession type**

In `app/src/lib/ai/agent/types.ts`, update the `AgentSession` interface:

```typescript
export interface AgentSession {
  id: string
  userId: string
  projectId: string | null  // ← ADD THIS LINE
  status: SessionStatus
  // ... rest unchanged
```

- [ ] **Step 6: Add knowledge_updated checkpoint type**

In `app/src/lib/ai/agent/types.ts`, update `CHECKPOINT_TYPES`:

```typescript
export const CHECKPOINT_TYPES = [
  'call_selected', 'structure_approved', 'section_accepted', 'section_regenerated',
  'call_changed', 'structure_changed', 'proposal_completed', 'knowledge_updated',
] as const
```

- [ ] **Step 7: Update mapSessionRow in the API route**

In `app/src/app/api/ai/agent/route.ts`, add to `mapSessionRow`:

```typescript
    projectId: (row.projectId as string) ?? null,
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/session-knowledge.test.ts`
Expected: PASS

- [ ] **Step 9: Generate migration**

Run: `cd app && npm run db:generate`
Expected: New migration for `agent_sessions.project_id`, `session_knowledge`, `proposal_patterns`

- [ ] **Step 10: Commit**

```bash
cd app && git add src/lib/db/schema.ts src/lib/ai/agent/types.ts src/app/api/ai/agent/route.ts tests/unit/session-knowledge.test.ts drizzle/
git commit -m "feat: add session_knowledge, proposal_patterns tables and projectId on agent_sessions"
```

---

## Task 2: session-knowledge CRUD module

**Files:**
- Create: `app/src/lib/ai/knowledge/session-knowledge.ts`
- Test: `app/tests/unit/session-knowledge.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/unit/session-knowledge.test.ts`:

```typescript
import { vi } from 'vitest'

const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{
        id: '33333333-3333-4333-8333-333333333333',
        sessionId: '11111111-1111-4111-8111-111111111111',
        kind: 'brief',
        slug: 'project-brief',
        title: 'Project Brief',
        contentMd: '# Brief\nSolar energy project',
        frontmatter: { program: 'PNRR' },
        sourceRefs: [],
        derivedFromSectionId: null,
      }]),
    }),
  }),
})

const mockSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockResolvedValue([
        { id: '33333333-3333-4333-8333-333333333333', kind: 'brief', slug: 'project-brief', title: 'Project Brief', contentMd: '# Brief' },
      ]),
    }),
  }),
})

vi.mock('@/lib/db', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import {
  upsertSessionKnowledge,
  getSessionKnowledge,
  getSessionKnowledgeByKind,
} from '@/lib/ai/knowledge/session-knowledge'

describe('session-knowledge CRUD', () => {
  it('upsertSessionKnowledge inserts or updates by session+slug', async () => {
    const result = await upsertSessionKnowledge({
      sessionId: '11111111-1111-4111-8111-111111111111',
      kind: 'brief',
      slug: 'project-brief',
      title: 'Project Brief',
      contentMd: '# Brief\nSolar energy project',
      frontmatter: { program: 'PNRR' },
    })
    expect(result).toBeDefined()
    expect(mockInsert).toHaveBeenCalled()
  })

  it('getSessionKnowledge returns all knowledge for a session', async () => {
    const rows = await getSessionKnowledge('11111111-1111-4111-8111-111111111111')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].kind).toBe('brief')
  })

  it('getSessionKnowledgeByKind filters by kind', async () => {
    const rows = await getSessionKnowledgeByKind(
      '11111111-1111-4111-8111-111111111111',
      'brief',
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/session-knowledge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// app/src/lib/ai/knowledge/session-knowledge.ts
import { db } from '@/lib/db'
import { sessionKnowledge } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'session-knowledge' })

export type KnowledgeKind = 'brief' | 'evidence_map' | 'risks' | 'budget_rationale' | 'decision_log' | 'section_pattern'

export interface UpsertKnowledgeInput {
  sessionId: string
  projectId?: string
  kind: KnowledgeKind
  slug: string
  title: string
  contentMd: string
  frontmatter?: Record<string, unknown>
  sourceRefs?: string[]
  derivedFromSectionId?: string
}

export async function upsertSessionKnowledge(input: UpsertKnowledgeInput) {
  const [row] = await db.insert(sessionKnowledge).values({
    sessionId: input.sessionId,
    projectId: input.projectId ?? null,
    kind: input.kind,
    slug: input.slug,
    title: input.title,
    contentMd: input.contentMd,
    frontmatter: input.frontmatter ?? {},
    sourceRefs: input.sourceRefs ?? [],
    derivedFromSectionId: input.derivedFromSectionId ?? null,
  }).onConflictDoUpdate({
    target: [sessionKnowledge.sessionId, sessionKnowledge.slug],
    set: {
      title: input.title,
      contentMd: input.contentMd,
      frontmatter: input.frontmatter ?? {},
      sourceRefs: input.sourceRefs ?? [],
      derivedFromSectionId: input.derivedFromSectionId ?? null,
      updatedAt: new Date(),
    },
  }).returning()

  log.info({ sessionId: input.sessionId, slug: input.slug, kind: input.kind }, 'Session knowledge upserted')
  return row
}

export async function getSessionKnowledge(sessionId: string) {
  return db.select()
    .from(sessionKnowledge)
    .where(eq(sessionKnowledge.sessionId, sessionId))
    .orderBy(asc(sessionKnowledge.kind))
}

export async function getSessionKnowledgeByKind(sessionId: string, kind: KnowledgeKind) {
  return db.select()
    .from(sessionKnowledge)
    .where(and(
      eq(sessionKnowledge.sessionId, sessionId),
      eq(sessionKnowledge.kind, kind),
    ))
    .orderBy(asc(sessionKnowledge.slug))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/session-knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/knowledge/session-knowledge.ts tests/unit/session-knowledge.test.ts
git commit -m "feat: add session-knowledge CRUD module"
```

---

## Task 3: proposal-patterns CRUD with Wilson score ranking

**Files:**
- Create: `app/src/lib/ai/knowledge/proposal-patterns.ts`
- Test: `app/tests/unit/proposal-patterns.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// app/tests/unit/proposal-patterns.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([{
      id: '44444444-4444-4444-8444-444444444444',
      program: 'PNRR',
      sectionType: 'methodology',
    }]),
  }),
})

vi.mock('@/lib/db', () => ({
  db: {
    insert: mockInsert,
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import {
  createPattern,
  wilsonScore,
  rankPatterns,
  recordPatternUsage,
} from '@/lib/ai/knowledge/proposal-patterns'

describe('proposal-patterns', () => {
  it('createPattern inserts a new pattern', async () => {
    const result = await createPattern({
      program: 'PNRR',
      sectionType: 'methodology',
      title: 'Strong methodology for green infrastructure',
      contentMd: '## Methodology\nPhased approach...',
      derivedFromSections: [{ sessionId: 's1', sectionKey: 'methodology', acceptedAt: '2026-04-08' }],
    })
    expect(result).toBeDefined()
    expect(mockInsert).toHaveBeenCalled()
  })

  describe('wilsonScore', () => {
    it('returns 0 for zero uses', () => {
      expect(wilsonScore(0, 0)).toBe(0)
    })

    it('returns lower bound for 1/1 (not 1.0)', () => {
      const score = wilsonScore(1, 1)
      // Wilson lower bound for 1/1 at 95% ≈ 0.05 — definitely less than 1.0
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(0.9)
    })

    it('ranks 8/10 higher than 1/1', () => {
      const high = wilsonScore(10, 8)
      const oneHit = wilsonScore(1, 1)
      expect(high).toBeGreaterThan(oneHit)
    })

    it('ranks 80/100 higher than 8/10 (more data = tighter bounds)', () => {
      const large = wilsonScore(100, 80)
      const small = wilsonScore(10, 8)
      expect(large).toBeGreaterThan(small)
    })
  })

  describe('rankPatterns', () => {
    const patterns = [
      { id: 'a', timesUsed: 10, timesAccepted: 8, avgRegenCount: 0.5 },
      { id: 'b', timesUsed: 10, timesAccepted: 3, avgRegenCount: 2.1 },
      { id: 'c', timesUsed: 1, timesAccepted: 1, avgRegenCount: 0 },
      { id: 'd', timesUsed: 0, timesAccepted: 0, avgRegenCount: 0 },
    ] as any[]

    it('sorts patterns below minSupport threshold last', () => {
      const ranked = rankPatterns(patterns, { minSupport: 3 })
      // 'a' and 'b' have 10 uses (above threshold), 'c' has 1, 'd' has 0
      expect(ranked[0].id).toBe('a')
      expect(ranked[ranked.length - 1].id).toBe('d')
      expect(ranked[ranked.length - 2].id).toBe('c')
    })

    it('ranks by Wilson score within threshold group', () => {
      const ranked = rankPatterns(patterns, { minSupport: 3 })
      // 'a' (8/10) should rank above 'b' (3/10)
      const aIdx = ranked.findIndex((p: any) => p.id === 'a')
      const bIdx = ranked.findIndex((p: any) => p.id === 'b')
      expect(aIdx).toBeLessThan(bIdx)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/proposal-patterns.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// app/src/lib/ai/knowledge/proposal-patterns.ts
import { db } from '@/lib/db'
import { proposalPatterns } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'proposal-patterns' })

// ── Wilson Score Lower Bound ───────────────────────────────────
// Prevents one-hit wonders from dominating rankings.
// z = 1.96 for 95% confidence interval.

const Z = 1.96
const Z2 = Z * Z

export function wilsonScore(n: number, successes: number): number {
  if (n === 0) return 0
  const p = successes / n
  const denominator = 1 + Z2 / n
  const centre = p + Z2 / (2 * n)
  const spread = Z * Math.sqrt((p * (1 - p) + Z2 / (4 * n)) / n)
  return (centre - spread) / denominator
}

// ── CRUD ───────────────────────────────────────────────────────

export interface CreatePatternInput {
  program: string
  sectionType: string
  title: string
  contentMd: string
  frontmatter?: Record<string, unknown>
  derivedFromSections: { sessionId: string; sectionKey: string; acceptedAt: string }[]
}

export async function createPattern(input: CreatePatternInput) {
  const [row] = await db.insert(proposalPatterns).values({
    program: input.program,
    sectionType: input.sectionType,
    title: input.title,
    contentMd: input.contentMd,
    frontmatter: input.frontmatter ?? {},
    derivedFromSections: input.derivedFromSections,
  }).returning()

  log.info({ program: input.program, sectionType: input.sectionType }, 'Proposal pattern created')
  return row
}

// ── Ranking ────────────────────────────────────────────────────

interface PatternRow {
  id: string
  timesUsed: number
  timesAccepted: number
  avgRegenCount: number
  [key: string]: unknown
}

export interface RankOptions {
  minSupport?: number // Patterns below this usage count sort last
}

export function rankPatterns<T extends PatternRow>(patterns: T[], opts: RankOptions = {}): T[] {
  const minSupport = opts.minSupport ?? 3

  return [...patterns].sort((a, b) => {
    const aAbove = a.timesUsed >= minSupport
    const bAbove = b.timesUsed >= minSupport

    // Below-threshold patterns sort last
    if (aAbove && !bAbove) return -1
    if (!aAbove && bAbove) return 1

    // Within same group: sort by Wilson score descending
    const aScore = wilsonScore(a.timesUsed, a.timesAccepted)
    const bScore = wilsonScore(b.timesUsed, b.timesAccepted)
    if (bScore !== aScore) return bScore - aScore

    // Tie-break: lower avg regen count is better
    return a.avgRegenCount - b.avgRegenCount
  })
}

export async function findPatterns(program: string, sectionType: string): Promise<PatternRow[]> {
  const rows = await db.select()
    .from(proposalPatterns)
    .where(and(
      eq(proposalPatterns.program, program),
      eq(proposalPatterns.sectionType, sectionType),
    ))

  return rankPatterns(rows)
}

export async function recordPatternUsage(
  patternId: string,
  outcome: { accepted: boolean; regenCount?: number },
) {
  await db.update(proposalPatterns).set({
    timesUsed: sql`${proposalPatterns.timesUsed} + 1`,
    timesAccepted: outcome.accepted
      ? sql`${proposalPatterns.timesAccepted} + 1`
      : proposalPatterns.timesAccepted,
    avgRegenCount: outcome.regenCount != null
      ? sql`(${proposalPatterns.avgRegenCount} * ${proposalPatterns.timesUsed} + ${outcome.regenCount}) / (${proposalPatterns.timesUsed} + 1)`
      : proposalPatterns.avgRegenCount,
    lastUsedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(proposalPatterns.id, patternId))

  log.info({ patternId, accepted: outcome.accepted }, 'Pattern usage recorded')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/proposal-patterns.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/knowledge/proposal-patterns.ts tests/unit/proposal-patterns.test.ts
git commit -m "feat: add proposal-patterns CRUD with Wilson score ranking"
```

---

## Task 4: Write-back hooks (idempotent, post-persist)

**Files:**
- Create: `app/src/lib/ai/knowledge/write-back.ts`
- Test: `app/tests/unit/knowledge-write-back.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// app/tests/unit/knowledge-write-back.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsertSessionKnowledge = vi.fn().mockResolvedValue({ id: 'sk-1' })
const mockCreatePattern = vi.fn().mockResolvedValue({ id: 'pp-1' })
const mockRecordPatternUsage = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  upsertSessionKnowledge: mockUpsertSessionKnowledge,
}))

vi.mock('@/lib/ai/knowledge/proposal-patterns', () => ({
  createPattern: mockCreatePattern,
  recordPatternUsage: mockRecordPatternUsage,
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import {
  onSectionAccepted,
  onPhaseTransition,
  shouldDistillPattern,
  trackPatternUsage,
} from '@/lib/ai/knowledge/write-back'

describe('knowledge write-back', () => {
  beforeEach(() => vi.clearAllMocks())

  it('onSectionAccepted upserts a section_pattern knowledge page with provenance', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'methodology',
      title: 'Metodologie',
      content: '## Approach\nPhased implementation with milestones...',
      program: 'PNRR',
      callId: 'pnrr-2026-call-1',
      retryCount: 0,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: ['qdrant-chunk-1', 'qdrant-chunk-2'],
    })

    expect(mockUpsertSessionKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '11111111-1111-4111-8111-111111111111',
        kind: 'section_pattern',
        slug: 'section-methodology',
        sourceRefs: ['qdrant-chunk-1', 'qdrant-chunk-2'],
      }),
    )
    // Verify provenance in frontmatter
    const call = mockUpsertSessionKnowledge.mock.calls[0][0]
    expect(call.frontmatter.callId).toBe('pnrr-2026-call-1')
    expect(call.frontmatter.program).toBe('PNRR')
  })

  it('onSectionAccepted is idempotent — second call updates same slug', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'methodology',
      title: 'Metodologie v2',
      content: '## Updated approach',
      program: 'PNRR',
      callId: 'pnrr-2026-call-1',
      retryCount: 1,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: [],
    })

    // Both calls use slug 'section-methodology' — upsert handles dedup
    expect(mockUpsertSessionKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'section-methodology' }),
    )
  })

  it('shouldDistillPattern returns true for zero-retry, long sections', () => {
    expect(shouldDistillPattern({ retryCount: 0, contentLength: 1000 })).toBe(true)
  })

  it('shouldDistillPattern returns false for high-retry sections', () => {
    expect(shouldDistillPattern({ retryCount: 3, contentLength: 1000 })).toBe(false)
  })

  it('shouldDistillPattern returns false for short content', () => {
    expect(shouldDistillPattern({ retryCount: 0, contentLength: 100 })).toBe(false)
  })

  it('onSectionAccepted distills pattern when shouldDistillPattern is true', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'context',
      title: 'Context și justificare',
      content: 'A'.repeat(1500),
      program: 'PNRR',
      callId: 'pnrr-2026-call-1',
      retryCount: 0,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: ['chunk-1'],
    })

    expect(mockCreatePattern).toHaveBeenCalledWith(
      expect.objectContaining({ program: 'PNRR', sectionType: 'context' }),
    )
  })

  it('onSectionAccepted does NOT distill pattern when retryCount > 1', async () => {
    await onSectionAccepted({
      sessionId: '11111111-1111-4111-8111-111111111111',
      sectionKey: 'context',
      title: 'Context',
      content: 'A'.repeat(1500),
      program: 'PNRR',
      callId: null,
      retryCount: 3,
      modelUsed: 'claude-opus-4-6',
      sectionId: '55555555-5555-4555-8555-555555555555',
      sourcesUsed: [],
    })

    expect(mockCreatePattern).not.toHaveBeenCalled()
  })

  it('onPhaseTransition upserts decision_log', async () => {
    await onPhaseTransition({
      sessionId: '11111111-1111-4111-8111-111111111111',
      fromPhase: 'structuring',
      toPhase: 'drafting',
      messageSummary: 'User approved outline with 11 sections',
      planningArtifact: { projectSummary: 'Green energy project' },
    })

    expect(mockUpsertSessionKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'decision_log',
        slug: 'phase-structuring-to-drafting',
      }),
    )
  })

  it('trackPatternUsage calls recordPatternUsage for each ID', async () => {
    await trackPatternUsage(['pp-1', 'pp-2'], { accepted: true, regenCount: 0 })
    expect(mockRecordPatternUsage).toHaveBeenCalledTimes(2)
  })

  it('trackPatternUsage swallows individual failures', async () => {
    mockRecordPatternUsage.mockRejectedValueOnce(new Error('DB error'))
    await expect(
      trackPatternUsage(['pp-1', 'pp-2'], { accepted: false }),
    ).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/knowledge-write-back.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// app/src/lib/ai/knowledge/write-back.ts
import { upsertSessionKnowledge } from './session-knowledge'
import { createPattern, recordPatternUsage } from './proposal-patterns'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'knowledge-write-back' })

// ── Section Accept ─────────────────────────────────────────────

export interface SectionAcceptedInput {
  sessionId: string
  sectionKey: string
  title: string
  content: string
  program: string
  callId: string | null
  retryCount: number
  modelUsed: string
  sectionId: string
  sourcesUsed: string[]
}

/**
 * Idempotent write-back on section accept.
 * Uses upsert by (sessionId, slug) — safe to call multiple times.
 * Called from persistSessionState, not as a detached async side-effect.
 */
export async function onSectionAccepted(input: SectionAcceptedInput): Promise<void> {
  // 1. Always upsert session knowledge page
  await upsertSessionKnowledge({
    sessionId: input.sessionId,
    kind: 'section_pattern',
    slug: `section-${input.sectionKey}`,
    title: input.title,
    contentMd: input.content,
    frontmatter: {
      sectionKey: input.sectionKey,
      program: input.program,
      callId: input.callId,
      modelUsed: input.modelUsed,
      acceptedAt: new Date().toISOString(),
      retryCount: input.retryCount,
    },
    sourceRefs: input.sourcesUsed,
    derivedFromSectionId: input.sectionId,
  })

  // 2. Conditionally distill into cross-session proposal_patterns
  if (shouldDistillPattern({ retryCount: input.retryCount, contentLength: input.content.length })) {
    await createPattern({
      program: input.program,
      sectionType: input.sectionKey,
      title: `${input.title} — ${input.program}`,
      contentMd: input.content,
      frontmatter: {
        modelUsed: input.modelUsed,
        sourceSessionId: input.sessionId,
        distilledAt: new Date().toISOString(),
      },
      derivedFromSections: [{
        sessionId: input.sessionId,
        sectionKey: input.sectionKey,
        acceptedAt: new Date().toISOString(),
      }],
    })
    log.info({ program: input.program, sectionKey: input.sectionKey }, 'Pattern distilled')
  }
}

// ── Distillation Heuristic ─────────────────────────────────────

const MIN_CONTENT_LENGTH = 500
const MAX_RETRY_FOR_PATTERN = 1

export function shouldDistillPattern(input: {
  retryCount: number
  contentLength: number
}): boolean {
  if (input.contentLength < MIN_CONTENT_LENGTH) return false
  if (input.retryCount > MAX_RETRY_FOR_PATTERN) return false
  return true
}

// ── Phase Transition ───────────────────────────────────────────

export interface PhaseTransitionInput {
  sessionId: string
  fromPhase: string
  toPhase: string
  messageSummary?: string | null
  planningArtifact?: { projectSummary?: string; keyAssumptions?: string[] } | null
}

export async function onPhaseTransition(input: PhaseTransitionInput): Promise<void> {
  const lines: string[] = [
    `## Phase transition: ${input.fromPhase} → ${input.toPhase}`,
    `**Date:** ${new Date().toISOString()}`,
  ]

  if (input.planningArtifact?.projectSummary) {
    lines.push(`\n### Project Summary\n${input.planningArtifact.projectSummary}`)
  }
  if (input.planningArtifact?.keyAssumptions?.length) {
    lines.push(`\n### Key Assumptions\n${input.planningArtifact.keyAssumptions.map(a => `- ${a}`).join('\n')}`)
  }
  if (input.messageSummary) {
    lines.push(`\n### Context\n${input.messageSummary}`)
  }

  await upsertSessionKnowledge({
    sessionId: input.sessionId,
    kind: 'decision_log',
    slug: `phase-${input.fromPhase}-to-${input.toPhase}`,
    title: `Phase: ${input.fromPhase} → ${input.toPhase}`,
    contentMd: lines.join('\n'),
    frontmatter: {
      fromPhase: input.fromPhase,
      toPhase: input.toPhase,
      timestamp: new Date().toISOString(),
    },
  })
}

// ── Pattern Usage Tracking ─────────────────────────────────────

export async function trackPatternUsage(
  patternIds: string[],
  outcome: { accepted: boolean; regenCount?: number },
): Promise<void> {
  for (const id of patternIds) {
    try {
      await recordPatternUsage(id, outcome)
    } catch (error) {
      log.warn({ patternId: id, error: error instanceof Error ? error.message : String(error) }, 'Pattern usage tracking failed')
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/knowledge-write-back.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/knowledge/write-back.ts tests/unit/knowledge-write-back.test.ts
git commit -m "feat: add idempotent knowledge write-back hooks"
```

---

## Task 5: Wire write-back into agent runtime (inside persist path)

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts`
- Test: `app/tests/unit/agent-runtime.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `app/tests/unit/agent-runtime.test.ts` — add the mock at file top and test in describe block:

```typescript
// Add alongside existing mocks at top:
vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn().mockResolvedValue(undefined),
  onPhaseTransition: vi.fn().mockResolvedValue(undefined),
  trackPatternUsage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  getSessionKnowledge: vi.fn().mockResolvedValue([]),
}))

// Add import after existing imports:
import { onSectionAccepted } from '@/lib/ai/knowledge/write-back'

// Add test inside main describe block:
it('calls onSectionAccepted inside persist path when ACCEPT_SECTION succeeds', async () => {
  const session = makeSession({
    currentPhase: 'drafting',
    outlineFrozen: true,
    blueprint: { program: 'PNRR' } as any,
  })
  const sections: AgentSection[] = [{
    id: '33333333-3333-4333-8333-333333333333',
    sessionId: session.id,
    sectionKey: 'methodology',
    title: 'Metodologie',
    documentOrder: 3,
    generationOrder: 3,
    status: 'needs_review',
    content: '## Approach\nPhased implementation...',
    acceptedContent: null,
    modelUsed: 'claude-opus-4-6',
    retryCount: 0,
    sourcesUsed: null,
    promptVersion: null,
    latencyMs: null,
    tokenUsage: null,
    errorClass: null,
    updatedAt: new Date(),
  }]

  await runAgentTurn({
    session,
    sections,
    request: {
      requestId: 'req-accept',
      locale: 'ro',
      action: { type: 'accept_section', sectionKey: 'methodology' },
    },
    emit,
  })

  expect(onSectionAccepted).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: session.id,
      sectionKey: 'methodology',
      program: 'PNRR',
      callId: null, // session.selectedCallId
      sourcesUsed: [], // from section.sourcesUsed
      sectionId: '33333333-3333-4333-8333-333333333333',
    }),
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/agent-runtime.test.ts`
Expected: FAIL — `onSectionAccepted` not called

- [ ] **Step 3: Wire write-back into runtime.ts**

In `app/src/lib/ai/agent/runtime.ts`, add import:

```typescript
import { onSectionAccepted, onPhaseTransition } from '@/lib/ai/knowledge/write-back'
```

Modify `persistSessionState` (line ~372) to accept a write-back context and perform ALL write-back after DB persistence:

```typescript
interface WriteBackContext {
  action?: NonNullable<AgentRequest['action']>
  phaseTransition?: { from: string; to: string }
}

async function persistSessionState(
  session: AgentSession,
  sections: AgentSection[],
  writeBackContext?: WriteBackContext,
): Promise<void> {
  // ... existing session and section persistence code stays exactly the same ...

  // ── Knowledge write-back (idempotent, all inside persist path) ──

  // 1. Section accept write-back
  if (writeBackContext?.action?.type === 'accept_section') {
    const sectionKey = writeBackContext.action.sectionKey
    const section = sections.find(s => s.sectionKey === sectionKey)
    if (section?.acceptedContent) {
      const bp = session.blueprint as any
      try {
        await onSectionAccepted({
          sessionId: session.id,
          sectionKey,
          title: section.title,
          content: section.acceptedContent,
          program: bp?.program ?? 'unknown',
          callId: session.selectedCallId,
          retryCount: section.retryCount,
          modelUsed: section.modelUsed ?? 'unknown',
          sectionId: section.id,
          sourcesUsed: (section.sourcesUsed as string[]) ?? [],
        })
      } catch (err) {
        log.warn({ sectionKey, error: err instanceof Error ? err.message : String(err) }, 'Knowledge write-back failed — section still accepted')
      }
    }
  }

  // 2. Phase transition write-back
  if (writeBackContext?.phaseTransition) {
    const { from, to } = writeBackContext.phaseTransition
    try {
      await onPhaseTransition({
        sessionId: session.id,
        fromPhase: from,
        toPhase: to,
        messageSummary: session.messageSummary,
        planningArtifact: session.planningArtifact,
      })
    } catch (err) {
      log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Phase transition write-back failed')
    }
  }
}
```

Update the two `persistSessionState` call sites:

Line ~79 (structured action path):
```typescript
await persistSessionState(session, sections, { action: request.action ?? undefined })
```

Line ~309 (end of turn — collect any phase transition that occurred during this turn):
```typescript
await persistSessionState(session, sections, {
  ...(phaseTransitionOccurred ? { phaseTransition: phaseTransitionOccurred } : {}),
})
```

To track which phase transition occurred, add a variable at the top of `runAgentTurn` (after `let { session, sections } = opts`):

```typescript
let phaseTransitionOccurred: { from: string; to: string } | undefined
```

Then in the tool-call loop where `SET_PHASE` is detected (line ~251), record it instead of doing write-back:

```typescript
if (transition.type === 'SET_PHASE' && transition.phase !== prevPhase) {
  emit({ type: 'phase_changed', from: prevPhase, to: transition.phase })
  phaseTransitionOccurred = { from: prevPhase, to: transition.phase }
}
```

This ensures phase transition write-back happens inside `persistSessionState`, not in the tool loop.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/agent-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/runtime.ts tests/unit/agent-runtime.test.ts
git commit -m "feat: wire idempotent knowledge write-back into agent persist path"
```

---

## Task 6: retrieve_session_context tool

**Files:**
- Create: `app/src/lib/ai/agent/tools/retrieve-session-context.ts`
- Modify: `app/src/lib/ai/agent/tools/index.ts`
- Test: `app/tests/unit/agent-tool-retrieve-session-context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/tests/unit/agent-tool-retrieve-session-context.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockKnowledgeRows = [
  { id: 'sk-1', kind: 'brief', slug: 'project-brief', title: 'Project Brief', contentMd: '# Brief\nSolar energy project', frontmatter: { program: 'PNRR' } },
  { id: 'sk-2', kind: 'section_pattern', slug: 'section-context', title: 'Context', contentMd: '## Context\nRomania needs green energy...', frontmatter: {} },
]

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  getSessionKnowledge: vi.fn().mockResolvedValue(mockKnowledgeRows),
  getSessionKnowledgeByKind: vi.fn().mockResolvedValue([mockKnowledgeRows[0]]),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/retrieve-session-context'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('retrieve_session_context tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: { currentPhase: 'drafting' } as any,
    sections: [],
    stateVersion: 0,
    requestId: 'req-1',
    locale: 'ro' as const,
  }

  it('is registered as a read tool', () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_session_context')
    expect(tool).toBeDefined()
    expect(tool!.category).toBe('read')
  })

  it('returns all session knowledge pages', async () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_session_context')!
    const result = await tool.execute({}, mockCtx)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2)
  })

  it('filters by kind when provided', async () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_session_context')!
    const result = await tool.execute({ kind: 'brief' }, mockCtx)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/agent-tool-retrieve-session-context.test.ts`
Expected: FAIL — tool not registered

- [ ] **Step 3: Write the tool**

```typescript
// app/src/lib/ai/agent/tools/retrieve-session-context.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { getSessionKnowledge, getSessionKnowledgeByKind } from '@/lib/ai/knowledge/session-knowledge'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-retrieve-session-context' })

const inputSchema = z.object({
  kind: z.enum(['brief', 'evidence_map', 'risks', 'budget_rationale', 'decision_log', 'section_pattern'])
    .optional()
    .describe('Filter by knowledge page kind'),
})

type Input = z.infer<typeof inputSchema>

interface SessionContextPage {
  id: string
  kind: string
  slug: string
  title: string
  contentMd: string
  frontmatter: Record<string, unknown>
}

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<SessionContextPage[]>> {
  const start = Date.now()

  try {
    const rows = input.kind
      ? await getSessionKnowledgeByKind(ctx.sessionId, input.kind)
      : await getSessionKnowledge(ctx.sessionId)

    const pages: SessionContextPage[] = rows.map(r => ({
      id: r.id,
      kind: r.kind,
      slug: r.slug,
      title: r.title,
      contentMd: r.contentMd,
      frontmatter: r.frontmatter as Record<string, unknown>,
    }))

    log.info({ sessionId: ctx.sessionId, kind: input.kind ?? 'all', count: pages.length, latencyMs: Date.now() - start }, 'Session context retrieved')

    return {
      success: true,
      data: pages,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'retrieve_session_context failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retrieve session context',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool({
  name: 'retrieve_session_context',
  category: 'read',
  description: 'Retrieve session-specific knowledge pages (brief, evidence map, risks, decision log, accepted section patterns)',
  inputSchema,
  execute: execute as any,
  timeout: 10_000,
})
```

- [ ] **Step 4: Register in index.ts**

Add to `app/src/lib/ai/agent/tools/index.ts`:

```typescript
import './retrieve-session-context'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/agent-tool-retrieve-session-context.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/tools/retrieve-session-context.ts src/lib/ai/agent/tools/index.ts tests/unit/agent-tool-retrieve-session-context.test.ts
git commit -m "feat: add retrieve_session_context read tool"
```

---

## Task 7: Inject session context + patterns into generate_section with token budget

**Files:**
- Modify: `app/src/lib/ai/agent/tools/generate-section.ts`
- Test: `app/tests/unit/agent-tool-generate-section.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `app/tests/unit/agent-tool-generate-section.test.ts`:

```typescript
vi.mock('@/lib/ai/knowledge/proposal-patterns', () => ({
  findPatterns: vi.fn().mockResolvedValue([
    {
      id: 'pp-1', program: 'PNRR', sectionType: 'context', title: 'Strong context',
      contentMd: 'A'.repeat(3000), // Longer than 1500 char budget
      timesUsed: 10, timesAccepted: 8, avgRegenCount: 0.5,
    },
  ]),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  getSessionKnowledgeByKind: vi.fn().mockResolvedValue([
    { id: 'sk-1', kind: 'brief', contentMd: 'B'.repeat(2000), title: 'Brief' }, // Longer than 800 char budget
  ]),
}))

import { findPatterns } from '@/lib/ai/knowledge/proposal-patterns'

it('injects pattern and brief with total knowledge context under 2500 chars', async () => {
  const { generate } = await import('@/lib/ai/providers/router')
  const tool = getToolRegistry().find(t => t.name === 'generate_section')!

  await tool.execute({ sectionKey: 'context' }, mockCtx)

  const call = (generate as any).mock.calls.at(-1)[0]
  const system: string = call.system

  // Both injected
  expect(system).toContain('REFERENCE PATTERN')
  expect(system).toContain('PROJECT BRIEF')
  expect(findPatterns).toHaveBeenCalledWith('PNRR', 'context')

  // Extract the knowledge block and verify total cap
  const knowledgeStart = system.indexOf('PROJECT BRIEF')
  const knowledgeEnd = system.indexOf('ADDITIONAL INSTRUCTIONS') !== -1
    ? system.indexOf('ADDITIONAL INSTRUCTIONS')
    : system.indexOf('RULES:')
  if (knowledgeStart !== -1 && knowledgeEnd !== -1) {
    const knowledgeBlock = system.slice(knowledgeStart, knowledgeEnd)
    // Total must be under MAX_KNOWLEDGE_CONTEXT_CHARS (2500) + some header overhead
    expect(knowledgeBlock.length).toBeLessThan(2700)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/agent-tool-generate-section.test.ts`
Expected: FAIL — system prompt doesn't contain 'REFERENCE PATTERN' or 'PROJECT BRIEF'

- [ ] **Step 3: Update generate-section.ts with budgeted injection**

In `app/src/lib/ai/agent/tools/generate-section.ts`, add imports:

```typescript
import { findPatterns } from '@/lib/ai/knowledge/proposal-patterns'
import { getSessionKnowledgeByKind } from '@/lib/ai/knowledge/session-knowledge'
```

Add constants at file level:

```typescript
const MAX_PATTERN_CHARS = 1500
const MAX_BRIEF_CHARS = 800
const MAX_KNOWLEDGE_CONTEXT_CHARS = 2500
```

Inside `execute`, after building `previousContext` (line ~73) and before the system prompt, add:

```typescript
    // Knowledge injection with hard token budget
    let knowledgeContext = ''
    let usedPatternIds: string[] = []

    const bp = ctx.session.blueprint as any
    const program = bp?.program ?? ''

    // 1. Session brief (max 800 chars)
    try {
      const briefs = await getSessionKnowledgeByKind(ctx.sessionId, 'brief')
      if (briefs.length > 0) {
        const briefContent = briefs[0].contentMd.slice(0, MAX_BRIEF_CHARS)
        knowledgeContext += `\nPROJECT BRIEF (from this session's knowledge):\n${briefContent}\n`
      }
    } catch { /* non-critical */ }

    // 2. Best matching pattern (max 1500 chars)
    if (program) {
      try {
        const patterns = await findPatterns(program, input.sectionKey)
        if (patterns.length > 0) {
          const best = patterns[0]
          const patternContent = best.contentMd.slice(0, MAX_PATTERN_CHARS)
          knowledgeContext += `\nREFERENCE PATTERN (${(best as any).timesAccepted ?? 0}/${(best as any).timesUsed ?? 0} accept rate — adapt to this project, don't copy):\n${patternContent}\n`
          usedPatternIds = [best.id]
        }
      } catch { /* non-critical */ }
    }

    // Final hard cap — enforced regardless of component sizes
    if (knowledgeContext.length > MAX_KNOWLEDGE_CONTEXT_CHARS) {
      knowledgeContext = knowledgeContext.slice(0, MAX_KNOWLEDGE_CONTEXT_CHARS) + '\n[truncated]'
    }
```

Then include `knowledgeContext` in the system prompt, replacing the empty spot after `${previousContext}`:

```typescript
${previousContext}
${knowledgeContext}
${input.additionalContext ? `\nADDITIONAL INSTRUCTIONS:\n${input.additionalContext}` : ''}
```

And update the sources in the state transition:

```typescript
        sources: usedPatternIds,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/agent-tool-generate-section.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/tools/generate-section.ts tests/unit/agent-tool-generate-section.test.ts
git commit -m "feat: inject session brief + ranked pattern into generation with hard token budget"
```

---

## Task 8: Update system prompt with knowledge summary

**Files:**
- Modify: `app/src/lib/ai/agent/prompt.ts`
- Modify: `app/src/lib/ai/agent/runtime.ts` (inject summary)
- Test: `app/tests/unit/agent-prompt.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `app/tests/unit/agent-prompt.test.ts`:

```typescript
it('includes session knowledge summary when present', () => {
  const session = {
    currentPhase: 'drafting' as const,
    blueprint: { callId: 'pnrr-2026', program: 'PNRR', structureConfidence: 0.8 } as any,
    selectedCallId: 'pnrr-2026',
    eligibility: null,
    warnings: [],
    planningArtifact: null,
    _knowledgeSummary: '3 pages: brief, decision_log, section_pattern(methodology)',
  } as any

  const prompt = buildSystemPrompt(session, [])
  expect(prompt).toContain('Session knowledge')
  expect(prompt).toContain('3 pages')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/agent-prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Update prompt.ts**

In `app/src/lib/ai/agent/prompt.ts`, inside `buildSystemPrompt`, after the eligibility line and before sections:

```typescript
  const knowledgeSummary = (session as any)._knowledgeSummary
  const knowledgeLine = knowledgeSummary
    ? `- Session knowledge: ${knowledgeSummary}`
    : '- Session knowledge: none yet'
```

Include `${knowledgeLine}` in the template between eligibility and sections.

- [ ] **Step 4: Inject summary in runtime.ts**

In `app/src/lib/ai/agent/runtime.ts`, before `buildSystemPrompt` call (line ~92):

```typescript
    // Inject session knowledge summary for prompt
    try {
      const { getSessionKnowledge } = await import('@/lib/ai/knowledge/session-knowledge')
      const pages = await getSessionKnowledge(session.id)
      if (pages.length > 0) {
        const kindCounts = new Map<string, number>()
        for (const p of pages) kindCounts.set(p.kind, (kindCounts.get(p.kind) ?? 0) + 1)
        ;(session as any)._knowledgeSummary = `${pages.length} pages: ${[...kindCounts.entries()].map(([k, c]) => c > 1 ? `${k}(${c})` : k).join(', ')}`
      }
    } catch { /* non-critical */ }
```

- [ ] **Step 5: Run tests**

Run: `cd app && npx vitest run tests/unit/agent-prompt.test.ts tests/unit/agent-runtime.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/prompt.ts src/lib/ai/agent/runtime.ts tests/unit/agent-prompt.test.ts
git commit -m "feat: show session knowledge summary in agent system prompt"
```

---

## Task 9: Pattern usage tracking on accept path

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts` (extend persist write-back)

- [ ] **Step 1: Add tracking to the accept write-back in persistSessionState**

After the `onSectionAccepted` call (added in Task 5), add pattern usage tracking:

```typescript
      // Track pattern usage — sourcesUsed contains pattern IDs from generate_section
      const patternIds = (section.sourcesUsed as string[] ?? []).filter(
        s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)
      )
      if (patternIds.length > 0) {
        const { trackPatternUsage } = await import('@/lib/ai/knowledge/write-back')
        try {
          await trackPatternUsage(patternIds, {
            accepted: true,
            regenCount: section.retryCount,
          })
        } catch { /* logged inside trackPatternUsage */ }
      }
```

- [ ] **Step 2: Run full agent tests**

Run: `cd app && npx vitest run tests/unit/agent-runtime.test.ts tests/unit/knowledge-write-back.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd app && git add src/lib/ai/agent/runtime.ts
git commit -m "feat: track pattern usage on section accept for improvement loop"
```

---

## Task 10: Extend vault generator for knowledge export

**Files:**
- Modify: `app/scripts/generate-knowledge-vault.ts`

- [ ] **Step 1: Read current vault generator structure**

Run: `cd app && head -60 scripts/generate-knowledge-vault.ts`

- [ ] **Step 2: Add session knowledge + pattern export functions**

Add to `app/scripts/generate-knowledge-vault.ts`:

```typescript
import { sessionKnowledge, proposalPatterns } from '@/lib/db/schema'

async function exportSessionKnowledge(vaultRoot: string) {
  const rows = await db.select().from(sessionKnowledge)
  const dir = path.join(vaultRoot, 'wiki', 'projects')
  await fs.mkdir(dir, { recursive: true })

  const bySession = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = bySession.get(row.sessionId) ?? []
    list.push(row)
    bySession.set(row.sessionId, list)
  }

  for (const [sessionId, pages] of bySession) {
    const sessionDir = path.join(dir, sessionId.slice(0, 8))
    await fs.mkdir(sessionDir, { recursive: true })
    for (const page of pages) {
      const fm = { ...(page.frontmatter as Record<string, unknown>), kind: page.kind, sessionId, exportedAt: new Date().toISOString() }
      const content = `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# ${page.title}\n\n${page.contentMd}`
      await fs.writeFile(path.join(sessionDir, `${page.slug}.md`), content)
    }
  }
  console.log(`Exported ${rows.length} session knowledge pages`)
}

async function exportProposalPatterns(vaultRoot: string) {
  const rows = await db.select().from(proposalPatterns)
  const dir = path.join(vaultRoot, 'wiki', 'patterns')
  await fs.mkdir(dir, { recursive: true })

  for (const row of rows) {
    const rate = row.timesUsed > 0 ? Math.round((row.timesAccepted / row.timesUsed) * 100) : 0
    const fm = { program: row.program, sectionType: row.sectionType, timesUsed: row.timesUsed, acceptRate: `${rate}%`, exportedAt: new Date().toISOString() }
    const slug = `${row.program}-${row.sectionType}-${row.id.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const content = `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# ${row.title}\n\n${row.contentMd}`
    await fs.writeFile(path.join(dir, `${slug}.md`), content)
  }
  console.log(`Exported ${rows.length} proposal patterns`)
}
```

Call both from the main function after existing exports.

- [ ] **Step 3: Verify compilation**

Run: `cd app && npx tsc --noEmit scripts/generate-knowledge-vault.ts 2>&1 | head -10`

- [ ] **Step 4: Commit**

```bash
cd app && git add scripts/generate-knowledge-vault.ts
git commit -m "feat: extend vault generator to export session knowledge and proposal patterns"
```

---

## Task 11: Full regression verification

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `cd app && npx vitest run tests/unit/ --reporter=verbose 2>&1 | tail -30`
Expected: All PASS

- [ ] **Step 2: Run integration tests**

Run: `cd app && npx vitest run tests/integration/ --reporter=verbose 2>&1 | tail -30`
Expected: No new failures

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: No new errors

- [ ] **Step 4: Lint**

Run: `cd app && npm run lint`
Expected: No new errors

- [ ] **Step 5: Fix any regressions and commit**

```bash
git add -A && git commit -m "fix: knowledge layer regression fixes"
```

---

## Rollout Plan

### Phase 1: Schema + CRUD (Tasks 1-3)
- Deploy migration
- Tables exist but empty, no behavior change

### Phase 2: Write-back (Tasks 4-5)
- Behind existing `agent_v3_enabled` flag
- Knowledge accumulates silently on section accept
- No generation behavior change yet

### Phase 3: Retrieval + Injection (Tasks 6-9)
- Session context tool available to agent
- Patterns injected into generation (initially empty table — no effect)
- After ~10 completed proposals, patterns start compounding

### Phase 4: Monitoring
- Admin API to query pattern rankings (future task)
- Metrics: acceptance rate with/without pattern context

### Phase 5: Cross-session compounding
- Add `link_project` tool or completion handler that sets `agent_sessions.projectId`
- Backfill `session_knowledge.projectId` when project is linked
- Future: retrieve knowledge across sessions sharing same projectId

---

## Key Design Decisions

1. **Session-scoped in Phase 1, project-scoped in Phase 5.** The `projectId` FK exists on both tables but is nullable. Cross-session compounding requires the future `link_project` step.
2. **ALL write-back inside `persistSessionState`.** Both section-accept and phase-transition write-back run inside `persistSessionState()`, after DB writes succeed. No write-back code exists in the tool loop or elsewhere in `runAgentTurn`. Uses upsert by `(sessionId, slug)` for idempotency. Failures logged but never block the user.
3. **Two separate retrieval tools.** `retrieve_session_context` (session knowledge) and `retrieve_call_evidence` (Qdrant) have separate contracts. `generate_section` composes both with budgets.
4. **Wilson score ranking.** Prevents one-hit wonders. Minimum support threshold of 3. Transparent and debuggable.
5. **Enforced total injection budget.** Components pre-trimmed (pattern 1500, brief 800), then final `MAX_KNOWLEDGE_CONTEXT_CHARS = 2500` clamp on assembled `knowledgeContext` string. This is the hard cap.
6. **Full provenance in write-back.** `SectionAcceptedInput` carries `sourcesUsed`, `callId`, `program`, `modelUsed`, and `sectionId`. These flow into both `session_knowledge.sourceRefs` and `session_knowledge.frontmatter`, making exported knowledge auditable.
7. **`_knowledgeSummary` is transient.** Never persisted — injected at runtime for prompt context only.

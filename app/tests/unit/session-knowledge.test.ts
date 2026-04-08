// app/tests/unit/session-knowledge.test.ts
import { describe, it, expect, vi } from 'vitest'

// ── Schema Tests (no mocks needed) ─────────────────────────────
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

// ── CRUD Tests ─────────────────────────────────────────────────

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
    insert: (...args: unknown[]) => mockInsert(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

// Dynamic import AFTER mocks are set up
const { upsertSessionKnowledge, getSessionKnowledge, getSessionKnowledgeByKind } = await import('@/lib/ai/knowledge/session-knowledge')

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

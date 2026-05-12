// Regression: cache rows for callKnowledge.normalized.requiredSections store
// only the partial shape `{ title, description, evaluationWeight? }`. Earlier
// code unsafely cast that to SectionSpec[] and the runtime then handed it
// to tools like generate_section, which dereferences `section.id` and
// `section.generationOrder`. Cache-hit sessions advanced fine through
// structuring → drafting via approve_outline, then exploded on the first
// draft. This test pins that the lookupBlueprint cache-hit path always
// materializes a full SectionSpec for every cached section.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { select: vi.fn() },
}))

vi.mock('@/lib/db/schema', () => ({
  callKnowledge: { callId: 'call_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import { db } from '@/lib/db'
import { lookupBlueprint } from '@/lib/ai/agent/services/blueprint'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

const ctx: ServiceContext = {
  userId: '22222222-2222-4222-8222-222222222222',
  sessionId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-1',
  now: new Date('2026-05-12T07:30:00Z'),
}

function setupDbSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({ where })
  vi.mocked(db.select).mockReturnValue({ from } as never)
}

describe('lookupBlueprint cache hit — outline materialization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hydrates partial cached sections into full SectionSpec[]', async () => {
    setupDbSelect([{
      callId: 'CALL-XYZ',
      program: 'PNRR',
      callTitle: 'Test Call',
      normalized: {
        requiredSections: [
          { title: 'Context și justificare', description: 'desc 1', evaluationWeight: 10 },
          { title: 'Obiective', description: 'desc 2' },
        ],
      },
      status: 'primed',
      structureConfidence: 0.85,
      freshnessConfidence: 0.7,
      sourceDocs: [],
      contentExtractedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    }])

    const result = await lookupBlueprint(ctx, 'CALL-XYZ')
    expect(result.cached).toBe(true)
    expect(result.blueprint).not.toBeNull()

    const sections = result.blueprint!.normalized.requiredSections
    expect(sections).toHaveLength(2)

    for (const s of sections) {
      // Every field the runtime + downstream tools dereference must exist.
      expect(typeof s.id).toBe('string')
      expect(s.id.length).toBeGreaterThan(0)
      expect(typeof s.title).toBe('string')
      expect(typeof s.description).toBe('string')
      expect(typeof s.order).toBe('number')
      expect(typeof s.generationOrder).toBe('number')
      expect(['critical', 'standard', 'supplementary']).toContain(s.importance)
      expect(['short', 'medium', 'long']).toContain(s.expectedLength)
      expect(Array.isArray(s.dependsOn)).toBe(true)
      expect(['heavy', 'light']).toContain(s.modelHint)
      expect(typeof s.mandatory).toBe('boolean')
      expect(typeof s.confidence).toBe('number')
    }
  })

  it('derives stable slug ids from Romanian titles (diacritic-strip)', async () => {
    setupDbSelect([{
      callId: 'CALL-XYZ',
      program: 'PNRR',
      callTitle: 'Test',
      normalized: {
        requiredSections: [
          { title: 'Context și justificare', description: 'd' },
          { title: 'Activități propuse', description: 'd' },
        ],
      },
      status: 'primed',
      structureConfidence: 0.7,
      freshnessConfidence: 0.7,
      sourceDocs: [],
      contentExtractedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    }])

    const result = await lookupBlueprint(ctx, 'CALL-XYZ')
    const ids = result.blueprint!.normalized.requiredSections.map(s => s.id)
    expect(ids).toEqual(['context-si-justificare', 'activitati-propuse'])
  })

  it('maps evaluationWeight > 0 → heavy modelHint; absent → light', async () => {
    setupDbSelect([{
      callId: 'CALL-XYZ',
      program: 'PNRR',
      callTitle: 'Test',
      normalized: {
        requiredSections: [
          { title: 'Weighted', description: 'd', evaluationWeight: 25 },
          { title: 'Unweighted', description: 'd' },
        ],
      },
      status: 'primed',
      structureConfidence: 0.7,
      freshnessConfidence: 0.7,
      sourceDocs: [],
      contentExtractedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    }])

    const result = await lookupBlueprint(ctx, 'CALL-XYZ')
    const [weighted, unweighted] = result.blueprint!.normalized.requiredSections
    expect(weighted.modelHint).toBe('heavy')
    expect(unweighted.modelHint).toBe('light')
  })
})

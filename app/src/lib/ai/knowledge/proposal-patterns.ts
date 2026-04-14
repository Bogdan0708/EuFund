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

/**
 * Upsert a pattern by (program, sectionType, sourceSessionId).
 * Repeated accepts for the same section in the same session update
 * the existing pattern row instead of creating duplicates.
 */
export async function createPattern(input: CreatePatternInput) {
  const sourceSessionId = input.derivedFromSections[0]?.sessionId ?? null

  // Check for existing pattern from this session+program+sectionType
  if (sourceSessionId) {
    const existing = await db.select()
      .from(proposalPatterns)
      .where(and(
        eq(proposalPatterns.program, input.program),
        eq(proposalPatterns.sectionType, input.sectionType),
      ))

    const match = existing.find(row => {
      const fm = row.frontmatter as Record<string, unknown> | null
      return fm?.sourceSessionId === sourceSessionId
    })

    if (match) {
      // Update existing pattern with latest content and provenance
      await db.update(proposalPatterns).set({
        title: input.title,
        contentMd: input.contentMd,
        frontmatter: input.frontmatter ?? {},
        derivedFromSections: input.derivedFromSections,
        updatedAt: new Date(),
      }).where(eq(proposalPatterns.id, match.id))

      log.info({ program: input.program, sectionType: input.sectionType, patternId: match.id }, 'Proposal pattern updated (idempotent)')
      return { ...match, title: input.title, contentMd: input.contentMd }
    }
  }

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
  minSupport?: number
}

export function rankPatterns<T extends PatternRow>(patterns: T[], opts: RankOptions = {}): T[] {
  const minSupport = opts.minSupport ?? 3

  return [...patterns].sort((a, b) => {
    const aAbove = a.timesUsed >= minSupport
    const bAbove = b.timesUsed >= minSupport

    if (aAbove && !bAbove) return -1
    if (!aAbove && bAbove) return 1

    const aScore = wilsonScore(a.timesUsed, a.timesAccepted)
    const bScore = wilsonScore(b.timesUsed, b.timesAccepted)
    if (bScore !== aScore) return bScore - aScore

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

  return rankPatterns(rows as unknown as PatternRow[])
}

export async function recordPatternUsage(
  patternId: string,
  outcome: { accepted: boolean; regenCount?: number },
) {
  await db.update(proposalPatterns).set({
    timesUsed: sql`${proposalPatterns.timesUsed} + 1`,
    timesAccepted: outcome.accepted
      ? sql`${proposalPatterns.timesAccepted} + 1`
      : sql`${proposalPatterns.timesAccepted}`,
    avgRegenCount: outcome.regenCount != null
      ? sql`(${proposalPatterns.avgRegenCount} * ${proposalPatterns.timesUsed} + ${outcome.regenCount}) / (${proposalPatterns.timesUsed} + 1)`
      : sql`${proposalPatterns.avgRegenCount}`,
    lastUsedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(proposalPatterns.id, patternId))

  log.info({ patternId, accepted: outcome.accepted }, 'Pattern usage recorded')
}

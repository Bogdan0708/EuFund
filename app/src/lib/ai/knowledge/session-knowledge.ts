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

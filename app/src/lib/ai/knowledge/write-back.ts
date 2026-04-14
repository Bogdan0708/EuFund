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

// app/src/lib/ai/agent/tools/generate-section.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { SectionSpec } from '@/lib/ai/agent/types'
import { generate } from '@/lib/ai/providers/router'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { compactPreviousSections } from '../section-specs'
import { db } from '@/lib/db'
import { agentSectionVersions, agentSections } from '@/lib/db/schema'
import { eq, and, max } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'
import { findPatterns } from '@/lib/ai/knowledge/proposal-patterns'
import { getSessionKnowledgeByKind } from '@/lib/ai/knowledge/session-knowledge'
import type { CallBlueprint } from '@/lib/ai/agent/types'
import { isFeatureEnabled } from '@/lib/feature-flags'

const log = logger.child({ component: 'tool-generate-section' })

const inputSchema = z.object({
  sectionKey: z.string().min(1).describe('The section key to generate'),
  additionalContext: z.string().optional().describe('Extra context or instructions from the user'),
})

type Input = z.infer<typeof inputSchema>

const MAX_PATTERN_CHARS = 1500
const MAX_BRIEF_CHARS = 800
const MAX_KNOWLEDGE_CONTEXT_CHARS = 2500

interface PatternStats {
  timesAccepted?: number
  timesUsed?: number
}

const LENGTH_GUIDE: Record<string, string> = {
  short: '500-1000 words (1-2 pages)',
  medium: '1000-2000 words (2-4 pages)',
  long: '2000-4000 words (4-8 pages)',
  extra_long: '4000-7000 words (8-14 pages)',
}

// Output-token caps per length tier. Sized for SSE-bounded interactive turns:
// each tier sits comfortably under the 270s deadline at Sonnet output rates.
// extra_long is explicit-only — without section_extra_long_enabled it falls
// back to long so a runaway spec tier can't blow the budget.
const TOKEN_CAPS = {
  short: 6_000,
  medium: 10_000,
  long: 12_000,
  extra_long: 20_000,
} as const

function maxTokensFor(expectedLength: string, extraLongEnabled: boolean): number {
  if (expectedLength === 'extra_long') {
    return extraLongEnabled ? TOKEN_CAPS.extra_long : TOKEN_CAPS.long
  }
  if (expectedLength === 'long') return TOKEN_CAPS.long
  if (expectedLength === 'medium') return TOKEN_CAPS.medium
  return TOKEN_CAPS.short
}

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<{ content: string; model: string }>> {
  const start = Date.now()

  try {
    // Find section spec from outline
    const outline = ctx.session.outline as SectionSpec[] | null
    const spec = outline?.find(s => s.id === input.sectionKey)
    if (!spec) {
      return {
        success: false,
        error: `Section "${input.sectionKey}" not found in outline`,
        retryable: false,
        telemetry: { latencyMs: Date.now() - start },
      }
    }

    // Route model by importance via centralized resolver. Gated on the
    // interactive_section_sonnet_default flag — when ON, pass
    // interactionMode='interactive' so the resolver returns Sonnet regardless
    // of importance. Without the flag, legacy importance-based routing
    // (critical→Opus) stays intact. bypassCache: true so an emergency
    // rollback is not delayed by the 60s LRU.
    const interactiveSonnetEnabled = await isFeatureEnabled(
      'interactive_section_sonnet_default',
      { userId: ctx.userId, bypassCache: true },
    )
    const extraLongEnabled = await isFeatureEnabled(
      'section_extra_long_enabled',
      { userId: ctx.userId },
    )
    const resolved = resolveAgentModel({
      task: 'section_generation',
      importance: spec.importance as 'critical' | 'standard' | 'supplementary',
      ctx: ctx.routingCtx,
      ...(interactiveSonnetEnabled ? { interactionMode: 'interactive' as const } : {}),
    })
    const { provider: resolvedProvider, model } = resolved

    // Build context from previously generated sections
    const existingSections = ctx.sections
      .filter(s => s.content && s.sectionKey !== input.sectionKey)
      .map(s => ({
        id: s.sectionKey,
        title: s.title,
        content: s.acceptedContent || s.content || '',
        order: s.documentOrder,
        source: 'generated' as const,
        state: 'draft' as const,
        currentVersion: 1,
        versionCount: 1,
        contentHash: '',
        lastStateChangeAt: new Date().toISOString(),
        lastStateChangeBy: null,
        metadata: { model: s.modelUsed || '', provider: '', tokensIn: 0, tokensOut: 0, latencyMs: 0, retryCount: 0, fallbackUsed: false, generatedAt: '', checksum: '' },
      }))

    const previousContext = existingSections.length > 0
      ? `\n\nPREVIOUSLY WRITTEN SECTIONS:\n${compactPreviousSections(existingSections, spec)}`
      : ''

    // Knowledge injection with hard token budget
    let knowledgeContext = ''
    let usedPatternIds: string[] = []

    const bp = ctx.session.blueprint as CallBlueprint | null
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
            const patternContent = String(best.contentMd).slice(0, MAX_PATTERN_CHARS)
            const stats = best as PatternStats
            knowledgeContext += `\nREFERENCE PATTERN (${stats.timesAccepted ?? 0}/${stats.timesUsed ?? 0} accept rate — adapt to this project, don't copy):\n${patternContent}\n`
            usedPatternIds = [best.id]
          }
      } catch { /* non-critical */ }
    }

    // Final hard cap — enforced AFTER headers/labels are added
    // Suffix is inside the budget so total never exceeds MAX_KNOWLEDGE_CONTEXT_CHARS
    const TRUNCATION_SUFFIX = '\n[truncated]'
    if (knowledgeContext.length > MAX_KNOWLEDGE_CONTEXT_CHARS) {
      knowledgeContext = knowledgeContext.slice(0, MAX_KNOWLEDGE_CONTEXT_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
    }

    const blueprint = ctx.session.blueprint
    const blueprintContext = blueprint
      ? `\nCALL: ${blueprint.program}\nCO-FINANCING: ${((blueprint.cofinancingRate || 0) * 100).toFixed(0)}%`
      : ''
    const evalNote = spec.evaluationWeight
      ? `\nEVALUATION: This section is worth ${spec.evaluationWeight} points. Write to maximize score.`
      : ''

    const systemPrompt = `You are an expert EU funding proposal writer.
${blueprintContext}
${evalNote}

TASK: Write the section "${spec.title}" for this project proposal.

SECTION REQUIREMENTS:
- Title: ${spec.title}
- Description: ${spec.description}
- Expected length: ${LENGTH_GUIDE[spec.expectedLength] || '1000-2000 words'}

${ctx.session.planningArtifact?.projectSummary ? `PROJECT SUMMARY:\n${ctx.session.planningArtifact.projectSummary}` : ''}
${previousContext}
${knowledgeContext}
${input.additionalContext ? `\nADDITIONAL INSTRUCTIONS:\n${input.additionalContext}` : ''}

RULES:
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- Be specific, use concrete numbers and timelines
- Reference evaluation criteria where relevant
- Maintain consistency with previously written sections
- Use formal but accessible language for EU funding applications
- Do NOT use placeholder text like [insert here] or TBD

FORMAT:
- Use ## for sub-section headings within this section
- Use ### for sub-sub-headings if needed
- Use **bold** for key terms, regulation names, and important values
- Use bullet lists (-) for enumerations of items, criteria, or features
- Use numbered lists (1.) only for ordered steps, phases, or ranked criteria
- Write in clear paragraphs between structured elements
- Do NOT use code fences, blockquotes, images, links, or HTML
- Do NOT include a section title heading — it is added separately

OUTPUT: Write the section content directly. No JSON wrapping needed.`

    const response = await generate({
      provider: resolvedProvider,
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Generate the "${spec.title}" section now.` }],
      temperature: 0.6,
      maxTokens: maxTokensFor(spec.expectedLength, extraLongEnabled),
      // Forward the per-tool signal so the Anthropic SDK actually stops
      // streaming when the runtime aborts (client disconnected, deadline
      // hit, tool timeout). Without this, the Promise.race in runtime.ts
      // resolves the wait while the underlying stream keeps producing
      // tokens for nobody — the May 19 2026 prod incident where three
      // sections completed at 259/275/286s after Cloud Run closed.
      signal: ctx.signal,
    })

    // The runtime may have aborted between when we kicked off the LLM call
    // and when the response landed. If so, refuse to persist anything —
    // the user can't see the result, and a later retry will produce a
    // fresh version. Background DB writes after consumer-cancel are
    // exactly what put unique-constraint pressure on agent_section_versions.
    if (ctx.signal?.aborted) {
      return {
        success: false,
        error: 'Aborted',
        retryable: true,
        telemetry: { latencyMs: Date.now() - start, model, provider: response.provider },
      }
    }

    const content = normalizeMarkdown(response.content.trim())
    if (!content || content.length < 50) {
      return {
        success: false,
        error: 'Generated content too short or empty',
        retryable: true,
        telemetry: { latencyMs: Date.now() - start, model, provider: response.provider },
      }
    }

    // Save version to DB — create section row if needed, then insert version
    // with race-safe allocation. Two concurrent generate_section calls used
    // to compute the same versionNumber from `(retryCount || 0) + 1` and
    // crash on uniq_agent_section_version_number. Wrap in a transaction with
    // SELECT FOR UPDATE on the parent section row so concurrent writers
    // serialize, then take max(versionNumber) + 1 like the rollback path.
    try {
      if (ctx.signal?.aborted) {
        return {
          success: false,
          error: 'Aborted',
          retryable: true,
          telemetry: { latencyMs: Date.now() - start, model, provider: response.provider },
        }
      }
      await db.transaction(async (tx) => {
        let [existingSection] = await tx.select()
          .from(agentSections)
          .where(and(eq(agentSections.sessionId, ctx.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
          .for('update')
          .limit(1)

        if (!existingSection) {
          const [created] = await tx.insert(agentSections).values({
            sessionId: ctx.sessionId,
            sectionKey: input.sectionKey,
            title: spec.title,
            documentOrder: spec.order,
            generationOrder: spec.generationOrder,
            status: 'draft',
            content,
            modelUsed: model,
          }).returning()
          existingSection = created
        } else {
          // Existing row already locked above; update the live content too
          // so consumers reading agent_sections see the latest draft. The
          // version row below is the immutable history.
          await tx
            .update(agentSections)
            .set({ content, modelUsed: model, updatedAt: new Date() })
            .where(eq(agentSections.id, existingSection.id))
        }

        if (!existingSection) return

        const [maxRow] = await tx
          .select({ maxVersion: max(agentSectionVersions.versionNumber) })
          .from(agentSectionVersions)
          .where(eq(agentSectionVersions.sectionId, existingSection.id))
        const versionNumber = (maxRow?.maxVersion ?? 0) + 1

        await tx.insert(agentSectionVersions).values({
          sectionId: existingSection.id,
          versionNumber,
          kind: 'draft',
          content,
          modelUsed: model,
          sourcesUsed: usedPatternIds as unknown as Record<string, unknown>,
        })
      })
    } catch (dbErr) {
      log.warn({ error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, 'Failed to save section version')
    }

    log.info({ sectionKey: input.sectionKey, model, contentLength: content.length, latencyMs: Date.now() - start }, 'Section generated')

    return {
      success: true,
      data: { content, model },
      stateTransitions: [{
        type: 'UPSERT_SECTION_DRAFT',
        sectionKey: input.sectionKey,
        content,
        model,
        sources: usedPatternIds,
      }],
      telemetry: {
        latencyMs: Date.now() - start,
        tokensUsed: response.tokensUsed,
        model,
        provider: response.provider,
      },
    }
  } catch (error) {
    log.error({ sectionKey: input.sectionKey, error: error instanceof Error ? error.message : String(error) }, 'generate_section failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Section generation failed',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Input, { content: string; model: string }>({
  name: 'generate_section',
  category: 'generation',
  description: 'Generate a section of the funding application based on the outline and project context',
  inputSchema,
  execute,
  timeout: 120_000,
})

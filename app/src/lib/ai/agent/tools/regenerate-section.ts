// app/src/lib/ai/agent/tools/regenerate-section.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { SectionSpec } from '@/lib/ai/agent/types'
import { generate } from '@/lib/ai/providers/router'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { db } from '@/lib/db'
import { agentSectionVersions, agentSections } from '@/lib/db/schema'
import { eq, and, max } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'
import { isFeatureEnabled } from '@/lib/feature-flags'

const log = logger.child({ component: 'tool-regenerate-section' })

const MODEL_ESCALATION_AFTER_RETRIES = 2

// Output-token caps mirror generate-section.ts. extra_long is gated on
// section_extra_long_enabled; without that flag it falls back to long.
const TOKEN_CAPS = {
  short: 6_000,
  medium: 10_000,
  long: 12_000,
  extra_long: 20_000,
} as const

function maxTokensFor(expectedLength: string | undefined, extraLongEnabled: boolean): number {
  if (expectedLength === 'extra_long') {
    return extraLongEnabled ? TOKEN_CAPS.extra_long : TOKEN_CAPS.long
  }
  if (expectedLength === 'long') return TOKEN_CAPS.long
  if (expectedLength === 'medium') return TOKEN_CAPS.medium
  return TOKEN_CAPS.short
}

// The LLM-callable surface for regenerate_section deliberately omits
// qualityMode. The "Regenerate with deep model" path is a trusted
// server/UI action — not an LLM choice — and must be plumbed through a
// non-tool channel (separate route handler that calls the service layer
// directly) so the LLM cannot self-escalate to Opus. Until that
// trusted-path wiring lands, every LLM-initiated regenerate runs in
// standard mode regardless of the deep_regeneration_enabled flag.
const inputSchema = z.object({
  sectionKey: z.string().min(1),
  feedback: z.string().min(1).describe('User feedback on what to change'),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<{ content: string; model: string }>> {
  const start = Date.now()

  try {
    const section = ctx.sections.find(s => s.sectionKey === input.sectionKey)
    if (!section) {
      return {
        success: false,
        error: `Section "${input.sectionKey}" not found`,
        retryable: false,
        telemetry: { latencyMs: Date.now() - start },
      }
    }

    const outline = (ctx.session.outline || []) as SectionSpec[]
    const spec = outline.find(s => s.id === input.sectionKey)

    // Route model via centralized resolver. Two policy paths:
    //   - deep_regeneration_enabled ON: explicit user opt-in only. Pass
    //     interactionMode='interactive' + qualityMode='deep' when the
    //     caller set qualityMode='deep' (UI "Regenerate with deep model"
    //     button), else interactive+standard for Sonnet. NO auto-escalation
    //     to Opus on retry count.
    //   - flag OFF: legacy behavior — escalate to Opus after 2 retries.
    //
    // bypassCache: true so an emergency rollback isn't delayed by the LRU.
    const retryCount = section.retryCount || 0
    const deepEnabled = await isFeatureEnabled('deep_regeneration_enabled', {
      userId: ctx.userId,
      bypassCache: true,
    })
    const interactiveSonnetEnabled = await isFeatureEnabled(
      'interactive_section_sonnet_default',
      { userId: ctx.userId, bypassCache: true },
    )
    const extraLongEnabled = await isFeatureEnabled(
      'section_extra_long_enabled',
      { userId: ctx.userId, bypassCache: true },
    )

    // LLM-callable regenerate ALWAYS runs in standard quality mode. The
    // qualityMode='deep' path is intentionally unreachable from this tool
    // until the trusted UI/server channel ships (see inputSchema comment).
    // deep_regeneration_enabled still serves a purpose here: when ON, it
    // disables the legacy auto-escalation to Opus on retry, keeping cost
    // predictable. When OFF, legacy retry escalation remains for
    // back-compat.
    const resolved = deepEnabled
      ? resolveAgentModel({
          task: 'section_generation',
          importance: (spec?.importance || 'standard') as 'critical' | 'standard' | 'supplementary',
          ctx: ctx.routingCtx,
          interactionMode: 'interactive',
          qualityMode: 'standard',
        })
      : resolveAgentModel({
          task: 'section_generation',
          importance: (spec?.importance || 'standard') as 'critical' | 'standard' | 'supplementary',
          ctx: ctx.routingCtx,
          // When interactive_section_sonnet_default is on (but deep flag is
          // off), still cap interactive turns to Sonnet. The auto-escalation
          // path collapses here too because the resolver ignores
          // isEscalation in the interactive+standard branch.
          ...(interactiveSonnetEnabled
            ? { interactionMode: 'interactive' as const }
            : { isEscalation: retryCount >= MODEL_ESCALATION_AFTER_RETRIES }),
        })
    const { provider: resolvedProvider, model } = resolved

    const previousContent = section.content || ''
    const systemPrompt = `You are an expert EU funding proposal writer.
You previously wrote this section and the user wants changes.

SECTION: ${spec?.title || input.sectionKey}
DESCRIPTION: ${spec?.description || ''}

PREVIOUS VERSION:
${previousContent}

USER FEEDBACK:
${input.feedback}

RULES:
- Address the feedback specifically
- Maintain the parts that were good
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- No placeholder text
- Output the full rewritten section content directly

FORMAT:
- Use ## for sub-section headings within this section
- Use ### for sub-sub-headings if needed
- Use **bold** for key terms, regulation names, and important values
- Use bullet lists (-) for enumerations of items, criteria, or features
- Use numbered lists (1.) only for ordered steps, phases, or ranked criteria
- Write in clear paragraphs between structured elements
- Do NOT use code fences, blockquotes, images, links, or HTML
- Do NOT include a section title heading — it is added separately`

    const response = await generate({
      provider: resolvedProvider,
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Rewrite the "${spec?.title || input.sectionKey}" section based on the feedback above.` }],
      temperature: 0.6,
      maxTokens: maxTokensFor(spec?.expectedLength, extraLongEnabled),
      signal: ctx.signal,
    })

    // Don't persist if the runtime aborted between LLM start and response —
    // same contract as generate-section.ts.
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
        error: 'Regenerated content too short',
        retryable: true,
        telemetry: { latencyMs: Date.now() - start, model, provider: response.provider },
      }
    }

    // Save version with race-safe allocation. Same pattern as generate-section.ts:
    // lock the parent section row, then max(version_number)+1. The old
    // `retryCount + 2` shortcut collided with concurrent writers on
    // uniq_agent_section_version_number.
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
        const [existingSection] = await tx.select()
          .from(agentSections)
          .where(and(eq(agentSections.sessionId, ctx.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
          .for('update')
          .limit(1)

        if (!existingSection) return

        const [maxRow] = await tx
          .select({ maxVersion: max(agentSectionVersions.versionNumber) })
          .from(agentSectionVersions)
          .where(eq(agentSectionVersions.sectionId, existingSection.id))
        const versionNumber = (maxRow?.maxVersion ?? 0) + 1

        await tx.insert(agentSectionVersions).values({
          sectionId: existingSection.id,
          versionNumber,
          kind: 'regenerated',
          content,
          modelUsed: model,
          sourcesUsed: (section.sourcesUsed ?? []) as unknown as Record<string, unknown>,
        })
      })
    } catch (dbErr) {
      log.warn({ error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, 'Failed to save regenerated version')
    }

    log.info({ sectionKey: input.sectionKey, model, retryCount: retryCount + 1, escalated: retryCount >= MODEL_ESCALATION_AFTER_RETRIES, latencyMs: Date.now() - start }, 'Section regenerated')

    return {
      success: true,
      data: { content, model },
      stateTransitions: [{
        type: 'UPSERT_SECTION_DRAFT',
        sectionKey: input.sectionKey,
        content,
        model,
        sources: (section.sourcesUsed as string[]) ?? [],
      }],
      checkpoint: { type: 'section_regenerated', payload: { sectionKey: input.sectionKey, feedback: input.feedback, model } },
      telemetry: {
        latencyMs: Date.now() - start,
        tokensUsed: response.tokensUsed,
        model,
        provider: response.provider,
        retryCount: retryCount + 1,
      },
    }
  } catch (error) {
    log.error({ sectionKey: input.sectionKey, error: error instanceof Error ? error.message : String(error) }, 'regenerate_section failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Section regeneration failed',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Input, { content: string; model: string }>({
  name: 'regenerate_section',
  category: 'generation',
  description: 'Regenerate a section with user feedback — escalates model after repeated failures',
  inputSchema,
  execute,
  // Matches generate_section: 240s budget so AbortSignal-honoring streams
  // don't get killed at the 120s mark just as they finish (May 19 2026
  // prod incident). See generate-section.ts for the full rationale.
  timeout: 240_000,
})

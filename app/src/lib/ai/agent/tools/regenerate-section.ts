// app/src/lib/ai/agent/tools/regenerate-section.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { SectionSpec } from '@/lib/ai/orchestrator/types'
import { generate } from '@/lib/ai/providers/router'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { db } from '@/lib/db'
import { agentSectionVersions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

const log = logger.child({ component: 'tool-regenerate-section' })

const MODEL_ESCALATION_AFTER_RETRIES = 2

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

    // Route model via centralized resolver (with escalation support)
    const retryCount = section.retryCount || 0
    const resolved = resolveAgentModel({
      task: 'section_generation',
      importance: (spec?.importance || 'standard') as 'critical' | 'standard' | 'supplementary',
      ctx: ctx.routingCtx,
      isEscalation: retryCount >= MODEL_ESCALATION_AFTER_RETRIES,
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
      maxTokens: spec?.expectedLength === 'long' ? 32_000 : spec?.expectedLength === 'medium' ? 20_000 : 8_000,
    })

    const content = normalizeMarkdown(response.content.trim())
    if (!content || content.length < 50) {
      return {
        success: false,
        error: 'Regenerated content too short',
        retryable: true,
        telemetry: { latencyMs: Date.now() - start, model, provider: response.provider },
      }
    }

    // Save version
    try {
      const [existingSection] = await db.select()
        .from(agentSections)
        .where(and(eq(agentSections.sessionId, ctx.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
        .limit(1)

      if (existingSection) {
        await db.insert(agentSectionVersions).values({
          sectionId: existingSection.id,
          versionNumber: retryCount + 2,
          kind: 'regenerated',
          content,
          modelUsed: model,
          sourcesUsed: [] as unknown as Record<string, unknown>,
        })
      }
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
        sources: [],
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

registerTool({
  name: 'regenerate_section',
  category: 'generation',
  description: 'Regenerate a section with user feedback — escalates model after repeated failures',
  inputSchema,
  execute: execute as any,
  timeout: 120_000,
})

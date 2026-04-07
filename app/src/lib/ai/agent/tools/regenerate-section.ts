// app/src/lib/ai/agent/tools/regenerate-section.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { SectionSpec } from '@/lib/ai/orchestrator/types'
import { generate } from '@/lib/ai/providers/router'
import { SECTION_MODEL_ROUTING } from '@/lib/ai/providers/types'
import { db } from '@/lib/db'
import { agentSectionVersions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logger } from '@/lib/logger'

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

    // Escalate model after 2+ retries
    const retryCount = section.retryCount || 0
    let model: string
    if (retryCount >= MODEL_ESCALATION_AFTER_RETRIES) {
      model = SECTION_MODEL_ROUTING.critical
    } else {
      const modelKey = spec?.importance === 'critical' ? 'critical'
        : spec?.importance === 'supplementary' ? 'budget'
        : 'standard'
      model = SECTION_MODEL_ROUTING[modelKey]
    }

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
- Output the full rewritten section content directly`

    const response = await generate({
      provider: 'anthropic',
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Rewrite the "${spec?.title || input.sectionKey}" section based on the feedback above.` }],
      temperature: 0.6,
      maxTokens: spec?.expectedLength === 'long' ? 6000 : spec?.expectedLength === 'medium' ? 4000 : 2000,
    })

    const content = response.content.trim()
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

// app/src/lib/ai/agent/tools/generate-section.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { SectionSpec } from '@/lib/ai/orchestrator/types'
import { generate } from '@/lib/ai/providers/router'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { compactPreviousSections } from '../section-specs'
import { db } from '@/lib/db'
import { agentSectionVersions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logger } from '@/lib/logger'
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

const log = logger.child({ component: 'tool-generate-section' })

const inputSchema = z.object({
  sectionKey: z.string().min(1).describe('The section key to generate'),
  additionalContext: z.string().optional().describe('Extra context or instructions from the user'),
})

type Input = z.infer<typeof inputSchema>

const LENGTH_GUIDE: Record<string, string> = {
  short: '500-1000 words (1-2 pages)',
  medium: '1000-2000 words (2-4 pages)',
  long: '2000-4000 words (4-8 pages)',
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

    // Route model by importance via centralized resolver
    const resolved = resolveAgentModel({
      task: 'section_generation',
      importance: spec.importance as 'critical' | 'standard' | 'supplementary',
      ctx: ctx.routingCtx,
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

    const blueprint = ctx.session.blueprint
    const blueprintContext = blueprint
      ? `\nCALL: ${(blueprint as any).program}\nCO-FINANCING: ${(((blueprint as any).cofinancingRate || 0) * 100).toFixed(0)}%`
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
      maxTokens: spec.expectedLength === 'long' ? 32_000 : spec.expectedLength === 'medium' ? 20_000 : 8_000,
    })

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
    try {
      let [existingSection] = await db.select()
        .from(agentSections)
        .where(and(eq(agentSections.sessionId, ctx.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
        .limit(1)

      if (!existingSection) {
        // Create section row so we have an ID for the version
        const [created] = await db.insert(agentSections).values({
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
      }

      if (existingSection) {
        const versionNumber = (existingSection.retryCount || 0) + 1
        await db.insert(agentSectionVersions).values({
          sectionId: existingSection.id,
          versionNumber,
          kind: 'draft',
          content,
          modelUsed: model,
          sourcesUsed: [] as unknown as Record<string, unknown>,
        })
      }
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
        sources: [],
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

registerTool({
  name: 'generate_section',
  category: 'generation',
  description: 'Generate a section of the funding application based on the outline and project context',
  inputSchema,
  execute: execute as any,
  timeout: 120_000,
})

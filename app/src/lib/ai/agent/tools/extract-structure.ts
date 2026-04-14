// app/src/lib/ai/agent/tools/extract-structure.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { SectionSpec } from '@/lib/ai/orchestrator/types'
import { generate } from '@/lib/ai/providers/router'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { parseAIJson } from '../utils'
import { DEFAULT_SECTIONS } from '../section-specs'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-extract-structure' })

const inputSchema = z.object({
  evidence: z.array(z.object({
    content: z.string(),
    docType: z.string(),
    source: z.string(),
  })),
  callTitle: z.string().optional(),
  program: z.string().optional(),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<SectionSpec[]>> {
  const start = Date.now()

  try {
    // Combine evidence for the LLM
    const evidenceText = input.evidence
      .map(e => `[${e.docType}] (${e.source}):\n${e.content}`)
      .join('\n\n---\n\n')

    if (!evidenceText.trim()) {
      log.info('No evidence provided, using default sections')
      return {
        success: true,
        data: DEFAULT_SECTIONS,
        warnings: ['No evidence available — using default section structure'],
        stateTransitions: [{ type: 'SET_OUTLINE', outline: DEFAULT_SECTIONS }],
        telemetry: { latencyMs: Date.now() - start },
      }
    }

    const { provider, model } = resolveAgentModel({ task: 'structure_extraction', ctx: ctx.routingCtx })
    const response = await generate({
      provider,
      model,
      system: `You extract the required application structure from EU funding call documentation.
Return a JSON array of section specs. Each object must have:
- id: kebab-case identifier (e.g. "context-si-justificare")
- title: Romanian section title
- description: What this section should contain
- order: display order (1-based)
- generationOrder: order for AI generation (may differ from display order)
- importance: "critical" | "standard" | "supplementary"
- expectedLength: "short" | "medium" | "long"
- dependsOn: array of section ids this depends on
- modelHint: "heavy" for complex sections, "light" for simple
- evaluationWeight: points weight if known
- mandatory: boolean
- confidence: 0-1 how confident you are this section is required`,
      messages: [{
        role: 'user',
        content: `Extract the required sections from this call documentation:\n\nCall: ${input.callTitle || 'Unknown'}\nProgram: ${input.program || 'Unknown'}\n\n${evidenceText}`,
      }],
      temperature: 0.2,
      maxTokens: 20_000,
    })

    let sections: SectionSpec[]
    try {
      sections = parseAIJson<SectionSpec[]>(response.content)
      if (!Array.isArray(sections) || sections.length === 0) {
        throw new Error('Parsed result is not a non-empty array')
      }
    } catch {
      log.warn('Failed to parse extracted structure, falling back to defaults')
      sections = DEFAULT_SECTIONS
    }

    log.info({ sectionCount: sections.length, latencyMs: Date.now() - start }, 'Structure extracted')

    return {
      success: true,
      data: sections,
      stateTransitions: [
        { type: 'SET_OUTLINE', outline: sections },
        { type: 'SET_PHASE', phase: 'structuring' as const },
      ],
      telemetry: {
        latencyMs: Date.now() - start,
        tokensUsed: response.tokensUsed,
        model: response.model,
        provider: response.provider,
      },
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'extract_structure failed')
    return {
      success: true, // Still succeed with defaults
      data: DEFAULT_SECTIONS,
      warnings: ['Structure extraction failed — using default sections'],
      stateTransitions: [{ type: 'SET_OUTLINE', outline: DEFAULT_SECTIONS }],
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool({
  name: 'extract_structure',
  category: 'decision',
  description: 'Extract required application section structure from call evidence',
  inputSchema,
  execute: execute as any,
  timeout: 60_000,
})

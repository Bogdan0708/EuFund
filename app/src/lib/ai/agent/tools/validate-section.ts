// app/src/lib/ai/agent/tools/validate-section.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext, SectionStatus } from '../types'
import { validateSection } from '../services/sections'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-validate-section' })

const inputSchema = z.object({
  sectionKey: z.string().min(1),
})

type Input = z.infer<typeof inputSchema>

interface ValidationResult {
  issues: Array<{ code: string; severity: 'error' | 'warning' | 'info'; message: string }>
  recommendedStatus: SectionStatus
  score: number
}

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<ValidationResult>> {
  const start = Date.now()

  try {
    const serviceCtx = {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      requestId: ctx.requestId,
      now: new Date(),
    }

    const result = await validateSection(serviceCtx, ctx.sessionId, input.sectionKey)

    log.info({
      sectionKey: input.sectionKey,
      issues: result.issues.length,
      score: result.score,
      status: result.recommendedStatus,
    }, 'Section validated')

    const errorCount = result.issues.filter(i => i.severity === 'error').length

    return {
      success: true,
      data: {
        issues: result.issues,
        recommendedStatus: result.recommendedStatus as SectionStatus,
        score: result.score,
      },
      warnings: result.issues.filter(i => i.severity !== 'info').map(i => `[${i.code}] ${i.message}`),
      stateTransitions: errorCount === 0
        ? [{ type: 'REJECT_SECTION' as const, sectionKey: input.sectionKey, reason: 'Validation passed — ready for review' }]
        : undefined,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'validate_section failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Section validation failed',
      retryable: false,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool({
  name: 'validate_section',
  category: 'decision',
  description: 'Validate a generated section for quality issues — placeholders, length, repetition',
  inputSchema,
  execute: execute as any,
  timeout: 5_000,
})

// app/src/lib/ai/agent/tools/validate-application.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { validateApplication } from '../services/application'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-validate-application' })

const inputSchema = z.object({})

async function execute(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult<Awaited<ReturnType<typeof validateApplication>>>> {
  const start = Date.now()

  try {
    const serviceCtx = {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      requestId: ctx.requestId,
      now: new Date(),
    }

    const validation = await validateApplication(serviceCtx, ctx.sessionId)

    log.info({
      passed: validation.passed,
      blockers: validation.issues.filter(i => i.severity === 'error').length,
      warnings: validation.issues.filter(i => i.severity === 'warning').length,
      accepted: validation.summary.acceptedSections,
      total: validation.summary.totalSections,
    }, 'Application validated')

    return {
      success: true,
      data: validation,
      warnings: validation.issues.filter(i => i.severity !== 'info').map(i => `[${i.code}] ${i.message}`),
      stateTransitions: validation.passed
        ? [{ type: 'SET_PHASE', phase: 'review' as const }]
        : undefined,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'validate_application failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Application validation failed',
      retryable: false,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Record<string, never>, Awaited<ReturnType<typeof validateApplication>>>({
  name: 'validate_application',
  category: 'decision',
  description: 'Validate the complete application — check mandatory sections, eligibility, annexes',
  inputSchema,
  execute,
  timeout: 10_000,
})

import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext, EligibilityResult } from '../types'
import { runEligibility } from '../services/eligibility'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-run-eligibility' })

const inputSchema = z.object({
  organization: z.object({
    orgType: z.string(),
    orgSize: z.string().optional(),
    caenPrimary: z.string().optional(),
    nutsRegion: z.string().optional(),
    employeeCount: z.number().optional(),
    annualRevenue: z.number().optional(),
  }),
  project: z.object({
    totalBudget: z.number().optional(),
    ownContrib: z.number().optional(),
    durationMonths: z.number().optional(),
  }),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, ctx: ToolContext): Promise<ToolResult<EligibilityResult>> {
  const start = Date.now()

  try {
    // Derive callId from session
    const callId = ctx.session.selectedCallId
    if (!callId) {
      return {
        success: false,
        error: 'No call selected — run resolve_call first',
        retryable: false,
        telemetry: { latencyMs: Date.now() - start },
      }
    }

    const serviceCtx = {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      requestId: ctx.requestId,
      now: new Date(),
    }

    const eligibility = await runEligibility(serviceCtx, { organization: input.organization, project: input.project }, callId)

    const warnings = eligibility.failCount > 0
      ? [`Eligibility check has ${eligibility.failCount} hard failure(s)`]
      : eligibility.warningCount > 0
        ? [`Eligibility check has ${eligibility.warningCount} warning(s)`]
        : undefined

    log.info({
      score: eligibility.score,
      pass: eligibility.passCount,
      fail: eligibility.failCount,
      warn: eligibility.warningCount,
    }, 'Eligibility check completed')

    return {
      success: true,
      data: eligibility,
      warnings,
      stateTransitions: [{ type: 'SET_ELIGIBILITY', result: eligibility }],
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'run_eligibility failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Eligibility check failed',
      retryable: false,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool<Input, EligibilityResult>({
  name: 'run_eligibility',
  category: 'decision',
  description: 'Run deterministic eligibility checks against call requirements',
  inputSchema,
  execute,
  timeout: 5_000,
})

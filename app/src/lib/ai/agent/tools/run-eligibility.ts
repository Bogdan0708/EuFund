import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext, EligibilityResult } from '../types'
import { runEligibilityRules, type RuleContext } from '@/lib/rules/eligibility'
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
    // Build RuleContext from blueprint + input
    const blueprint = ctx.session.blueprint
    const callData = blueprint ? {
      eligibleTypes: (blueprint as any).eligibilityCriteria as string[] | undefined,
      eligibleRegions: undefined as string[] | undefined,
      eligibleCaen: undefined as string[] | undefined,
      budgetMin: undefined as number | undefined,
      budgetMax: undefined as number | undefined,
      cofinancingRate: (blueprint as any).cofinancingRate as number | undefined,
    } : {}

    const ruleCtx: RuleContext = {
      organization: {
        orgType: input.organization.orgType,
        orgSize: input.organization.orgSize,
        caenPrimary: input.organization.caenPrimary,
        nutsRegion: input.organization.nutsRegion,
        employeeCount: input.organization.employeeCount,
        annualRevenue: input.organization.annualRevenue,
      },
      project: {
        totalBudget: input.project.totalBudget,
        ownContrib: input.project.ownContrib,
        durationMonths: input.project.durationMonths,
      },
      call: callData,
    }

    const result = runEligibilityRules(ruleCtx)

    const eligibility: EligibilityResult = {
      results: result.results.map(r => ({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        status: r.status,
        messageRo: r.messageRo,
        messageEn: r.messageEn,
        details: r.details,
      })),
      score: result.score,
      passCount: result.passCount,
      failCount: result.failCount,
      warningCount: result.warningCount,
    }

    const warnings = result.failCount > 0
      ? [`Eligibility check has ${result.failCount} hard failure(s)`]
      : result.warningCount > 0
        ? [`Eligibility check has ${result.warningCount} warning(s)`]
        : undefined

    log.info({
      score: result.score,
      pass: result.passCount,
      fail: result.failCount,
      warn: result.warningCount,
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

registerTool({
  name: 'run_eligibility',
  category: 'decision',
  description: 'Run deterministic eligibility checks against call requirements',
  inputSchema,
  execute: execute as any,
  timeout: 5_000,
})

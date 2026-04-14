// app/src/lib/ai/agent/tools/validate-application.ts
import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import type { SectionSpec } from '@/lib/ai/orchestrator/types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-validate-application' })

const inputSchema = z.object({})

interface ApplicationIssue {
  code: string
  severity: 'blocker' | 'warning' | 'info'
  message: string
  sectionKey?: string
}

interface ApplicationValidation {
  passed: boolean
  issues: ApplicationIssue[]
  summary: {
    totalSections: number
    acceptedSections: number
    draftSections: number
    missingSections: number
    mandatoryAnnexesMissing: number
    eligibilityBlockers: number
  }
}

async function execute(_input: unknown, ctx: ToolContext): Promise<ToolResult<ApplicationValidation>> {
  const start = Date.now()
  const issues: ApplicationIssue[] = []

  const outline = (ctx.session.outline || []) as SectionSpec[]
  const blueprint = ctx.session.blueprint as any

  // 1. Check mandatory sections
  const mandatorySections = outline.filter(s => s.mandatory !== false)
  const acceptedKeys = new Set(
    ctx.sections.filter(s => s.status === 'accepted').map(s => s.sectionKey)
  )
  const draftKeys = new Set(
    ctx.sections.filter(s => s.status === 'draft').map(s => s.sectionKey)
  )

  let missingSections = 0
  for (const spec of mandatorySections) {
    if (!acceptedKeys.has(spec.id) && !draftKeys.has(spec.id)) {
      issues.push({
        code: 'SECTION_MISSING',
        severity: 'blocker',
        message: `Mandatory section "${spec.title}" has not been generated`,
        sectionKey: spec.id,
      })
      missingSections++
    } else if (draftKeys.has(spec.id) && !acceptedKeys.has(spec.id)) {
      issues.push({
        code: 'SECTION_NOT_ACCEPTED',
        severity: 'warning',
        message: `Section "${spec.title}" is in draft — needs review and acceptance`,
        sectionKey: spec.id,
      })
    }
  }

  // 2. Check eligibility blockers
  let eligibilityBlockers = 0
  if (ctx.session.eligibility) {
    if (ctx.session.eligibility.failCount > 0) {
      issues.push({
        code: 'ELIGIBILITY_FAIL',
        severity: 'blocker',
        message: `${ctx.session.eligibility.failCount} eligibility check(s) failed`,
      })
      eligibilityBlockers = ctx.session.eligibility.failCount
    }
    if (ctx.session.eligibility.warningCount > 0) {
      issues.push({
        code: 'ELIGIBILITY_WARN',
        severity: 'warning',
        message: `${ctx.session.eligibility.warningCount} eligibility warning(s)`,
      })
    }
  } else {
    issues.push({
      code: 'ELIGIBILITY_NOT_RUN',
      severity: 'warning',
      message: 'Eligibility check has not been run',
    })
  }

  // 3. Check mandatory annexes
  let mandatoryAnnexesMissing = 0
  const mandatoryAnnexes = blueprint?.mandatoryAnnexes as string[] || []
  if (mandatoryAnnexes.length > 0) {
    const allContent = ctx.sections
      .map(s => (s.acceptedContent || s.content || '').toLowerCase())
      .join(' ')

    for (const annex of mandatoryAnnexes) {
      if (!allContent.includes(annex.toLowerCase())) {
        issues.push({
          code: 'ANNEX_MISSING',
          severity: 'warning',
          message: `Mandatory annex "${annex}" not referenced in any section`,
        })
        mandatoryAnnexesMissing++
      }
    }
  }

  // 4. Check freshness
  if (blueprint?.freshnessConfidence != null && blueprint.freshnessConfidence < 0.6) {
    issues.push({
      code: 'STALE_DATA',
      severity: 'warning',
      message: 'Call data freshness is low — consider refreshing before final submission',
    })
  }

  const blockers = issues.filter(i => i.severity === 'blocker')
  const passed = blockers.length === 0

  const validation: ApplicationValidation = {
    passed,
    issues,
    summary: {
      totalSections: outline.length,
      acceptedSections: acceptedKeys.size,
      draftSections: draftKeys.size,
      missingSections,
      mandatoryAnnexesMissing,
      eligibilityBlockers,
    },
  }

  log.info({
    passed,
    blockers: blockers.length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    accepted: acceptedKeys.size,
    total: outline.length,
  }, 'Application validated')

  return {
    success: true,
    data: validation,
    warnings: issues.filter(i => i.severity !== 'info').map(i => `[${i.code}] ${i.message}`),
    stateTransitions: passed
      ? [{ type: 'SET_PHASE', phase: 'review' as const }]
      : undefined,
    telemetry: { latencyMs: Date.now() - start },
  }
}

registerTool({
  name: 'validate_application',
  category: 'decision',
  description: 'Validate the complete application — check mandatory sections, eligibility, annexes',
  inputSchema,
  execute: execute as any,
  timeout: 10_000,
})

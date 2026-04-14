// ── Eligibility Service ────────────────────────────────────────────────────
// Deterministic eligibility evaluation and fit scoring against a call.
// No LLM calls — all logic is rules-based.
//
// Layer rule: import only from @/lib/db, @/lib/db/schema, @/lib/rules,
// drizzle-orm, ./errors, and ./types. No V3 or MCP imports.

import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { runEligibilityRules, type RuleContext } from '@/lib/rules/eligibility'
import { NotFoundError } from './errors'
import type {
  ServiceContext,
  EligibilityDecision,
  FitScore,
} from './types'

// ── ProjectSummary (input shape) ───────────────────────────────────────────

export interface EligibilityInput {
  organization: {
    orgType: string
    orgSize?: string
    caenPrimary?: string
    nutsRegion?: string
    employeeCount?: number
    annualRevenue?: number
  }
  project: {
    totalBudget?: number
    ownContrib?: number
    durationMonths?: number
  }
}

// ── Helper: load call blueprint fields ────────────────────────────────────

async function loadCallFields(callId: string): Promise<{
  eligibleTypes?: string[]
  eligibleRegions?: string[]
  eligibleCaen?: string[]
  budgetMin?: number
  budgetMax?: number
  cofinancingRate?: number
  durationMin?: number
  durationMax?: number
  submissionEnd?: string
  program?: string
} | null> {
  const rows = await db
    .select()
    .from(callKnowledge)
    .where(eq(callKnowledge.callId, callId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const norm = (row.normalized as Record<string, unknown>) ?? {}
  return {
    eligibleTypes: (norm.eligibilityCriteria as string[] | undefined),
    eligibleRegions: (norm.eligibleRegions as string[] | undefined),
    eligibleCaen: (norm.eligibleCaen as string[] | undefined),
    budgetMin: (norm.budgetMin as number | undefined),
    budgetMax: (norm.budgetMax as number | undefined),
    cofinancingRate: (norm.cofinancingRate as number | undefined),
    durationMin: (norm.durationMin as number | undefined),
    durationMax: (norm.durationMax as number | undefined),
    submissionEnd: (norm.submissionEnd as string | undefined),
    program: row.program,
  }
}

// ── runEligibility ─────────────────────────────────────────────────────────

/**
 * Runs deterministic eligibility rules for a project against a call.
 *
 * Loads the call's blueprint from `call_knowledge` and maps fields into
 * `RuleContext`. Returns an `EligibilityDecision` with per-rule results,
 * overall score, and pass/fail/warning counts.
 *
 * Throws `NotFoundError` when `callId` is not in the knowledge base.
 */
export async function runEligibility(
  _ctx: ServiceContext,
  input: EligibilityInput,
  callId: string,
): Promise<EligibilityDecision> {
  const callFields = await loadCallFields(callId)
  if (!callFields) {
    throw new NotFoundError('call', callId)
  }

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
    call: {
      eligibleTypes: callFields.eligibleTypes,
      eligibleRegions: callFields.eligibleRegions,
      eligibleCaen: callFields.eligibleCaen,
      budgetMin: callFields.budgetMin,
      budgetMax: callFields.budgetMax,
      cofinancingRate: callFields.cofinancingRate,
      durationMin: callFields.durationMin,
      durationMax: callFields.durationMax,
      submissionEnd: callFields.submissionEnd,
    },
  }

  const result = runEligibilityRules(ruleCtx)

  return {
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
}

// ── scoreFit ───────────────────────────────────────────────────────────────

/**
 * Computes a multi-dimensional fit score comparing project characteristics
 * against call requirements.
 *
 * Dimensions:
 *   - thematicFit: sector/org-type alignment (0–100)
 *   - eligibilityFit: derived from runEligibilityRules score (0–100)
 *   - budgetFit: how well project budget aligns with call range (0–100)
 *
 * All scoring is deterministic — no LLM calls.
 *
 * Throws `NotFoundError` when `callId` is not in the knowledge base.
 */
export async function scoreFit(
  _ctx: ServiceContext,
  input: EligibilityInput,
  callId: string,
): Promise<FitScore> {
  const callFields = await loadCallFields(callId)
  if (!callFields) {
    throw new NotFoundError('call', callId)
  }

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
    call: {
      eligibleTypes: callFields.eligibleTypes,
      eligibleRegions: callFields.eligibleRegions,
      eligibleCaen: callFields.eligibleCaen,
      budgetMin: callFields.budgetMin,
      budgetMax: callFields.budgetMax,
      cofinancingRate: callFields.cofinancingRate,
      durationMin: callFields.durationMin,
      durationMax: callFields.durationMax,
      submissionEnd: callFields.submissionEnd,
    },
  }

  // ── Eligibility dimension: reuse rules engine ──────────────────────────
  const eligResult = runEligibilityRules(ruleCtx)
  const eligibilityFit = eligResult.score

  // ── Thematic dimension: org-type alignment + CAEN + region ────────────
  // Each sub-dimension is worth ~33 points; we give partial credit for
  // not_applicable (data not available) to avoid punishing sparse profiles.
  let thematicPoints = 0
  let thematicFactors = 0

  // Org type
  const orgTypeResult = eligResult.results.find(r => r.ruleId === 'ELIG-001')
  if (orgTypeResult && orgTypeResult.status !== 'not_applicable') {
    thematicFactors++
    if (orgTypeResult.status === 'pass') thematicPoints += 33
    else if (orgTypeResult.status === 'warning') thematicPoints += 15
  }

  // Region
  const regionResult = eligResult.results.find(r => r.ruleId === 'ELIG-002')
  if (regionResult && regionResult.status !== 'not_applicable') {
    thematicFactors++
    if (regionResult.status === 'pass') thematicPoints += 33
    else if (regionResult.status === 'warning') thematicPoints += 15
  }

  // CAEN
  const caenResult = eligResult.results.find(r => r.ruleId === 'ELIG-003')
  if (caenResult && caenResult.status !== 'not_applicable') {
    thematicFactors++
    if (caenResult.status === 'pass') thematicPoints += 34
    else if (caenResult.status === 'warning') thematicPoints += 15
  }

  // If no thematic factors evaluated, assume moderate fit (50)
  const thematicFit = thematicFactors > 0
    ? Math.min(100, Math.round((thematicPoints / (thematicFactors * 33.33)) * 100))
    : 50

  // ── Budget dimension: how well project budget aligns with call range ──
  let budgetFit = 100
  const budget = input.project.totalBudget

  if (budget !== undefined) {
    const budgetResult = eligResult.results.find(r => r.ruleId === 'BUD-001')
    if (budgetResult) {
      if (budgetResult.status === 'pass') {
        budgetFit = 100
      } else if (budgetResult.status === 'fail') {
        // Compute distance from nearest boundary to give partial credit
        const min = callFields.budgetMin
        const max = callFields.budgetMax
        if (min !== undefined && budget < min) {
          const distance = (min - budget) / min
          budgetFit = Math.max(0, Math.round(100 - distance * 100))
        } else if (max !== undefined && budget > max) {
          const distance = (budget - max) / max
          budgetFit = Math.max(0, Math.round(100 - distance * 100))
        } else {
          budgetFit = 50
        }
      } else {
        // warning / not_applicable
        budgetFit = 75
      }
    }
  } else {
    // No budget provided — neutral score
    budgetFit = 50
  }

  // ── Overall: weighted average ──────────────────────────────────────────
  // Weights: eligibility 50%, thematic 30%, budget 20%
  const overallScore = Math.round(
    eligibilityFit * 0.5 + thematicFit * 0.3 + budgetFit * 0.2,
  )

  // ── Reasoning summary ──────────────────────────────────────────────────
  const reasoningParts: string[] = []
  reasoningParts.push(`Eligibility: ${eligibilityFit}/100 (${eligResult.passCount} pass, ${eligResult.failCount} fail, ${eligResult.warningCount} warn)`)
  reasoningParts.push(`Thematic fit: ${thematicFit}/100`)
  reasoningParts.push(`Budget fit: ${budgetFit}/100`)
  if (eligResult.failCount > 0) {
    const failures = eligResult.results.filter(r => r.status === 'fail').map(r => r.ruleName)
    reasoningParts.push(`Failing rules: ${failures.join(', ')}`)
  }

  return {
    callId,
    overallScore,
    thematicFit,
    eligibilityFit,
    budgetFit,
    reasoning: reasoningParts.join('. '),
  }
}

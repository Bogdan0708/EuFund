// ── Policy enforcement helper ──────────────────────────────────────────────
// assertPolicy is called by service functions AFTER ownership +
// stateVersion checks. It reads a rule from POLICY_MATRIX and throws a
// typed ValidationError with a stable policyCode on any gate failure.
//
// This helper is the only place that knows how to interpret the rule
// shape. Callers treat it as a black-box guard.

import type { AgentSession, SectionStatus } from '../types'
import { ValidationError } from '../services/errors'
import type { PolicyRule } from './matrix'
import { isEligibilityPassed } from './eligibility'
import { metrics } from '@/lib/monitoring/metrics'

export interface AssertPolicyOpts {
  sectionState?: SectionStatus
  sectionKey?: string
}

export function assertPolicy(
  rule: PolicyRule,
  session: AgentSession,
  opts: AssertPolicyOpts = {},
  ruleName: string = rule.auditAction,
): void {
  // 1. Session status
  if (rule.requiresSessionStatus && !rule.requiresSessionStatus.includes(session.status)) {
    const code = rule.errorCodes.sessionStatus ?? 'UNKNOWN'
    metrics.inc('policy_violation_total', { rule: ruleName, code })
    throw new ValidationError(
      'sessionStatus',
      `Session status is '${session.status}'; expected one of ${rule.requiresSessionStatus.join(', ')}`,
      code,
    )
  }

  // 2. Call selected
  if (rule.requiresCallSelected && !session.selectedCallId) {
    const code = rule.errorCodes.noCall ?? 'UNKNOWN'
    metrics.inc('policy_violation_total', { rule: ruleName, code })
    throw new ValidationError(
      'selectedCallId',
      'No call selected on this session',
      code,
    )
  }

  // 3. Outline frozen forbidden
  if (rule.forbidsOutlineFrozen && session.outlineFrozen) {
    const code = rule.errorCodes.outlineFrozen ?? 'UNKNOWN'
    metrics.inc('policy_violation_total', { rule: ruleName, code })
    throw new ValidationError(
      'outlineFrozen',
      'Operation not allowed while outline is frozen',
      code,
    )
  }

  // 4. Outline frozen required
  if (rule.requiresOutlineFrozen && !session.outlineFrozen) {
    const code = rule.errorCodes.outlineNotFrozen ?? 'UNKNOWN'
    metrics.inc('policy_violation_total', { rule: ruleName, code })
    throw new ValidationError(
      'outlineFrozen',
      'Outline must be frozen before this operation',
      code,
    )
  }

  // 5. Outline present
  if (rule.requiresOutlinePresent) {
    if (!session.outline || session.outline.length === 0) {
      const code = rule.errorCodes.outlineMissing ?? 'UNKNOWN'
      metrics.inc('policy_violation_total', { rule: ruleName, code })
      throw new ValidationError(
        'outline',
        `${code}: Outline must be present (at least one section) before this operation`,
        code,
      )
    }
  }

  // 6. SectionKey must be in outline
  if (rule.requiresSectionKeyInOutline) {
    const key = opts.sectionKey
    const found = key && session.outline?.some(s => s.id === key)
    if (!found) {
      const code = rule.errorCodes.sectionNotInOutline ?? 'UNKNOWN'
      metrics.inc('policy_violation_total', { rule: ruleName, code })
      throw new ValidationError(
        'sectionKey',
        `${code}: Section key '${key ?? '<unset>'}' is not part of this session's outline`,
        code,
      )
    }
  }

  // 7. Eligibility
  if (rule.requiresEligibility === 'passed' && !isEligibilityPassed(session.eligibility)) {
    const code = rule.errorCodes.eligibility ?? 'UNKNOWN'
    metrics.inc('policy_violation_total', { rule: ruleName, code })
    throw new ValidationError(
      'eligibility',
      'Eligibility must have been run and produced no hard failures',
      code,
    )
  }

  // 8. Section state allowlist
  if (rule.allowedSectionStates && opts.sectionState !== undefined) {
    if (!rule.allowedSectionStates.includes(opts.sectionState)) {
      const code = rule.errorCodes.sectionWrongState ?? 'UNKNOWN'
      metrics.inc('policy_violation_total', { rule: ruleName, code })
      throw new ValidationError(
        'sectionState',
        `Section state is '${opts.sectionState}'; expected one of ${rule.allowedSectionStates.join(', ')}`,
        code,
      )
    }
  }

  // 9. Section state denylist (forbidIfSectionState) — currently unused,
  //    kept for future mutations where a denylist is cleaner than an
  //    allowlist.
  if (rule.forbidIfSectionState && opts.sectionState !== undefined) {
    if (rule.forbidIfSectionState.includes(opts.sectionState)) {
      const code = rule.errorCodes.sectionWrongState ?? 'UNKNOWN'
      metrics.inc('policy_violation_total', { rule: ruleName, code })
      throw new ValidationError(
        'sectionState',
        `Section state '${opts.sectionState}' is not allowed for this operation`,
        code,
      )
    }
  }
}

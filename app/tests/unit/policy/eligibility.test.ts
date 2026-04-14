import { describe, it, expect } from 'vitest'
import { isEligibilityPassed } from '@/lib/ai/agent/policy/eligibility'
import type { EligibilityResult } from '@/lib/ai/agent/types'

describe('isEligibilityPassed', () => {
  it('returns false for null', () => {
    expect(isEligibilityPassed(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isEligibilityPassed(undefined)).toBe(false)
  })

  it('returns true when failCount is 0', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 100,
      passCount: 5,
      failCount: 0,
      warningCount: 0,
    }
    expect(isEligibilityPassed(decision)).toBe(true)
  })

  it('returns false when failCount is positive', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 60,
      passCount: 3,
      failCount: 2,
      warningCount: 0,
    }
    expect(isEligibilityPassed(decision)).toBe(false)
  })

  it('returns true when there are warnings but no failures', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 90,
      passCount: 5,
      failCount: 0,
      warningCount: 3,
    }
    expect(isEligibilityPassed(decision)).toBe(true)
  })

  it('returns false when failCount is 1 (boundary)', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 80,
      passCount: 4,
      failCount: 1,
      warningCount: 0,
    }
    expect(isEligibilityPassed(decision)).toBe(false)
  })
})

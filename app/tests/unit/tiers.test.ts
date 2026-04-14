import { describe, it, expect } from 'vitest'
import { TIER_LIMITS, getTierLimits } from '@/lib/billing/tiers'

describe('Tier limits', () => {
  it('defines four tiers', () => {
    expect(Object.keys(TIER_LIMITS)).toEqual(['free', 'plus', 'pro', 'ultra'])
  })

  it('free tier has 1 total workflow', () => {
    const limits = getTierLimits('free')
    expect(limits.workflowsPerMonth).toBe(1)
    expect(limits.isLifetimeLimit).toBe(true)
  })

  it('plus tier has 10 workflows/mo', () => {
    const limits = getTierLimits('plus')
    expect(limits.workflowsPerMonth).toBe(10)
    expect(limits.editsPerMonth).toBe(50)
  })

  it('pro tier has premium build model', () => {
    const limits = getTierLimits('pro')
    expect(limits.buildModel).toBe('premium')
  })

  it('ultra tier supports team members', () => {
    const limits = getTierLimits('ultra')
    expect(limits.maxTeamMembers).toBe(5)
  })

  it('unknown tier falls back to free', () => {
    const limits = getTierLimits('unknown' as any)
    expect(limits.workflowsPerMonth).toBe(1)
  })
})

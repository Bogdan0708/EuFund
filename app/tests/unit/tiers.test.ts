import { describe, it, expect } from 'vitest'
import { TIER_LIMITS, getTierLimits } from '@/lib/billing/tiers'

describe('Tier limits', () => {
  it('defines three tiers', () => {
    expect(Object.keys(TIER_LIMITS)).toEqual(['free', 'pro', 'enterprise'])
  })

  it('free tier has 3 monthly workflows', () => {
    const limits = getTierLimits('free')
    expect(limits.workflowsPerMonth).toBe(3)
    expect(limits.isLifetimeLimit).toBe(false)
  })

  it('enterprise tier has 200 workflows/mo', () => {
    const limits = getTierLimits('enterprise')
    expect(limits.workflowsPerMonth).toBe(200)
    expect(limits.editsPerMonth).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('pro tier has premium build model', () => {
    const limits = getTierLimits('pro')
    expect(limits.buildModel).toBe('premium')
  })

  it('enterprise tier supports team members', () => {
    const limits = getTierLimits('enterprise')
    expect(limits.maxTeamMembers).toBe(5)
  })

  it('unknown tier falls back to free', () => {
    const limits = getTierLimits('unknown' as any)
    expect(limits.workflowsPerMonth).toBe(3)
  })
})

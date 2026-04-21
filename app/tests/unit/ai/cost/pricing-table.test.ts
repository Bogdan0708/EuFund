import { describe, it, expect } from 'vitest'
import { PRICING_V1 } from '@/lib/ai/cost/pricing-table'

describe('PRICING_V1', () => {
  it('tags a table version', () => {
    expect(PRICING_V1._tableVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('includes current Anthropic models with cache multipliers', () => {
    const opus = PRICING_V1.anthropic['claude-opus-4-6']
    expect(opus).toBeDefined()
    expect(opus.cacheWriteMultiplier).toBe(1.25)
    expect(opus.cacheReadMultiplier).toBe(0.10)
    expect(opus.inputPerMTok).toBeGreaterThan(0)
    expect(opus.outputPerMTok).toBeGreaterThan(0)
  })

  it('includes current OpenAI models with a cache discount', () => {
    const gpt = PRICING_V1.openai['gpt-5.4']
    expect(gpt).toBeDefined()
    expect(gpt.cachedInputDiscount).toBe(0.5)
    expect(gpt.inputPerMTok).toBeGreaterThan(0)
    expect(gpt.outputPerMTok).toBeGreaterThan(0)
  })
})

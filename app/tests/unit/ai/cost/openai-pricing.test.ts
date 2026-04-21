import { describe, it, expect } from 'vitest'
import { computeOpenAICostMicros } from '@/lib/ai/cost/openai-pricing'
import { PRICING_V1 } from '@/lib/ai/cost/pricing-table'

describe('computeOpenAICostMicros', () => {
  const model = 'gpt-5.4'
  const rates = PRICING_V1.openai[model]

  it('zero cached tokens ⇒ full input cost', () => {
    const cost = computeOpenAICostMicros({ prompt_tokens: 1000, completion_tokens: 500 }, model)
    const expected =
      Math.round(1000 * rates.inputPerMTok / 1_000_000) +
      Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(cost).toBe(expected)
  })

  it('cached tokens are billed at the discount', () => {
    const cost = computeOpenAICostMicros({
      prompt_tokens: 1000,
      completion_tokens: 500,
      prompt_tokens_details: { cached_tokens: 400 },
    }, model)
    const expected =
      Math.round((1000 - 400) * rates.inputPerMTok / 1_000_000) +
      Math.round(400 * rates.inputPerMTok * rates.cachedInputDiscount / 1_000_000) +
      Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(cost).toBe(expected)
  })

  it('unknown model ⇒ 0', () => {
    expect(computeOpenAICostMicros({ prompt_tokens: 100, completion_tokens: 50 }, 'unknown')).toBe(0)
  })
})

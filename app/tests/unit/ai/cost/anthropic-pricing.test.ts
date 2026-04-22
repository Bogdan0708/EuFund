import { describe, it, expect } from 'vitest'
import { computeAnthropicCostMicros } from '@/lib/ai/cost/anthropic-pricing'
import { PRICING_V1 } from '@/lib/ai/cost/pricing-table'

describe('computeAnthropicCostMicros — cache-aware', () => {
  const model = 'claude-opus-4-6'
  const rates = PRICING_V1.anthropic[model]

  it('zero cache fields ⇒ base formula', () => {
    const cost = computeAnthropicCostMicros({ input_tokens: 1000, output_tokens: 500 }, model)
    const expected = Math.round(1000 * rates.inputPerMTok / 1_000_000) + Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(cost).toBe(expected)
  })

  it('cache fields non-overlapping with input_tokens', () => {
    // 1000 standard input, 800 written, 400 read. All separate fields.
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 800,
      cache_read_input_tokens: 400,
    }
    const expected =
      Math.round(1000 * rates.inputPerMTok / 1_000_000) +
      Math.round(800 * rates.inputPerMTok * rates.cacheWriteMultiplier / 1_000_000) +
      Math.round(400 * rates.inputPerMTok * rates.cacheReadMultiplier / 1_000_000) +
      Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(computeAnthropicCostMicros(usage, model)).toBe(expected)
  })

  it('returns 0 when model is not in the table (graceful fallback)', () => {
    expect(computeAnthropicCostMicros({ input_tokens: 100, output_tokens: 50 }, 'unknown-model')).toBe(0)
  })
})

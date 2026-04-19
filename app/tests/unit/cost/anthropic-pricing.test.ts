import { describe, it, expect } from 'vitest'
import {
  ANTHROPIC_PRICES,
  computeAnthropicCostMicros,
  normalizeModelForPricing,
  addUsage,
} from '@/lib/ai/cost/anthropic-pricing'

describe('normalizeModelForPricing', () => {
  it('returns the key itself for an exact alias match', () => {
    expect(normalizeModelForPricing('claude-opus-4-7')).toBe('claude-opus-4-7')
    expect(normalizeModelForPricing('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  it('matches a dated suffix to the alias (hyphen boundary)', () => {
    expect(normalizeModelForPricing('claude-opus-4-7-20260115')).toBe('claude-opus-4-7')
    expect(normalizeModelForPricing('claude-haiku-4-5-20250820')).toBe('claude-haiku-4-5')
  })

  it('matches an @-dated variant to the alias', () => {
    expect(normalizeModelForPricing('claude-opus-4-7@20260115')).toBe('claude-opus-4-7')
  })

  it('prefers the longer matching prefix when two aliases share a root', () => {
    // claude-opus-4-7 is longer than a hypothetical claude-opus-4, so a
    // dated claude-opus-4-7-* must not accidentally normalize to the shorter.
    expect(normalizeModelForPricing('claude-opus-4-7-20260115')).toBe('claude-opus-4-7')
  })

  it('returns the input unchanged when nothing matches', () => {
    expect(normalizeModelForPricing('claude-opus-3-5')).toBe('claude-opus-3-5')
    expect(normalizeModelForPricing('gpt-4')).toBe('gpt-4')
    expect(normalizeModelForPricing('')).toBe('')
  })
})

describe('computeAnthropicCostMicros', () => {
  it('computes cost for a plain input+output usage block (no cache)', () => {
    // 1,000,000 input × 15 + 1,000,000 output × 75 = 90_000_000 micros
    const micros = computeAnthropicCostMicros('claude-opus-4-7', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })
    expect(micros).toBe(90_000_000)
  })

  it('subtracts cache_read and cache_creation buckets from base input', () => {
    // input=1M, of which 400k is cache_read and 100k is cache_write.
    // non_cached = 1M - 400k - 100k = 500k
    // cost = 500k × 15 + 100k × 18.75 + 400k × 1.5 + 0 × 75
    //      = 7_500_000 + 1_875_000 + 600_000 = 9_975_000
    const micros = computeAnthropicCostMicros('claude-opus-4-7', {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 400_000,
    })
    expect(micros).toBe(9_975_000)
  })

  it('clamps negative non-cached-input to zero', () => {
    // Defensive: if API ever reports cache buckets summing above input_tokens,
    // we must not produce negative cost.
    const micros = computeAnthropicCostMicros('claude-opus-4-7', {
      input_tokens: 100,
      output_tokens: 0,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 200,
    })
    // non_cached_input clamped to 0; only cache charges survive
    // 200 × 18.75 + 200 × 1.5 = 3_750 + 300 = 4_050
    expect(micros).toBe(4_050)
  })

  it('returns 0 for an unknown model (and logs nothing)', () => {
    const micros = computeAnthropicCostMicros('claude-opus-3-5', {
      input_tokens: 1_000,
      output_tokens: 1_000,
    })
    expect(micros).toBe(0)
  })

  it('resolves a dated model ID to its alias and returns non-zero cost', () => {
    // Regression: P2 finding — runtime passes API-reported `message.model`
    // which often includes a date suffix. Without normalization this
    // returned 0 silently.
    const micros = computeAnthropicCostMicros('claude-opus-4-7-20260115', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })
    expect(micros).toBe(90_000_000)
    expect(micros).not.toBe(0)
  })

  it('covers every alias in ANTHROPIC_PRICES', () => {
    // Guard against future pricing entries that aren't exercised.
    for (const alias of Object.keys(ANTHROPIC_PRICES)) {
      const micros = computeAnthropicCostMicros(alias, {
        input_tokens: 1_000,
        output_tokens: 1_000,
      })
      expect(micros).toBeGreaterThan(0)
    }
  })
})

describe('addUsage', () => {
  it('sums all four usage fields', () => {
    const a = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 }
    const b = { input_tokens: 200, output_tokens: 75, cache_creation_input_tokens: 5,  cache_read_input_tokens: 0  }
    expect(addUsage(a, b)).toEqual({
      input_tokens: 300,
      output_tokens: 125,
      cache_creation_input_tokens: 15,
      cache_read_input_tokens: 20,
    })
  })

  it('treats missing fields as zero', () => {
    expect(addUsage({}, { output_tokens: 42 })).toEqual({
      input_tokens: 0,
      output_tokens: 42,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    })
  })
})

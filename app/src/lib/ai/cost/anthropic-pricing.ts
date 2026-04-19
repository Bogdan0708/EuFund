// ── Anthropic pricing (USD per 1M tokens) ─────────────────────
// Source: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
// and the public pricing page. Values are list prices as of 2026-01.
//
// cache_write is charged at ~125% of base input (the "cache creation"
// premium), cache_read at ~10%. Numbers below are per-million tokens
// so the math stays readable. Update this file when Anthropic publishes
// new list prices; callers do not cache these rates.

export interface Price {
  inputPerM: number
  outputPerM: number
  cacheWritePerM: number
  cacheReadPerM: number
}

export const ANTHROPIC_PRICES: Record<string, Price> = {
  'claude-opus-4-7':    { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.5 },
  'claude-opus-4-6':    { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.5 },
  'claude-sonnet-4-6':  { inputPerM: 3,  outputPerM: 15, cacheWritePerM: 3.75,  cacheReadPerM: 0.3 },
  'claude-sonnet-4-7':  { inputPerM: 3,  outputPerM: 15, cacheWritePerM: 3.75,  cacheReadPerM: 0.3 },
  'claude-haiku-4-5':   { inputPerM: 0.8, outputPerM: 4, cacheWritePerM: 1,     cacheReadPerM: 0.08 },
}

export interface UsageLike {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

/**
 * Normalize an Anthropic model identifier to a key in ANTHROPIC_PRICES.
 * The API can return dated IDs (e.g. `claude-opus-4-7-20260115`) or
 * aliases (e.g. `claude-opus-4-7`); the pricing table only keys on
 * aliases. Match longest-prefix first so `claude-opus-4-7-20260115`
 * doesn't accidentally normalize to a shorter `claude-opus-4` alias.
 * Returns the original model string if nothing matches so the caller's
 * unknown-model → 0 branch still fires.
 */
export function normalizeModelForPricing(model: string): string {
  const keys = Object.keys(ANTHROPIC_PRICES).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (model === k) return k
    if (model.startsWith(k + '-') || model.startsWith(k + '@')) return k
  }
  return model
}

/**
 * Compute the USD cost of a single Anthropic API call from its usage
 * block. Returns 0 for unknown models and logs nothing (caller decides
 * whether unknown-model is worth a warning).
 *
 * Math:
 *   non_cached_input = input_tokens - cache_creation_input_tokens - cache_read_input_tokens
 *                     (Anthropic's input_tokens includes cache-reads; the
 *                      cache_creation bucket is billed separately at the
 *                      write rate, so we subtract both buckets from the
 *                      base input.)
 *   cost = non_cached_input × input_rate
 *        + cache_creation × cache_write_rate
 *        + cache_read     × cache_read_rate
 *        + output_tokens  × output_rate
 */
export function computeAnthropicCostMicros(model: string, usage: UsageLike): number {
  const rates = ANTHROPIC_PRICES[normalizeModelForPricing(model)]
  if (!rates) return 0

  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const nonCachedInput = Math.max(input - cacheWrite - cacheRead, 0)

  const micros =
    nonCachedInput * rates.inputPerM +
    cacheWrite * rates.cacheWritePerM +
    cacheRead * rates.cacheReadPerM +
    output * rates.outputPerM

  return Math.round(micros)
}

/**
 * Sum two usage blocks. Used to accumulate usage across multiple
 * stream iterations of a single turn.
 */
export function addUsage(a: UsageLike, b: UsageLike): UsageLike {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_creation_input_tokens:
      (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  }
}

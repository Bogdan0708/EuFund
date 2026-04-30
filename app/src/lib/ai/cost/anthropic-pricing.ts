import { PRICING_V1 } from './pricing-table'

export interface UsageLike {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function addUsage(a: UsageLike, b: UsageLike): UsageLike {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  }
}

interface AnthropicRates {
  inputPerMTok: number
  outputPerMTok: number
  cacheWriteMultiplier: number
  cacheReadMultiplier: number
}

// Anthropic stream events sometimes echo a dated identifier (e.g. the bare
// alias `claude-sonnet-4-6` is returned today, but historically the API
// has resolved it to `claude-sonnet-4-6-YYYYMMDD`). The pricing table is
// keyed on bare aliases, so we strip a trailing 8-digit date suffix before
// lookup. Defensive — keeps cost telemetry accurate if Anthropic flips back.
export function normalizeAnthropicModel(model: string): string {
  return model.toLowerCase().replace(/-\d{8}$/, '')
}

export function computeAnthropicCostMicros(usage: UsageLike, model: string): number {
  const key = normalizeAnthropicModel(model)
  const rates = (PRICING_V1.anthropic as Record<string, AnthropicRates>)[key]
  if (!rates) return 0

  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  const inputCost = Math.round((input * rates.inputPerMTok) / 1_000_000)
  const writeCost = Math.round((cacheWrite * rates.inputPerMTok * rates.cacheWriteMultiplier) / 1_000_000)
  const readCost = Math.round((cacheRead * rates.inputPerMTok * rates.cacheReadMultiplier) / 1_000_000)
  const outputCost = Math.round((output * rates.outputPerMTok) / 1_000_000)

  return inputCost + writeCost + readCost + outputCost
}

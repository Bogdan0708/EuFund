import { PRICING_V1 } from './pricing-table'

export interface OpenAIUsageLike {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

interface OpenAIRates {
  inputPerMTok: number
  outputPerMTok: number
  cachedInputDiscount: number
}

export function computeOpenAICostMicros(usage: OpenAIUsageLike, model: string): number {
  const rates = (PRICING_V1.openai as Record<string, OpenAIRates>)[model]
  if (!rates) return 0

  const prompt = usage.prompt_tokens ?? 0
  const completion = usage.completion_tokens ?? 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const nonCached = Math.max(0, prompt - cached)

  const inputCost = Math.round((nonCached * rates.inputPerMTok) / 1_000_000)
  const cachedCost = Math.round((cached * rates.inputPerMTok * rates.cachedInputDiscount) / 1_000_000)
  const outputCost = Math.round((completion * rates.outputPerMTok) / 1_000_000)

  return inputCost + cachedCost + outputCost
}

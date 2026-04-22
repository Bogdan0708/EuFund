// Rates are in USD micro-units per million tokens. Pulled from provider pricing
// pages on the _tableVersion date. Update _tableVersion when any rate changes.
export const PRICING_V1 = {
  _tableVersion: '2026-04-21' as const,
  anthropic: {
    'claude-opus-4-6':   { inputPerMTok: 15_000_000, outputPerMTok: 75_000_000, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.10 },
    'claude-sonnet-4-6': { inputPerMTok:  3_000_000, outputPerMTok: 15_000_000, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.10 },
    'claude-haiku-4-5':  { inputPerMTok:    800_000, outputPerMTok:  4_000_000, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.10 },
  },
  openai: {
    'gpt-5.4':      { inputPerMTok: 3_000_000, outputPerMTok: 15_000_000, cachedInputDiscount: 0.5 },
    'gpt-5.4-mini': { inputPerMTok:   600_000, outputPerMTok:  2_400_000, cachedInputDiscount: 0.5 },
    'gpt-5.4-nano': { inputPerMTok:   150_000, outputPerMTok:    600_000, cachedInputDiscount: 0.5 },
  },
} as const

export type PricingTable = typeof PRICING_V1

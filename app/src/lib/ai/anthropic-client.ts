// ── Anthropic SDK client factory ────────────────────────────────
// Lazy module-level singleton. Single source of truth for Anthropic
// client construction. Tests stub `getAnthropicClient` via vi.mock.

import Anthropic from '@anthropic-ai/sdk'

let cachedClient: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (cachedClient) return cachedClient

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  cachedClient = new Anthropic({
    apiKey,
    timeout: 60_000, // 60s per request — longer than V3 because managed turns span multiple sub-streams
  })

  return cachedClient
}

// Test-only reset helper. Do not call from production code.
export function __resetAnthropicClientForTests(): void {
  cachedClient = null
}

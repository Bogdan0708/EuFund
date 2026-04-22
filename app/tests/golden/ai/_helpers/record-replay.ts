import type { GenerateResult } from '@/lib/ai/providers/types'

export interface NormalizedRequest {
  provider: string
  model: string
  system: unknown
  tools: unknown
  messages: unknown
}

export function normalizeAnthropicNativeRequest(req: unknown): NormalizedRequest {
  const r = req as { model: string; system?: unknown; tools?: unknown; messages: unknown }
  const stripCache = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(stripCache)
    if (o && typeof o === 'object') {
      const copy: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === 'cache_control') continue
        copy[k] = stripCache(v)
      }
      return copy
    }
    return o
  }
  return {
    provider: 'anthropic',
    model: r.model,
    system: stripCache(r.system),
    tools: stripCache(r.tools),
    messages: stripCache(r.messages),
  }
}

export function normalizeShimRequest(req: unknown): NormalizedRequest {
  const r = req as { model: string; messages: unknown; tools?: unknown }
  const msgs = Array.isArray(r.messages)
    ? (r.messages as Array<{ role?: string }>).filter((m) => m.role !== 'system')
    : r.messages
  return {
    provider: 'anthropic',
    model: r.model,
    system: undefined,
    tools: r.tools,
    messages: msgs,
  }
}

export type RecordedResponse = GenerateResult
export type Recording = { request: NormalizedRequest; response: RecordedResponse }

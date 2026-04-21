import type { GenerateRequest } from './types'

const CACHE_CONTROL_EPHEMERAL = { type: 'ephemeral' as const }

export interface AnthropicNativeSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface AnthropicNativeTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  cache_control?: { type: 'ephemeral' }
}

export interface AnthropicNativeRequest {
  system?: AnthropicNativeSystemBlock[]
  tools?: AnthropicNativeTool[]
  messages: unknown[]  // filled in by later tasks
}

export function translateRequestToAnthropic(req: GenerateRequest): AnthropicNativeRequest {
  const cacheSystem = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('system')
  const cacheTools = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('tools')

  const out: AnthropicNativeRequest = { messages: [] }

  if (req.system !== undefined) {
    out.system = [{
      type: 'text',
      text: req.system,
      ...(cacheSystem ? { cache_control: CACHE_CONTROL_EPHEMERAL } : {}),
    }]
  }

  if (req.tools && req.tools.length > 0) {
    out.tools = req.tools.map((t, i) => {
      const isLast = i === req.tools!.length - 1
      return {
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
        cache_control: cacheTools && isLast ? CACHE_CONTROL_EPHEMERAL : undefined,
      }
    })
  }

  return out
}

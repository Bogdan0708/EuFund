import { getAnthropicClient } from '@/lib/ai/anthropic-client'
import { deriveIdentityKey } from './cache-key'
import type { GenerateRequest, GenerateResult, CacheOptions } from './types'

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

export interface AnthropicTextBlock { type: 'text'; text: string }
export interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string }

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicNativeRequest {
  system?: AnthropicNativeSystemBlock[]
  tools?: AnthropicNativeTool[]
  messages: AnthropicMessage[]
}

function translateMessages(msgs: GenerateRequest['messages']): {
  messages: AnthropicMessage[]
  extraSystemTexts: string[]
} {
  const out: AnthropicMessage[] = []
  const extraSystemTexts: string[] = []
  let currentToolGroup: AnthropicToolResultBlock[] | null = null

  const flushToolGroup = () => {
    if (currentToolGroup && currentToolGroup.length > 0) {
      out.push({ role: 'user', content: currentToolGroup })
    }
    currentToolGroup = null
  }

  for (const m of msgs) {
    if (m.role === 'system') {
      // Anthropic native has no message-level system role; hoist the content to
      // an additional top-level system block (uncached — only req.system is the
      // stable cached prefix). V3's history-summary pattern uses this.
      extraSystemTexts.push(m.content)
      continue
    }

    if (m.role === 'tool') {
      if (!m.tool_call_id) {
        throw new Error('anthropic-native: tool message missing tool_call_id')
      }
      if (!currentToolGroup) currentToolGroup = []
      currentToolGroup.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: m.content,
      })
      continue
    }

    flushToolGroup()

    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }

    // assistant
    if (m.tool_calls && m.tool_calls.length > 0) {
      const blocks: AnthropicContentBlock[] = []
      if (m.content && m.content.length > 0) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) {
        let input: unknown = {}
        try { input = JSON.parse(tc.function.arguments) } catch { input = {} }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
      out.push({ role: 'assistant', content: blocks })
    } else {
      out.push({ role: 'assistant', content: m.content })
    }
  }

  flushToolGroup()
  return { messages: out, extraSystemTexts }
}

export function translateRequestToAnthropic(req: GenerateRequest): AnthropicNativeRequest {
  const cacheSystem = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('system')
  const cacheTools = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('tools')

  const { messages, extraSystemTexts } = translateMessages(req.messages)
  const out: AnthropicNativeRequest = { messages }

  const systemBlocks: AnthropicNativeSystemBlock[] = []
  if (req.system !== undefined) {
    systemBlocks.push({
      type: 'text',
      text: req.system,
      ...(cacheSystem ? { cache_control: CACHE_CONTROL_EPHEMERAL } : {}),
    })
  }
  for (const text of extraSystemTexts) {
    systemBlocks.push({ type: 'text', text })
  }
  if (systemBlocks.length > 0) {
    out.system = systemBlocks
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

export interface AnthropicNativeResponse {
  content: AnthropicContentBlock[]
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export interface TranslateResponseContext {
  model: string
  cacheRequested?: CacheOptions
  identityKey?: string
  effectiveTtlSeconds?: number
}

export function translateResponseFromAnthropic(
  resp: AnthropicNativeResponse,
  ctx: TranslateResponseContext,
): GenerateResult {
  let text = ''
  const toolCalls: { id: string; name: string; arguments: string }[] = []

  for (const block of resp.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      })
    }
  }

  const result: GenerateResult = {
    content: text,
    tokensUsed: { input: resp.usage.input_tokens, output: resp.usage.output_tokens },
    model: ctx.model,
    provider: 'anthropic',
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }

  // Defensive guard: the native path is only reached when cache.enabled === true
  // (per the Anthropic adapter branch), but we assert the invariant here so a
  // mis-wired caller cannot leak a disabled-shape cacheUsage from this code path.
  if (ctx.cacheRequested?.enabled === true && ctx.identityKey) {
    const reads = resp.usage.cache_read_input_tokens ?? 0
    const writes = resp.usage.cache_creation_input_tokens ?? 0
    result.cacheUsage = {
      requested: true,
      enabled: true,
      disabledReason: 'none',
      identityKey: ctx.identityKey,
      supported: true,
      reads,
      writes,
      hit: reads > 0 ? 'read' : 'miss',
      ...(ctx.effectiveTtlSeconds !== undefined ? { effectiveTtlSeconds: ctx.effectiveTtlSeconds } : {}),
    }
  }

  return result
}

let ttlClampWarned = false

export function clampTtl(input: number | undefined): { effective: number | undefined; clamped: boolean } {
  if (input === undefined) return { effective: undefined, clamped: false }
  if (input <= 300) return { effective: input, clamped: false }
  if (!ttlClampWarned) {
    // eslint-disable-next-line no-console
    console.warn('[anthropic-native] ttlSeconds > 300 requested; clamping to 300. Subsequent clamps silent.')
    ttlClampWarned = true
  }
  return { effective: 300, clamped: true }
}

// Test-only reset.
export function __resetTtlClampWarningForTests() { ttlClampWarned = false }

export async function anthropicNativeGenerate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
  const anthropic = getAnthropicClient()
  const translated = translateRequestToAnthropic(req)
  const { effective: effectiveTtlSeconds } = clampTtl(req.cache?.ttlSeconds)
  const identityKey = req.cache ? deriveIdentityKey(req) : undefined

  const response = await anthropic.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 20_000,
    temperature: req.temperature ?? 0.7,
    ...(translated.system ? { system: translated.system } : {}),
    ...(translated.tools ? { tools: translated.tools } : {}),
    messages: translated.messages,
  } as unknown as Parameters<typeof anthropic.messages.create>[0],
  signal ? { signal } : undefined)

  return translateResponseFromAnthropic(response as unknown as AnthropicNativeResponse, {
    model: req.model,
    cacheRequested: req.cache,
    identityKey,
    effectiveTtlSeconds,
  })
}

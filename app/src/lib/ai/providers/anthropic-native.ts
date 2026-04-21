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

function translateMessages(msgs: GenerateRequest['messages']): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  let currentToolGroup: AnthropicToolResultBlock[] | null = null

  const flushToolGroup = () => {
    if (currentToolGroup && currentToolGroup.length > 0) {
      out.push({ role: 'user', content: currentToolGroup })
    }
    currentToolGroup = null
  }

  for (const m of msgs) {
    if (m.role === 'system') {
      throw new Error('System-role messages must be passed via req.system, not req.messages')
    }

    if (m.role === 'tool') {
      if (!currentToolGroup) currentToolGroup = []
      currentToolGroup.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id ?? '',
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
  return out
}

export function translateRequestToAnthropic(req: GenerateRequest): AnthropicNativeRequest {
  const cacheSystem = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('system')
  const cacheTools = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('tools')

  const out: AnthropicNativeRequest = { messages: translateMessages(req.messages) }

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

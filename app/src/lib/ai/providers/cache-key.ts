import { createHash } from 'crypto'
import type { GenerateRequest, ToolSchema } from './types'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']'
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const pairs = keys.map((k) =>
    JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]),
  )
  return '{' + pairs.join(',') + '}'
}

function normalizeTool(tool: ToolSchema): unknown {
  return {
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }
}

export function deriveIdentityKey(
  req: Pick<GenerateRequest, 'provider' | 'model' | 'system' | 'tools'>,
): string {
  const payload = canonicalJson({
    provider: req.provider,
    model: req.model,
    system: req.system ?? '',
    tools: (req.tools ?? []).map(normalizeTool),
  })
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

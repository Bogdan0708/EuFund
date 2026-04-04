import { logger } from '@/lib/logger'

const log = logger.child({ component: 'orchestrator-utils' })

/**
 * Extract and parse JSON from AI responses that may include
 * markdown fences, preamble text, or trailing commentary.
 */
export function parseAIJson<T = unknown>(raw: string): T {
  let cleaned = raw.trim()

  // Strategy 1: Strip markdown code fences using indexOf (no regex backtracking on large strings)
  const fenceStart = cleaned.indexOf('```')
  if (fenceStart !== -1) {
    const contentStart = cleaned.indexOf('\n', fenceStart)
    const fenceEnd = cleaned.lastIndexOf('```')
    if (contentStart !== -1 && fenceEnd > contentStart) {
      cleaned = cleaned.slice(contentStart + 1, fenceEnd).trim()
    }
  }

  // Strategy 2: Try direct parse
  try {
    return JSON.parse(cleaned)
  } catch {
    // Continue to extraction strategies
  }

  // Strategy 3: Extract first JSON object { ... } from the text
  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0])
    } catch {
      // Continue
    }
  }

  // Strategy 4: Extract first JSON array [ ... ] from the text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0])
    } catch {
      // Continue
    }
  }

  // Strategy 5: Try removing common AI response wrapping
  // e.g., "Here is the JSON:\n{...}\n\nI hope this helps!"
  const lines = cleaned.split('\n')
  const jsonLines: string[] = []
  let inJson = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!inJson && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      inJson = true
    }
    if (inJson) {
      jsonLines.push(line)
      // Check if we have balanced braces
      const joined = jsonLines.join('\n')
      try {
        const result = JSON.parse(joined)
        return result as T
      } catch {
        // Keep accumulating lines
      }
    }
  }

  // Strategy 6: Handle truncated JSON arrays by finding last complete object
  const arrayStart = cleaned.indexOf('[')
  if (arrayStart !== -1) {
    let truncated = cleaned.slice(arrayStart)
    // Find the last complete object boundary (closing brace followed by optional whitespace/comma)
    const lastCompleteObj = truncated.lastIndexOf('}')
    if (lastCompleteObj > 0) {
      truncated = truncated.slice(0, lastCompleteObj + 1) + ']'
      try {
        const result = JSON.parse(truncated)
        log.warn({ rawLength: raw.length, recoveredItems: Array.isArray(result) ? result.length : 1 }, 'Recovered truncated JSON array')
        return result as T
      } catch {
        // Continue to failure
      }
    }
  }

  // All strategies failed — log the raw response for debugging
  log.error({ rawLength: raw.length, rawPreview: raw.slice(0, 500) }, 'All JSON parsing strategies failed')
  throw new Error(`Failed to extract JSON from AI response (${raw.length} chars). Preview: ${raw.slice(0, 100)}...`)
}

/**
 * Convert a Zod schema to a JSON Schema object for OpenAI tool definitions.
 * Handles common Zod types: object, string, number, boolean, array, optional, enum.
 */
export function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  const s = schema as { _def?: { typeName?: string; shape?: () => Record<string, unknown>; innerType?: unknown; values?: string[]; type?: unknown; minLength?: unknown; maxLength?: unknown; minimum?: unknown; maximum?: unknown; description?: string; defaultValue?: () => unknown } }
  if (!s?._def) return { type: 'object', properties: {} }

  const def = s._def
  const base: Record<string, unknown> = {}
  if (def.description) base.description = def.description

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape?.() || {}
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(val)
        const valDef = (val as { _def?: { typeName?: string } })?._def
        if (valDef?.typeName !== 'ZodOptional' && valDef?.typeName !== 'ZodDefault') {
          required.push(key)
        }
      }
      return { ...base, type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
    }
    case 'ZodString':
      return { ...base, type: 'string' }
    case 'ZodNumber':
      return { ...base, type: 'number' }
    case 'ZodBoolean':
      return { ...base, type: 'boolean' }
    case 'ZodArray':
      return { ...base, type: 'array', items: zodToJsonSchema(def.type) }
    case 'ZodOptional':
    case 'ZodDefault':
      return zodToJsonSchema(def.innerType)
    case 'ZodEnum':
      return { ...base, type: 'string', enum: def.values }
    default:
      return { ...base, type: 'string' }
  }
}

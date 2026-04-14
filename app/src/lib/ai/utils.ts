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
 * Convert a Zod schema to a JSON Schema object for OpenAI / Anthropic tool definitions.
 * Handles common Zod types: object, string, number, boolean, array, optional, default, enum.
 *
 * Supports both Zod 3 (legacy `_def.typeName` = "ZodObject", `_def.shape()`) and
 * Zod 4 (`_def.type` = "object", `_def.shape` is a plain record). The installed
 * version is Zod 4.x but we keep the Zod 3 branch for safety during upgrades.
 */
export function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  const s = schema as {
    _def?: {
      // Shared
      description?: string
      innerType?: unknown
      // Zod 3 fields
      typeName?: string
      values?: string[]
      defaultValue?: () => unknown
      // `type` is overloaded: in Zod 3 for ZodArray it is the element schema;
      // in Zod 4 it is the lowercase type tag (e.g. "object", "string"). We
      // read it as unknown and branch on its shape below.
      type?: unknown
      // Zod 4 object shape (plain record, not a function)
      shape?: Record<string, unknown> | (() => Record<string, unknown>)
      // Zod 4 array element
      element?: unknown
      // Zod 4 enum entries
      entries?: Record<string, string | number>
    }
  }
  if (!s?._def) return { type: 'object', properties: {} }

  const def = s._def
  const base: Record<string, unknown> = {}
  if (def.description) base.description = def.description

  // Normalize the type tag: prefer Zod 3's `typeName`, fall back to Zod 4's `type`
  // string (only when it is a plain string — in Zod 3 `def.type` held the array
  // element schema, so we must not confuse them).
  const tag =
    typeof def.typeName === 'string'
      ? def.typeName
      : typeof def.type === 'string'
        ? def.type
        : undefined

  switch (tag) {
    // ── Object ────────────────────────────────────────────────
    case 'ZodObject':
    case 'object': {
      const rawShape = def.shape
      const shape =
        typeof rawShape === 'function'
          ? (rawShape as () => Record<string, unknown>)()
          : (rawShape as Record<string, unknown>) || {}
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(val)
        const valDef = (val as { _def?: { typeName?: string; type?: unknown } })?._def
        const innerTag =
          typeof valDef?.typeName === 'string'
            ? valDef.typeName
            : typeof valDef?.type === 'string'
              ? valDef.type
              : undefined
        if (
          innerTag !== 'ZodOptional' &&
          innerTag !== 'ZodDefault' &&
          innerTag !== 'optional' &&
          innerTag !== 'default'
        ) {
          required.push(key)
        }
      }
      return { ...base, type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
    }
    // ── Primitives ────────────────────────────────────────────
    case 'ZodString':
    case 'string':
      return { ...base, type: 'string' }
    case 'ZodNumber':
    case 'number':
      return { ...base, type: 'number' }
    case 'ZodBoolean':
    case 'boolean':
      return { ...base, type: 'boolean' }
    // ── Array ─────────────────────────────────────────────────
    case 'ZodArray':
    case 'array': {
      // Zod 4 stores the element under `element`; Zod 3 under `type`.
      const items = def.element !== undefined ? def.element : def.type
      return { ...base, type: 'array', items: zodToJsonSchema(items) }
    }
    // ── Wrappers — unwrap and recurse ─────────────────────────
    case 'ZodOptional':
    case 'optional':
    case 'ZodDefault':
    case 'default':
      return zodToJsonSchema(def.innerType)
    // ── Enum ──────────────────────────────────────────────────
    case 'ZodEnum':
    case 'enum': {
      // Zod 3: `values` is a string array. Zod 4: `entries` is a record of
      // label → value (keys equal values for string enums).
      const values = def.values ?? (def.entries ? Object.values(def.entries) : [])
      return { ...base, type: 'string', enum: values }
    }
    default:
      return { ...base, type: 'string' }
  }
}

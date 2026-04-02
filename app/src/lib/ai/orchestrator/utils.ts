import { logger } from '@/lib/logger'

const log = logger.child({ component: 'orchestrator-utils' })

/**
 * Extract and parse JSON from AI responses that may include
 * markdown fences, preamble text, or trailing commentary.
 */
export function parseAIJson<T = unknown>(raw: string): T {
  let cleaned = raw.trim()

  // Strategy 1: Strip ALL markdown code fences (greedy — handles large responses)
  // Use greedy match to capture the LAST closing fence, not the first
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n([\s\S]*)\n\s*```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  } else {
    // Also try without newlines (single-line fence)
    const inlineFence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (inlineFence) {
      cleaned = inlineFence[1].trim()
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

  // All strategies failed — log the raw response for debugging
  log.error({ rawLength: raw.length, rawPreview: raw.slice(0, 500) }, 'All JSON parsing strategies failed')
  throw new Error(`Failed to extract JSON from AI response (${raw.length} chars). Preview: ${raw.slice(0, 100)}...`)
}

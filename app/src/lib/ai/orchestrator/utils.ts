/**
 * Strip markdown code fences from AI responses before JSON.parse.
 * LLMs often wrap JSON in ```json ... ``` despite being told not to.
 */
export function parseAIJson<T = unknown>(raw: string): T {
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/m)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }
  return JSON.parse(cleaned)
}

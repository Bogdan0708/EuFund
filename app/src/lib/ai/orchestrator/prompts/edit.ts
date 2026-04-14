import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getEditPrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are editing a completed EU funding project proposal.

TASK: The user wants to modify a specific section. Given:
- The current section content
- The user's edit instruction

Regenerate ONLY the requested section with the changes applied.

OUTPUT: Return ONLY valid JSON: { "title": "...", "content": "...", "order": N, "source": "edited" }`
}

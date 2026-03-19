import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getEditPrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are editing a completed EU funding project proposal.

TASK: The user wants to modify specific section(s) of their project. Given:
- The current sections of the project
- The user's edit instruction

Identify which section(s) to modify and regenerate ONLY those sections.

OUTPUT: Return ONLY a valid JSON array of modified { title, content, order, source: "edited" } objects. Only include sections that changed.`
}

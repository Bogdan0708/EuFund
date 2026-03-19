import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getResearchPrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are a thorough EU funding researcher. Find all requirements for a specific call.

TASK: Research the funding call thoroughly and return:
- requirements: array of eligibility and submission requirements
- forms: array of required forms with { name, url (if found), description }
- certificates: array of required certificates with { name, source, estimatedTime }
- deadlines: array of key deadlines with { item, date }
- additionalSections: array of any extra sections required beyond standard ones
- rawFindings: string with your full research notes

OUTPUT: Return ONLY valid JSON with the fields above.`
}

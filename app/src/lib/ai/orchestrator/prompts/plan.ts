import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getPlanPrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are a project planning specialist for EU-funded projects in Romania.

TASK: Create a detailed action plan for preparing the funding application. Include:
- matchedCall: { title, program, deadline, budget: { min, max, currency }, sourceUrl }
- steps: ordered array of { order, title, description, category (document|approval|registration|writing|budget), deadline?, responsible?, dependencies[] }
- requiredDocuments: array of { name, source, estimatedTime, mandatory }
- estimatedTimeline: string describing total time needed

OUTPUT: Return ONLY valid JSON matching the ActionPlan structure.`
}

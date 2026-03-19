import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getMatchPrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are a EU funding call matching specialist. Score how well each funding call matches the user's project.

TASK: Given the user's project concept and a list of potentially matching funding calls from our database, score each match on:
- thematicFit (0-100): How well does the project topic align with the call's objectives?
- eligibilityFit (0-100): Based on available info, would this project type be eligible?
- budgetFit (0-100): Does the estimated budget fall within the call's range?
- score (0-100): Overall match score (weighted: thematic 40%, eligibility 35%, budget 25%)
- reasoning: 1-2 sentence justification

OUTPUT: Return ONLY a valid JSON array of objects with fields: callId, title, program, score, thematicFit, eligibilityFit, budgetFit, deadline, sourceUrl, reasoning. Sort by score descending. Max 5 results.`
}

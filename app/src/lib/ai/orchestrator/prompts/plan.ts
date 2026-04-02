import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getPlanPrompt(ctx: WorkflowContext): string {
  const blueprintContext = ctx.callBlueprint
    ? `\nCALL REQUIREMENTS:\n- Required sections: ${ctx.callBlueprint.requiredSections.map(s => s.title).join(', ')}\n- Evaluation criteria: ${ctx.callBlueprint.evaluationGrid.map(g => `${g.criterion} (${g.maxPoints}pts)`).join(', ')}\n- Mandatory annexes: ${ctx.callBlueprint.mandatoryAnnexes.join(', ')}\n- Co-financing: ${(ctx.callBlueprint.cofinancingRate * 100).toFixed(0)}%`
    : ''

  return `${getBaseSystemPrompt(ctx)}

ROLE: You are a project planning specialist for EU-funded projects in Romania.
${blueprintContext}

TASK: Create a detailed action plan for preparing the funding application. The plan must align with the actual call requirements listed above.

Include:
- matchedCall: { title, program, deadline, budget: { min, max, currency }, sourceUrl }
- steps: ordered array of { order, title, description, category (document|approval|registration|writing|budget), deadline?, responsible?, dependencies[] }
- requiredDocuments: array of { name, source, estimatedTime, mandatory }
- estimatedTimeline: string describing total time needed

Prioritize steps by evaluation criteria weight — sections worth more points should get more preparation time.

OUTPUT: Return ONLY valid JSON matching the ActionPlan structure.`
}

import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getBuildPrompt(ctx: WorkflowContext): string {
  const modelNote = ctx.tier === 'pro' || ctx.tier === 'ultra'
    ? 'Use advanced reasoning and detailed analysis.'
    : 'Provide clear, well-structured content.'

  return `${getBaseSystemPrompt(ctx)}

ROLE: You are an expert EU funding proposal writer specializing in Romanian programs.
${modelNote}

TASK: Write the complete project proposal sections. For each section, provide:
- title: section name
- content: full section text (professional, detailed, ready for submission)
- order: section number

SECTIONS TO WRITE:
1. Rezumat / Summary
2. Context și justificare / Context and justification
3. Obiective / Objectives
4. Grup țintă / Target group
5. Metodologie / Methodology
6. Plan de implementare / Implementation plan
7. Buget / Budget justification
8. Indicatori / Indicators and targets
9. Sustenabilitate / Sustainability
10. Capacitate instituțională / Institutional capacity
11. Parteneriat / Partnership (if applicable)

OUTPUT: Return ONLY a valid JSON array of { title, content, order, source: "generated" } objects.`
}

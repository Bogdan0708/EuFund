import type { WorkflowContext, SectionSpec, SectionResult } from '../types'
import { getBaseSystemPrompt } from './system'
import { compactPreviousSections } from '../section-specs'

export function getBuildSectionPrompt(
  ctx: WorkflowContext,
  sectionSpec: SectionSpec,
  previousSections: SectionResult[],
): string {
  const evaluationNote = sectionSpec.evaluationWeight
    ? `\nEVALUATION: This section is worth ${sectionSpec.evaluationWeight} points in the scoring grid. Write accordingly.`
    : ''

  const lengthGuide = {
    short: '1-2 pages (500-1000 words)',
    medium: '2-4 pages (1000-2000 words)',
    long: '4-8 pages (2000-4000 words)',
  }[sectionSpec.expectedLength]

  const blueprintContext = ctx.callBlueprint
    ? `\nCALL: ${ctx.callBlueprint.program}\nCO-FINANCING: ${(ctx.callBlueprint.cofinancingRate * 100).toFixed(0)}%`
    : ''

  const previousContext = previousSections.length > 0
    ? `\n\nPREVIOUSLY WRITTEN SECTIONS:\n${compactPreviousSections(previousSections, sectionSpec)}`
    : ''

  return `${getBaseSystemPrompt(ctx)}

ROLE: You are an expert EU funding proposal writer.
${blueprintContext}
${evaluationNote}

TASK: Write the section "${sectionSpec.title}" for this project proposal.

SECTION REQUIREMENTS:
- Title: ${sectionSpec.title}
- Description: ${sectionSpec.description}
- Expected length: ${lengthGuide}

PROJECT CONCEPT:
${JSON.stringify(ctx.enhancedIdea, null, 2)}

ACTION PLAN SUMMARY:
${ctx.actionPlan ? JSON.stringify({ steps: ctx.actionPlan.steps.map(s => s.title), timeline: ctx.actionPlan.estimatedTimeline }) : 'Not available'}
${previousContext}

RULES:
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- Be specific, use concrete numbers and timelines
- Reference the evaluation criteria where relevant
- Maintain consistency with previously written sections
- Use formal but accessible language appropriate for EU funding applications

OUTPUT: Return ONLY valid JSON: { "title": "...", "content": "...", "order": ${sectionSpec.order} }`
}

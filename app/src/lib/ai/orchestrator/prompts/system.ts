import type { WorkflowContext } from '../types'

/**
 * Converts the user's `responseStyle` preference into a concrete writing
 * directive that the model receives as part of the system prompt.
 */
function getStyleDirective(style: WorkflowContext['responseStyle']): string {
  switch (style) {
    case 'concise':
      return 'RESPONSE STYLE: Concise. Use short sentences, bullet points over prose, no preambles. Aim for the minimum output that answers completely.'
    case 'technical':
      return 'RESPONSE STYLE: Technical. Use precise terminology, cite regulation articles, include numeric thresholds and deadlines verbatim, prefer structured (table/list) formats.'
    case 'detailed':
    default:
      return 'RESPONSE STYLE: Detailed. Provide thorough explanations with context, rationale, and examples. Balance completeness with readability.'
  }
}

export function getBaseSystemPrompt(ctx: WorkflowContext): string {
  const locale = ctx.locale === 'en' ? 'English' : 'Romanian'
  const styleDirective = getStyleDirective(ctx.responseStyle)
  return `You are an AI assistant specialized in Romanian EU funding applications.

CONTEXT:
- Platform: FondEU (PlatformaFinantare.eu)
- User locale: ${locale}
- Respond in ${locale}

${styleDirective}

RULES:
- Always cite sources when referencing specific programs or calls
- Use official Romanian program names (PNRR, PEO, POTJ, POCIDIF, etc.)
- Flag uncertainty clearly — never fabricate call details
- Use formal but accessible language
- All monetary values in EUR unless otherwise specified`
}

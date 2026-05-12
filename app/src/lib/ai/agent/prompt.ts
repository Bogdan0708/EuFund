import type { AgentSession, AgentSection, Phase, EligibilityResult } from './types'
import type { CallBlueprint } from '@/lib/ai/agent/types'

type SessionWithKnowledgeSummary = AgentSession & { _knowledgeSummary?: string }

function formatEligibility(elig: EligibilityResult | null): string {
  if (!elig) return 'Not checked yet'
  if (elig.failCount > 0) return `BLOCKED — ${elig.failCount} hard failures`
  if (elig.warningCount > 0) return `Passed with ${elig.warningCount} warnings (score: ${elig.score}%)`
  return `Passed (score: ${elig.score}%)`
}

function formatSections(sections: AgentSection[]): string {
  if (sections.length === 0) return 'No sections yet'
  return sections
    .sort((a, b) => a.documentOrder - b.documentOrder)
    .map(s => `  - ${s.sectionKey}: ${s.status}`)
    .join('\n')
}

function formatWarnings(warnings: { code: string; message: string; severity: string }[]): string {
  if (warnings.length === 0) return 'None'
  return warnings.map(w => `  - [${w.severity}] ${w.message}`).join('\n')
}

const PHASE_GUIDANCE: Record<Phase, string> = {
  discovery: 'Help the user describe their project and organization. Ask about sector, region, budget range, timeline. When ready, use the search_calls tool to find matching calls — never invent calls inline.',
  research: 'Use resolve_call / get_call_blueprint to load the call. Use run_eligibility to verify eligibility. Present the blueprint and eligibility result to the user — do not write the blueprint content yourself.',
  structuring: 'Use extract_structure to derive the required application outline from the call evidence — never write the outline as free-form text. After the tool returns, present the sections for approval and address any eligibility issues.',
  drafting: 'Always use the generate_section tool to produce section content — NEVER write full section drafts as chat text. The tool persists drafts to structured storage; chat text is not saved as a section and disappears on refresh. After each tool result, offer: accept, regenerate with feedback, or skip.',
  review: 'Use validate_application and check_missing_annexes to assess completeness. Show missing items, warnings, annexes checklist as concise summaries — never re-author section content here.',
}

/**
 * Stable cacheable system prefix. Byte-identical for the life of (sessionId, phase)
 * when used with the Anthropic cache path. See docs/runbooks/audits/v3-prompt-stability-2026-04.md.
 *
 * IMPORTANT: do not interpolate session state, warnings, sections, timestamps,
 * or any per-turn mutable content here. That volatile tail lives in
 * buildSessionStateBlock() and is delivered as a separate role:'system' message
 * in the conversation (hoisted to an uncached system block by the Anthropic
 * native adapter — see lib/ai/providers/anthropic-native.ts:52-59, 111-114).
 */
export function buildSystemPrompt(
  session: AgentSession,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _sections: AgentSection[],
): string {
  return `You are FondEU, an expert assistant for Romanian EU funding applications.
You help users prepare cereri de finanțare (funding applications).

## Rules
- Never invent facts. Use tools to retrieve information.
- Always cite which tool/source provided a fact.
- When you don't have enough information, say so and suggest which tool to use.
- Present section structures and eligibility results for confirmation before proceeding.
- Speak Romanian by default, switch to English if the user does.
- Be direct and specific. Users are professionals preparing real applications.

## Current Phase Guidance
${PHASE_GUIDANCE[session.currentPhase]}
`
}

/**
 * Volatile per-turn session state. Delivered to the model as a role:'system'
 * message so the native Anthropic translator hoists it to an additional,
 * uncached, top-level system block after the cached req.system prefix.
 *
 * This preserves the exact content the model saw pre-split; only the delivery
 * mechanism changes (single cached block → cached prefix + uncached state block).
 */
export function buildSessionStateBlock(session: AgentSession, sections: AgentSection[]): string {
  const bp = session.blueprint as CallBlueprint | null

  const knowledgeSummary = (session as SessionWithKnowledgeSummary)._knowledgeSummary
  const knowledgeLine = knowledgeSummary
    ? `- Session knowledge: ${knowledgeSummary}`
    : '- Session knowledge: none yet'

  return `## Current Session State
- Phase: ${session.currentPhase}
- Selected call: ${bp?.callId ?? session.selectedCallId ?? 'none yet'}
- Structure confidence: ${bp?.structureConfidence != null ? `${Math.round(bp.structureConfidence * 100)}%` : 'N/A'}
- Eligibility: ${formatEligibility(session.eligibility)}
${knowledgeLine}
- Sections:
${formatSections(sections)}
- Active warnings:
${formatWarnings(session.warnings)}
`
}

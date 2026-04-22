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
  discovery: 'Help the user describe their project and organization. Ask about sector, region, budget range, timeline. When ready, search for matching calls.',
  research: 'Search for matching calls. When the user selects one, resolve it and present the blueprint. Run eligibility checks.',
  structuring: 'Extract and present the required application structure. Show the outline for approval. Address any eligibility issues.',
  drafting: 'Generate sections one at a time in generation order. After each, offer: accept, regenerate with feedback, or skip. Show progress.',
  review: 'Validate the full application. Show missing items, warnings, annexes checklist. Guide toward completion.',
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

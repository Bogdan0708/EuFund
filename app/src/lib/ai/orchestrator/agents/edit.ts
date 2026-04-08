import type { AgentFn, SectionResult } from '../types'
import { getEditPrompt } from '../prompts/edit'
import { parseAIJson } from '../utils'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { createHash } from 'crypto'
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

/**
 * Parse which section the user wants to edit from their message.
 * Handles patterns like:
 *   "Regenerate section: Grup țintă"
 *   "Improve section: Metodologie și activități"
 *   "Rewrite the budget section"
 */
function findTargetSection(input: string, sections: SectionResult[]): SectionResult | null {
  // Try exact match from "Regenerate/Improve section: <title>"
  const match = input.match(/(?:Regenerate|Improve|Rewrite|Edit)\s+section:\s*(.+)/i)
  if (match) {
    const requestedTitle = match[1].trim().toLowerCase()
    const found = sections.find(s => s.title.toLowerCase() === requestedTitle)
    if (found) return found
  }

  // Fuzzy: find any section title mentioned in the input
  const inputLower = input.toLowerCase()
  for (const s of sections) {
    if (inputLower.includes(s.title.toLowerCase())) return s
  }

  return null
}

export const editAgent: AgentFn = async (ctx, input, stream, gateway) => {
  if (!ctx.projectSections) {
    throw new Error('No project sections to edit')
  }

  stream.send({ type: 'step_progress', step: 7, message: 'Editing your project...' })

  const { provider, model } = resolveAgentModel({ task: 'editing', ctx: ctx.routingCtx })
  const startedAt = Date.now()

  // Find the specific section to edit — only send that section + brief context
  const targetSection = findTargetSection(input, ctx.projectSections)

  let userMessage: string
  if (targetSection) {
    // Send only the target section + a summary of adjacent sections for context
    const adjacentSummaries = ctx.projectSections
      .filter(s => s.id !== targetSection.id && s.source !== 'failed')
      .map(s => `- ${s.title} (order ${s.order}): ${s.content.slice(0, 150)}...`)
      .join('\n')

    userMessage = [
      `Section to edit (order ${targetSection.order}):`,
      `Title: ${targetSection.title}`,
      `Content:\n${targetSection.content}`,
      '',
      `Other sections (for context only, do not edit):`,
      adjacentSummaries,
      '',
      `Edit request: ${input}`,
    ].join('\n')
  } else {
    // Fallback: send compact version of all sections
    userMessage = `Current sections:\n${ctx.projectSections.map(s =>
      `[Order ${s.order}] ${s.title}:\n${s.content.slice(0, 500)}${s.content.length > 500 ? '...' : ''}`
    ).join('\n\n')}\n\nEdit request: ${input}`
  }

  const result = await gateway.generate({
    provider,
    model,
    system: getEditPrompt(ctx),
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0.3,
    maxTokens: 8_000,
  })

  let editedSections: { order: number; title?: string; content?: string }[]
  try {
    const parsed = parseAIJson<{ order: number; title?: string; content?: string } | { order: number; title?: string; content?: string }[]>(result.content)
    // Handle both single object and array responses
    editedSections = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    throw new Error('Failed to parse edited sections')
  }

  const editedCount = Math.max(editedSections.length, 1)
  const now = new Date().toISOString()
  const latencyMs = Date.now() - startedAt
  const tokensIn = Math.round((result.tokensUsed * 0.7) / editedCount)
  const tokensOut = Math.round((result.tokensUsed * 0.3) / editedCount)

  // Merge edited sections into existing ones
  const updatedSections = ctx.projectSections.map(s => {
    const edited = editedSections.find((e: { order: number; title?: string; content?: string }) => e.order === s.order)
    if (!edited) return s

    const nextTitle = edited.title ?? s.title
    const nextContent = normalizeMarkdown(edited.content ?? s.content)
    if (nextTitle === s.title && nextContent === s.content) {
      return s
    }

    const checksum = createHash('sha256').update(nextContent).digest('hex').slice(0, 16)

    return {
      ...s,
      title: nextTitle,
      content: nextContent,
      source: 'edited' as const,
      contentHash: createHash('sha256').update(nextContent).digest('hex'),
      metadata: {
        model,
        provider,
        tokensIn,
        tokensOut,
        latencyMs,
        retryCount: 0,
        fallbackUsed: false,
        generatedAt: now,
        checksum,
      },
    }
  })

  for (const section of editedSections.filter((edited: { order: number; title?: string; content?: string }) => {
    const current = ctx?.projectSections?.find((existing) => existing.order === edited.order)
    if (!current) return true
    return (edited.title ?? current.title) !== current.title || (edited.content ?? current.content) !== current.content
  })) {
    stream.send({ type: 'ai_chunk', step: 7, content: `Updated: **${section.title}**\n\n${section.content}\n\n---\n` })
  }

  return { data: { projectSections: updatedSections }, checkpoint: null, tokensUsed: result.tokensUsed }
}

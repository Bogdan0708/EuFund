import type { AgentFn } from '../types'
import { getEditPrompt } from '../prompts/edit'
import { parseAIJson } from '../utils'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { createHash } from 'crypto'

export const editAgent: AgentFn = async (ctx, input, stream, gateway) => {
  if (!ctx.projectSections) {
    throw new Error('No project sections to edit')
  }

  stream.send({ type: 'step_progress', step: 7, message: 'Editing your project...' })

  const { provider, model } = resolveAgentModel({ task: 'editing', ctx: ctx.routingCtx })
  const startedAt = Date.now()

  const result = await gateway.generate({
    provider,
    model,
    system: getEditPrompt(ctx),
    messages: [{ role: 'user', content: `Current sections:\n${JSON.stringify(ctx.projectSections)}\n\nEdit request: ${input}` }],
    temperature: 0.3,
    maxTokens: 20_000,
  })

  let editedSections
  try {
    editedSections = parseAIJson<{ order: number; title?: string; content?: string }[]>(result.content)
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
    const nextContent = edited.content ?? s.content
    if (nextTitle === s.title && nextContent === s.content) {
      return s
    }

    const checksum = createHash('sha256').update(nextContent).digest('hex').slice(0, 16)

    return {
      ...s,
      ...edited,
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

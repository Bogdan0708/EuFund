import type { AgentFn } from '../types'
import { getEditPrompt } from '../prompts/edit'

export const editAgent: AgentFn = async (ctx, input, stream, gateway) => {
  if (!ctx.projectSections) {
    throw new Error('No project sections to edit')
  }

  stream.send({ type: 'step_progress', step: 7, message: 'Editing your project...' })

  const model = (ctx.tier === 'pro' || ctx.tier === 'ultra') ? 'claude-sonnet-4-6' : 'gemini-2.5-flash-preview'
  const provider = (ctx.tier === 'pro' || ctx.tier === 'ultra') ? 'claude' : 'gemini'

  const result = await gateway.generate({
    provider,
    model,
    system: getEditPrompt(ctx),
    messages: [{ role: 'user', content: `Current sections:\n${JSON.stringify(ctx.projectSections)}\n\nEdit request: ${input}` }],
    temperature: 0.3,
    maxTokens: 4000,
  })

  let editedSections
  try {
    editedSections = JSON.parse(result.content)
  } catch {
    throw new Error('Failed to parse edited sections')
  }

  // Merge edited sections into existing ones
  const updatedSections = ctx.projectSections.map(s => {
    const edited = editedSections.find((e: { order: number; title?: string; content?: string }) => e.order === s.order)
    return edited ? { ...s, ...edited, source: 'edited' as const } : s
  })

  for (const section of editedSections) {
    stream.send({ type: 'ai_chunk', step: 7, content: `Updated: **${section.title}**\n\n${section.content}\n\n---\n` })
  }

  return { data: { projectSections: updatedSections }, checkpoint: null, tokensUsed: result.tokensUsed }
}

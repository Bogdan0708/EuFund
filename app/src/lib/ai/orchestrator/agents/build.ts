import type { AgentFn, SectionResult } from '../types'
import { getBuildPrompt } from '../prompts/build'
import { parseAIJson } from '../utils'

export const buildAgent: AgentFn = async (ctx, _input, stream, gateway) => {
  if (!ctx.actionPlan || !ctx.enhancedIdea) {
    throw new Error('Action plan and enhanced idea required for building')
  }

  stream.send({ type: 'step_progress', step: 7, message: 'Building your project proposal...' })

  const provider = 'claude'
  const model = 'claude-sonnet-4-6'

  const result = await gateway.generate({
    provider,
    model,
    system: getBuildPrompt(ctx),
    messages: [{ role: 'user', content: `Build the complete project proposal for:\n\nProject: ${JSON.stringify(ctx.enhancedIdea)}\n\nAction Plan: ${JSON.stringify(ctx.actionPlan)}\n\nBlueprint: ${JSON.stringify(ctx.callBlueprint)}` }],
    temperature: 0.4,
    maxTokens: 32000,
  })

  let projectSections: SectionResult[]
  try {
    const parsed = parseAIJson<unknown>(result.content)
    // Normalize: might be array or { sections: [...] }
    if (Array.isArray(parsed)) {
      projectSections = parsed
    } else if (parsed && typeof parsed === 'object') {
      const arr = Object.values(parsed as Record<string, unknown>).find(v => Array.isArray(v))
      projectSections = Array.isArray(arr) ? arr as SectionResult[] : []
    } else {
      projectSections = []
    }
  } catch {
    // Last resort: wrap raw content as a single section
    const now = new Date().toISOString()
    projectSections = [{
      id: 'fallback-1',
      title: 'Generated Proposal',
      content: result.content,
      order: 1,
      source: 'generated',
      metadata: { model, provider, tokensIn: 0, tokensOut: result.tokensUsed, latencyMs: 0, retryCount: 0, fallbackUsed: true, generatedAt: now, checksum: '' },
    }]
  }

  // Stream each section to the user
  for (const section of projectSections) {
    stream.send({ type: 'ai_chunk', step: 7, content: `## ${section.title}\n\n${section.content}\n\n---\n` })
  }

  return {
    data: { projectSections },
    checkpoint: null,
    tokensUsed: result.tokensUsed,
  }
}

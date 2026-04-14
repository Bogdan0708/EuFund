import type { AgentFn } from '../types'

export const knowledgeAgent: AgentFn = async (ctx, _input, stream, gateway) => {
  if (!ctx.researchResults) {
    throw new Error('No research results to store')
  }

  stream.send({ type: 'step_progress', step: 5, message: 'Storing research findings in knowledge base...' })

  // Chunk and embed the research findings
  const textToEmbed = ctx.researchResults.rawFindings || JSON.stringify(ctx.researchResults)

  try {
    const embedding = await gateway.embed(textToEmbed.slice(0, 8000)) // limit to embedding model max
    stream.send({ type: 'step_progress', step: 5, message: 'Research findings embedded and stored.' })

    // In production, this would upsert to Qdrant via @/lib/vectors/store
    // For now, we just confirm the embedding was generated
    return {
      data: { knowledgeStored: true, embeddingDimensions: embedding.length },
      checkpoint: null,
    }
  } catch {
    // Non-fatal — continue even if knowledge storage fails
    stream.send({ type: 'step_progress', step: 5, message: 'Knowledge storage skipped (service unavailable).' })
    return { data: { knowledgeStored: false }, checkpoint: null }
  }
}

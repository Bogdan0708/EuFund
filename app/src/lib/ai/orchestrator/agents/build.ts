import type { AgentFn, SectionResult, SectionSpec, CallBlueprint } from '../types'
import { getBuildSectionPrompt } from '../prompts/build-section'
import { buildSectionSpecs } from '../section-specs'
import { parseAIJson } from '../utils'
import { resolveAgentModel } from '@/lib/ai/model-routing'
import { MODEL_CONFIGS } from '@/lib/ai/providers/types'
import { createHash } from 'crypto'
import { logger } from '@/lib/logger'
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

const log = logger.child({ component: 'build-agent' })

const BUILD_LOOP_TIMEOUT_MS = 20 * 60 * 1000 // 20 minutes

export const buildAgent: AgentFn = async (ctx, _input, stream, gateway) => {
  if (!ctx.actionPlan || !ctx.enhancedIdea) {
    throw new Error('Action plan and enhanced idea required for building')
  }

  const specs = buildSectionSpecs(
    (ctx.callBlueprint || { normalized: { requiredSections: [], mandatoryAnnexes: [], eligibilityCriteria: [], evaluationGrid: [], cofinancingRate: 0 } } as unknown as CallBlueprint)
  )

  const totalSections = specs.length
  stream.send({ type: 'step_progress', step: 5, message: `Building ${totalSections} sections...` })

  const sections: SectionResult[] = []
  const loopStart = Date.now()

  for (let i = 0; i < specs.length; i++) {
    if (Date.now() - loopStart > BUILD_LOOP_TIMEOUT_MS) {
      log.warn({ elapsed: Date.now() - loopStart, completed: i, total: totalSections }, 'Build loop timeout')
      for (let j = i; j < specs.length; j++) {
        sections.push(makeFailedSection(specs[j], ctx.userId))
      }
      break
    }

    const spec = specs[i]
    stream.send({ type: 'step_progress', step: 5, message: `Writing section ${i + 1}/${totalSections}: ${spec.title}...` })

    // Map modelHint to section importance for routing
    const importance = spec.modelHint === 'heavy' ? 'critical' as const : 'standard' as const
    const resolved = resolveAgentModel({ task: 'section_generation', importance, ctx: ctx.routingCtx })
    const startMs = Date.now()

    let section: SectionResult | null = null
    let retryCount = 0
    let fallbackUsed = false

    // Attempt 1: primary model from routing policy
    try {
      section = await generateSection(ctx, spec, sections, resolved.provider, resolved.model, gateway)
    } catch (err) {
      log.warn({ section: spec.title, provider: resolved.provider, model: resolved.model, error: err instanceof Error ? err.message : String(err) }, 'Section generation failed')
      retryCount = 1

      // Attempt 2: fallback from MODEL_CONFIGS
      const fallback = MODEL_CONFIGS[resolved.model]?.fallback
      if (fallback) {
        try {
          section = await generateSection(ctx, spec, sections, fallback.provider, fallback.model, gateway)
          fallbackUsed = true
        } catch (fbErr) {
          log.error({ section: spec.title, error: fbErr instanceof Error ? fbErr.message : String(fbErr) }, 'Section fallback also failed')
        }
      }
    }

    const latencyMs = Date.now() - startMs

    if (section) {
      section.metadata.retryCount = retryCount
      section.metadata.fallbackUsed = fallbackUsed
      section.metadata.latencyMs = latencyMs
      sections.push(section)
      stream.send({ type: 'ai_chunk', step: 5, content: `## ${section.title}\n\n${section.content.slice(0, 200)}...\n\n---\n` })
    } else {
      sections.push(makeFailedSection(spec, ctx.userId))
      stream.send({ type: 'step_progress', step: 5, message: `Section "${spec.title}" failed — marked for manual editing.` })
    }
  }

  sections.sort((a, b) => a.order - b.order)

  return {
    data: { projectSections: sections },
    checkpoint: null,
    tokensUsed: sections.reduce((sum, s) => sum + (s.metadata.tokensIn + s.metadata.tokensOut), 0),
  }
}

async function generateSection(
  ctx: import('../types').WorkflowContext,
  spec: SectionSpec,
  previousSections: SectionResult[],
  provider: string,
  model: string,
  gateway: import('../types').GatewayClient,
): Promise<SectionResult> {
  const result = await gateway.generate({
    provider,
    model,
    system: getBuildSectionPrompt(ctx, spec, previousSections),
    messages: [{ role: 'user', content: `Write section "${spec.title}" for the project proposal.` }],
    temperature: 0.4,
    maxTokens: spec.expectedLength === 'long' ? 12_000 : spec.expectedLength === 'medium' ? 8_000 : 4_000,
  })

  let parsed: { title?: string; content?: string; order?: number }
  try {
    parsed = parseAIJson<{ title: string; content: string; order: number }>(result.content)
  } catch {
    parsed = { title: spec.title, content: result.content, order: spec.order }
  }

  const finalContent = normalizeMarkdown(parsed.content || result.content)
  const fullHash = createHash('sha256').update(finalContent).digest('hex')

  return {
    id: spec.id,
    title: parsed.title || spec.title,
    content: finalContent,
    order: parsed.order || spec.order,
    source: 'generated',
    state: 'draft',
    currentVersion: 1,
    versionCount: 1,
    contentHash: fullHash,
    lastStateChangeAt: new Date().toISOString(),
    lastStateChangeBy: ctx.userId,
    metadata: {
      model,
      provider,
      tokensIn: Math.round(result.tokensUsed * 0.7),
      tokensOut: Math.round(result.tokensUsed * 0.3),
      latencyMs: 0,
      retryCount: 0,
      fallbackUsed: false,
      generatedAt: new Date().toISOString(),
      checksum: fullHash.slice(0, 16),
    },
  }
}

function makeFailedSection(spec: SectionSpec, userId: string): SectionResult {
  const content = '[Generarea acestei sectiuni a esuat. Editati manual sau regenerati din meniul de editare.]'
  const fullHash = createHash('sha256').update(content).digest('hex')
  return {
    id: spec.id,
    title: spec.title,
    content,
    order: spec.order,
    source: 'failed',
    state: 'draft',
    currentVersion: 1,
    versionCount: 1,
    contentHash: fullHash,
    lastStateChangeAt: new Date().toISOString(),
    lastStateChangeBy: userId,
    metadata: {
      model: 'none', provider: 'none',
      tokensIn: 0, tokensOut: 0, latencyMs: 0,
      retryCount: 0, fallbackUsed: false,
      generatedAt: new Date().toISOString(), checksum: '',
    },
  }
}

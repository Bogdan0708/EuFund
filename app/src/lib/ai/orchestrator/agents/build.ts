import type { AgentFn, SectionResult, SectionSpec, CallBlueprint } from '../types'
import { getBuildSectionPrompt } from '../prompts/build-section'
import { buildSectionSpecs } from '../section-specs'
import { parseAIJson } from '../utils'
import { createHash } from 'crypto'
import { logger } from '@/lib/logger'

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
        sections.push(makeFailedSection(specs[j]))
      }
      break
    }

    const spec = specs[i]
    stream.send({ type: 'step_progress', step: 5, message: `Writing section ${i + 1}/${totalSections}: ${spec.title}...` })

    const provider = spec.modelHint === 'heavy' ? 'anthropic' : 'openai'
    const model = spec.modelHint === 'heavy' ? 'claude-opus-4-6' : 'gpt-5.4'
    const startMs = Date.now()

    let section: SectionResult | null = null
    let retryCount = 0
    let fallbackUsed = false

    // Attempt 1: primary model
    try {
      section = await generateSection(ctx, spec, sections, provider, model, gateway)
    } catch (err) {
      log.warn({ section: spec.title, provider, model, error: err instanceof Error ? err.message : String(err) }, 'Section generation failed')
      retryCount = 1

      // Attempt 2: fallback model
      const fbProvider = spec.modelHint === 'heavy' ? 'openai' : 'anthropic'
      const fbModel = spec.modelHint === 'heavy' ? 'gpt-5.4' : 'claude-sonnet-4-6'
      try {
        section = await generateSection(ctx, spec, sections, fbProvider, fbModel, gateway)
        fallbackUsed = true
      } catch (fbErr) {
        log.error({ section: spec.title, error: fbErr instanceof Error ? fbErr.message : String(fbErr) }, 'Section fallback also failed')
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
      sections.push(makeFailedSection(spec))
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
    maxTokens: spec.expectedLength === 'long' ? 6000 : spec.expectedLength === 'medium' ? 4000 : 2000,
  })

  let parsed: { title?: string; content?: string; order?: number }
  try {
    parsed = parseAIJson<{ title: string; content: string; order: number }>(result.content)
  } catch {
    parsed = { title: spec.title, content: result.content, order: spec.order }
  }

  return {
    id: spec.id,
    title: parsed.title || spec.title,
    content: parsed.content || result.content,
    order: parsed.order || spec.order,
    source: 'generated',
    state: 'draft',
    currentVersion: 1,
    versionCount: 1,
    contentHash: '',
    lastStateChangeAt: new Date().toISOString(),
    lastStateChangeBy: null,
    metadata: {
      model,
      provider,
      tokensIn: Math.round(result.tokensUsed * 0.7),
      tokensOut: Math.round(result.tokensUsed * 0.3),
      latencyMs: 0,
      retryCount: 0,
      fallbackUsed: false,
      generatedAt: new Date().toISOString(),
      checksum: createHash('sha256').update(parsed.content || result.content).digest('hex').slice(0, 16),
    },
  }
}

function makeFailedSection(spec: SectionSpec): SectionResult {
  return {
    id: spec.id,
    title: spec.title,
    content: '[Generarea acestei sectiuni a esuat. Editati manual sau regenerati din meniul de editare.]',
    order: spec.order,
    source: 'failed',
    state: 'draft',
    currentVersion: 1,
    versionCount: 1,
    contentHash: '',
    lastStateChangeAt: new Date().toISOString(),
    lastStateChangeBy: null,
    metadata: {
      model: 'none', provider: 'none',
      tokensIn: 0, tokensOut: 0, latencyMs: 0,
      retryCount: 0, fallbackUsed: false,
      generatedAt: new Date().toISOString(), checksum: '',
    },
  }
}

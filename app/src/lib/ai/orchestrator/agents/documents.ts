import type { SubmissionDocument, GatewayClient } from '../types'
import { GENERAL_REQUIREMENTS } from '@/lib/compliance/general-requirements'
import { FORM_TEMPLATES, type FormTemplate } from '@/lib/compliance/form-templates'
import { interpolate, makeDocumentId } from '@/lib/compliance/interpolate'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'document-generation' })

export interface ProjectContext {
  orgName: string
  cui: string
  orgAddress: string
  representativeName: string
  representativeRole: string
  projectTitle: string
  programName: string
  date: string
}

export interface GenerateOptions {
  mandatoryAnnexes: string[]
  projectContext: ProjectContext
  gateway: GatewayClient
}

function templateToDocument(
  template: FormTemplate,
  context: ProjectContext,
  order: number,
  requirementSource: 'curated_list' | 'ai_classified',
  annexText?: string,
): SubmissionDocument {
  const content = interpolate(template.bodyTemplate, context as unknown as Record<string, string>)
  return {
    id: makeDocumentId(template.scope, template.title),
    title: template.title,
    content,
    category: template.category,
    scope: template.scope,
    order,
    availability: template.availability,
    instructions: template.instructions,
    sourceAnnex: annexText ?? '',
    userStatus: 'not_started',
    userStatusAt: null,
    provenance: {
      requirementSource,
      contentSource: 'template',
      templateId: template.templateId,
      templateVersion: template.version,
      classifiedFrom: annexText,
      reviewRequired: false,
      generatedAt: new Date().toISOString(),
    },
  }
}

function findMatchingTemplate(annexText: string): FormTemplate | undefined {
  return FORM_TEMPLATES.find(t => t.matchesAnnex?.test(annexText))
}

interface AiClassifiedAnnex {
  annexText: string
  title: string
  category: SubmissionDocument['category']
  availability: 'generated' | 'needs_fill' | 'external_required'
  instructions: string
  confidence: number
}

async function classifyUnmatchedAnnexes(
  annexes: string[],
  gateway: GatewayClient,
): Promise<AiClassifiedAnnex[]> {
  if (annexes.length === 0) return []

  const prompt = `Classify these mandatory annexes from a Romanian EU funding call. For each, determine:
- title: a clear Romanian title for the document
- category: one of "declaration", "certificate", "annex", "form"
- availability: "needs_fill" if the applicant can write it themselves, "external_required" if they must obtain it from an institution
- instructions: brief Romanian instructions for the applicant
- confidence: 0-1 how confident you are in this classification

Annexes to classify:
${annexes.map((a, i) => `${i + 1}. "${a}"`).join('\n')}

Return a JSON array of objects with fields: annexText, title, category, availability, instructions, confidence`

  try {
    const result = await gateway.generate({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      system: 'You classify Romanian EU funding documents. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 2000,
    })
    return JSON.parse(result.content)
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, 'AI annex classification failed')
    return annexes.map(a => ({
      annexText: a,
      title: a,
      category: 'annex' as const,
      availability: 'external_required' as const,
      instructions: 'Verificați ghidul solicitantului pentru detalii.',
      confidence: 0,
    }))
  }
}

export async function generateSubmissionDocuments(opts: GenerateOptions): Promise<SubmissionDocument[]> {
  const { mandatoryAnnexes, projectContext, gateway } = opts
  const documents: SubmissionDocument[] = []
  let order = 1

  // 1. General requirements — always from templates
  const templateMap = new Map(FORM_TEMPLATES.map(t => [t.templateId, t]))
  for (const req of GENERAL_REQUIREMENTS) {
    const template = templateMap.get(req.templateId)
    if (!template) {
      log.warn({ templateId: req.templateId }, 'General requirement references missing template')
      continue
    }
    documents.push(templateToDocument(template, projectContext, order++, 'curated_list'))
  }

  // 2. Call-specific requirements — try template match first, then AI classify
  const matched: SubmissionDocument[] = []
  const unmatched: string[] = []

  for (const annex of mandatoryAnnexes) {
    const template = findMatchingTemplate(annex)
    if (template) {
      matched.push(templateToDocument(template, projectContext, order++, 'ai_classified', annex))
    } else {
      unmatched.push(annex)
    }
  }

  documents.push(...matched)

  // 3. AI-classify unmatched annexes
  if (unmatched.length > 0) {
    const classified = await classifyUnmatchedAnnexes(unmatched, gateway)
    for (const item of classified) {
      const reviewRequired = item.confidence < 0.7
      documents.push({
        id: makeDocumentId('call_specific', item.title),
        title: item.title,
        content: '',
        category: item.category,
        scope: 'call_specific',
        order: order++,
        availability: item.availability,
        instructions: item.instructions,
        sourceAnnex: item.annexText,
        userStatus: 'not_started',
        userStatusAt: null,
        provenance: {
          requirementSource: 'ai_classified',
          contentSource: 'none',
          classifiedFrom: item.annexText,
          confidence: item.confidence,
          reviewRequired,
          generatedAt: new Date().toISOString(),
        },
      })
    }
  }

  return documents
}

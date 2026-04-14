import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('generateSubmissionDocuments', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('produces general requirement documents from templates', async () => {
    const gateway = { generate: vi.fn(), embed: vi.fn() }

    const { generateSubmissionDocuments } = await import('@/lib/ai/orchestrator/agents/documents')
    const result = await generateSubmissionDocuments({
      mandatoryAnnexes: [],
      projectContext: {
        orgName: 'SC Test SRL',
        cui: 'RO12345678',
        orgAddress: 'Str. Test 1, București',
        representativeName: 'Ion Popescu',
        representativeRole: 'Administrator',
        projectTitle: 'Proiect Digitalizare',
        programName: 'POCIDIF',
        date: '2026-04-06',
      },
      gateway,
    })

    expect(result.length).toBeGreaterThanOrEqual(4)
    const gdpr = result.find(d => d.id.includes('declaratie-privind-prelucrarea'))
    expect(gdpr).toBeDefined()
    expect(gdpr!.scope).toBe('general')
    expect(gdpr!.provenance.requirementSource).toBe('curated_list')
    expect(gdpr!.provenance.contentSource).toBe('template')
    expect(gdpr!.provenance.templateId).toBe('tpl-declaratie-gdpr')
    expect(gdpr!.provenance.templateVersion).toBe('2024-Q1')
    expect(gdpr!.content).toContain('SC Test SRL')
    expect(gdpr!.content).toContain('RO12345678')
    expect(gateway.generate).not.toHaveBeenCalled()
  })

  it('matches call-specific annexes to templates', async () => {
    const gateway = { generate: vi.fn(), embed: vi.fn() }

    const { generateSubmissionDocuments } = await import('@/lib/ai/orchestrator/agents/documents')
    const result = await generateSubmissionDocuments({
      mandatoryAnnexes: ['Declarație de minimis', 'Declarație ANI conflict interese'],
      projectContext: {
        orgName: 'SC Test SRL', cui: 'RO12345678', orgAddress: 'București',
        representativeName: 'Ion', representativeRole: 'Admin',
        projectTitle: 'Test', programName: 'PEO', date: '2026-04-06',
      },
      gateway,
    })

    const minimis = result.find(d => d.id.includes('minimis'))
    expect(minimis).toBeDefined()
    expect(minimis!.scope).toBe('call_specific')
    expect(minimis!.provenance.contentSource).toBe('template')
    expect(minimis!.provenance.reviewRequired).toBe(false)
    expect(gateway.generate).not.toHaveBeenCalled()
  })

  it('uses AI classification for unmatched annexes', async () => {
    const gateway = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify([{
          annexText: 'Plan de comunicare',
          title: 'Plan de comunicare și vizibilitate',
          category: 'annex',
          availability: 'external_required',
          instructions: 'Elaborați un plan de comunicare conform ghidului',
          confidence: 0.6,
        }]),
        tokensUsed: 200,
      }),
      embed: vi.fn(),
    }

    const { generateSubmissionDocuments } = await import('@/lib/ai/orchestrator/agents/documents')
    const result = await generateSubmissionDocuments({
      mandatoryAnnexes: ['Plan de comunicare'],
      projectContext: {
        orgName: 'SC Test SRL', cui: 'RO12345678', orgAddress: 'București',
        representativeName: 'Ion', representativeRole: 'Admin',
        projectTitle: 'Test', programName: 'PEO', date: '2026-04-06',
      },
      gateway,
    })

    const comm = result.find(d => d.title === 'Plan de comunicare și vizibilitate')
    expect(comm).toBeDefined()
    expect(comm!.provenance.requirementSource).toBe('ai_classified')
    expect(comm!.provenance.contentSource).toBe('none')
    expect(comm!.provenance.confidence).toBe(0.6)
    expect(comm!.provenance.reviewRequired).toBe(true)
    expect(comm!.availability).toBe('external_required')
    expect(gateway.generate).toHaveBeenCalledTimes(1)
  })

  it('assigns deterministic IDs', async () => {
    const gateway = { generate: vi.fn(), embed: vi.fn() }
    const { generateSubmissionDocuments } = await import('@/lib/ai/orchestrator/agents/documents')

    const ctx = {
      orgName: 'X', cui: 'Y', orgAddress: 'Z',
      representativeName: 'A', representativeRole: 'B',
      projectTitle: 'C', programName: 'D', date: '2026-01-01',
    }

    const run1 = await generateSubmissionDocuments({ mandatoryAnnexes: [], projectContext: ctx, gateway })
    const run2 = await generateSubmissionDocuments({ mandatoryAnnexes: [], projectContext: ctx, gateway })

    expect(run1.map(d => d.id)).toEqual(run2.map(d => d.id))
  })
})

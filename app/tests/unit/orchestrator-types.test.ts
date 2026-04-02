import { describe, it, expect } from 'vitest'
import type {
  WorkflowContext,
  AgentResult,
  SSEEvent,
  AgentFn,
  CallBlueprint,
  SectionSpec,
  SectionResult,
  QAResult,
  ProjectCompletionStatus,
} from '@/lib/ai/orchestrator/types'

describe('Orchestrator V2 types', () => {
  it('WorkflowContext has required V2 fields', () => {
    const ctx: WorkflowContext = {
      sessionId: '123',
      userId: '456',
      locale: 'ro',
      tier: 'plus',
      step: 1,
      enhancedIdea: null,
      matchedCalls: null,
      selectedCallId: null,
      callBlueprint: null,
      actionPlan: null,
      projectSections: null,
      uploadedFiles: [],
    }
    expect(ctx.sessionId).toBe('123')
    expect(ctx.callBlueprint).toBeNull()
  })

  it('WorkflowContext does NOT have validationResults or researchResults', () => {
    const ctx: WorkflowContext = {
      sessionId: '123',
      userId: '456',
      locale: 'ro',
      tier: 'plus',
      step: 1,
      enhancedIdea: null,
      matchedCalls: null,
      selectedCallId: null,
      callBlueprint: null,
      actionPlan: null,
      projectSections: null,
      uploadedFiles: [],
    }
    expect('validationResults' in ctx).toBe(false)
    expect('researchResults' in ctx).toBe(false)
  })

  it('CallBlueprint has required fields', () => {
    const bp: CallBlueprint = {
      callId: 'call-1',
      program: 'PNRR',
      isOpen: true,
      amendments: [],
      warnings: [],
      requiredSections: [{ title: 'Summary', description: 'Project summary' }],
      mandatoryAnnexes: ['Annex A'],
      eligibilityCriteria: ['Legal entity'],
      evaluationGrid: [{ criterion: 'Innovation', maxPoints: 30 }],
      cofinancingRate: 0.85,
      eligibilityResult: {
        score: 90,
        passCount: 5,
        failCount: 0,
        failures: [],
        warnings: [],
      },
      sources: ['https://example.com'],
      verifiedAt: '2026-04-02T00:00:00Z',
      raw: {
        notebookLmResponse: 'raw notebooklm text',
        perplexityResponse: 'raw perplexity text',
        retrievedAt: '2026-04-02T00:00:00Z',
      },
      normalized: {
        requiredSections: [],
        mandatoryAnnexes: [],
        eligibilityCriteria: [],
        evaluationGrid: [],
        cofinancingRate: 0.85,
      },
      structureConfidence: 0.92,
    }
    expect(bp.callId).toBe('call-1')
    expect(bp.isOpen).toBe(true)
    expect(bp.structureConfidence).toBe(0.92)
  })

  it('SectionSpec has required fields including importance and modelHint', () => {
    const spec: SectionSpec = {
      id: 'sec-1',
      title: 'Rezumat',
      description: 'Project summary section',
      order: 1,
      generationOrder: 1,
      importance: 'critical',
      expectedLength: 'medium',
      dependsOn: [],
      modelHint: 'heavy',
      mandatory: true,
      confidence: 0.95,
    }
    expect(spec.importance).toBe('critical')
    expect(spec.modelHint).toBe('heavy')
    expect(spec.mandatory).toBe(true)
  })

  it('SectionResult has metadata with model and provider', () => {
    const result: SectionResult = {
      id: 'sec-1',
      title: 'Rezumat',
      content: 'Project summary content here',
      order: 1,
      source: 'generated',
      metadata: {
        model: 'claude-sonnet-4-6',
        provider: 'claude',
        tokensIn: 500,
        tokensOut: 1200,
        latencyMs: 3200,
        retryCount: 0,
        fallbackUsed: false,
        generatedAt: '2026-04-02T00:00:00Z',
        checksum: 'abc123',
      },
    }
    expect(result.source).toBe('generated')
    expect(result.metadata.provider).toBe('claude')
    expect(result.metadata.fallbackUsed).toBe(false)
  })

  it('SectionResult source can be failed', () => {
    const result: SectionResult = {
      id: 'sec-2',
      title: 'Failed Section',
      content: '',
      order: 2,
      source: 'failed',
      metadata: {
        model: 'gpt-4o',
        provider: 'openai',
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        retryCount: 3,
        fallbackUsed: true,
        generatedAt: '2026-04-02T00:00:00Z',
        checksum: '',
      },
    }
    expect(result.source).toBe('failed')
    expect(result.metadata.retryCount).toBe(3)
  })

  it('QAResult has required fields', () => {
    const qa: QAResult = {
      passed: true,
      missingSections: [],
      failedSections: [],
      placeholderSections: [],
      truncatedSections: [],
      duplicateSections: [],
      budgetConsistent: true,
      warnings: [],
    }
    expect(qa.passed).toBe(true)
    expect(qa.budgetConsistent).toBe(true)
  })

  it('QAResult budgetConsistent can be null', () => {
    const qa: QAResult = {
      passed: false,
      missingSections: ['sec-3'],
      failedSections: ['sec-4'],
      placeholderSections: [],
      truncatedSections: ['sec-5'],
      duplicateSections: [],
      budgetConsistent: null,
      warnings: ['Budget section missing'],
    }
    expect(qa.budgetConsistent).toBeNull()
    expect(qa.missingSections).toHaveLength(1)
  })

  it('ProjectCompletionStatus accepts valid values', () => {
    const statuses: ProjectCompletionStatus[] = ['complete', 'complete_with_gaps', 'needs_review', 'blocked']
    expect(statuses).toHaveLength(4)
  })

  it('AgentFn type is callable', () => {
    const fn: AgentFn = async (ctx, input, stream, gateway) => ({
      data: {},
      checkpoint: null,
    })
    expect(typeof fn).toBe('function')
  })

  it('done SSEEvent accepts completionStatus', () => {
    const event: SSEEvent = {
      eventId: 1,
      type: 'done',
      projectId: 'proj-123',
      completionStatus: 'complete_with_gaps',
    }
    expect(event.type).toBe('done')
    if (event.type === 'done') {
      expect(event.completionStatus).toBe('complete_with_gaps')
    }
  })
})

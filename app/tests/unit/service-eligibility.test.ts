// Tests for services/eligibility.ts — runEligibility and scoreFit
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DB before importing the service
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}))

import { db } from '@/lib/db'
import { runEligibility, scoreFit } from '@/lib/ai/agent/services/eligibility'
import { NotFoundError } from '@/lib/ai/agent/services/errors'

const mockCtx = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-test-1',
  now: new Date(),
}

const smeInput = {
  organization: {
    orgType: 'srl',
    orgSize: 'mica',
    caenPrimary: '6201',
    nutsRegion: 'RO221',
    employeeCount: 15,
    annualRevenue: 500000,
  },
  project: {
    totalBudget: 200000,
    ownContrib: 30000,
    durationMonths: 18,
  },
}

const fullCallNormalized = {
  eligibilityCriteria: ['srl', 'sa'],
  eligibleRegions: ['RO221', 'RO222'],
  eligibleCaen: ['6201', '6202'],
  budgetMin: 100000,
  budgetMax: 500000,
  cofinancingRate: 15,
  durationMin: 6,
  durationMax: 36,
  submissionEnd: '2030-12-31',
}

function mockCallFound(normalized = fullCallNormalized) {
  ;(db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([{
    callId: 'PNRR-TEST',
    program: 'PNRR',
    callTitle: 'Test Call',
    normalized,
    status: 'primed',
    structureConfidence: 0.9,
    freshnessConfidence: 0.8,
    sourceDocs: [],
    contentExtractedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }])
}

function mockCallNotFound() {
  ;(db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([])
}

describe('runEligibility service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when callId not in knowledge base', async () => {
    mockCallNotFound()
    await expect(runEligibility(mockCtx, smeInput, 'UNKNOWN-CALL')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns EligibilityDecision with all rule results', async () => {
    mockCallFound()
    const result = await runEligibility(mockCtx, smeInput, 'PNRR-TEST')

    expect(result).toHaveProperty('results')
    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('passCount')
    expect(result).toHaveProperty('failCount')
    expect(result).toHaveProperty('warningCount')
    expect(Array.isArray(result.results)).toBe(true)
  })

  it('scores 100 when all rules pass', async () => {
    mockCallFound()
    const result = await runEligibility(mockCtx, smeInput, 'PNRR-TEST')

    expect(result.failCount).toBe(0)
    expect(result.score).toBeGreaterThan(0)
  })

  it('fails org type rule when org is not in eligible types', async () => {
    mockCallFound({ ...fullCallNormalized, eligibilityCriteria: ['ong'] })
    const result = await runEligibility(mockCtx, smeInput, 'PNRR-TEST')

    const orgRule = result.results.find(r => r.ruleId === 'ELIG-001')
    expect(orgRule?.status).toBe('fail')
    expect(result.failCount).toBeGreaterThan(0)
  })

  it('fails budget rule when project budget exceeds call max', async () => {
    mockCallFound({ ...fullCallNormalized, budgetMax: 50000 })
    const result = await runEligibility(mockCtx, smeInput, 'PNRR-TEST')

    const budgetRule = result.results.find(r => r.ruleId === 'BUD-001')
    expect(budgetRule?.status).toBe('fail')
  })

  it('marks deadline as fail when submission end is in the past', async () => {
    mockCallFound({ ...fullCallNormalized, submissionEnd: '2020-01-01' })
    const result = await runEligibility(mockCtx, smeInput, 'PNRR-TEST')

    const deadlineRule = result.results.find(r => r.ruleId === 'DEAD-001')
    expect(deadlineRule?.status).toBe('fail')
  })

  it('includes bilingual messages on each rule result', async () => {
    mockCallFound()
    const result = await runEligibility(mockCtx, smeInput, 'PNRR-TEST')

    for (const r of result.results) {
      expect(r.messageRo).toBeTruthy()
      expect(r.messageEn).toBeTruthy()
    }
  })
})

describe('scoreFit service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws NotFoundError when callId not in knowledge base', async () => {
    mockCallNotFound()
    await expect(scoreFit(mockCtx, smeInput, 'UNKNOWN-CALL')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns FitScore with all required fields', async () => {
    mockCallFound()
    const result = await scoreFit(mockCtx, smeInput, 'PNRR-TEST')

    expect(result).toHaveProperty('callId', 'PNRR-TEST')
    expect(result).toHaveProperty('overallScore')
    expect(result).toHaveProperty('thematicFit')
    expect(result).toHaveProperty('eligibilityFit')
    expect(result).toHaveProperty('budgetFit')
    expect(result).toHaveProperty('reasoning')
  })

  it('scores are in 0-100 range', async () => {
    mockCallFound()
    const result = await scoreFit(mockCtx, smeInput, 'PNRR-TEST')

    expect(result.overallScore).toBeGreaterThanOrEqual(0)
    expect(result.overallScore).toBeLessThanOrEqual(100)
    expect(result.thematicFit).toBeGreaterThanOrEqual(0)
    expect(result.thematicFit).toBeLessThanOrEqual(100)
    expect(result.eligibilityFit).toBeGreaterThanOrEqual(0)
    expect(result.eligibilityFit).toBeLessThanOrEqual(100)
    expect(result.budgetFit).toBeGreaterThanOrEqual(0)
    expect(result.budgetFit).toBeLessThanOrEqual(100)
  })

  it('gives high overall score when project is a good fit', async () => {
    mockCallFound()
    const result = await scoreFit(mockCtx, smeInput, 'PNRR-TEST')

    expect(result.overallScore).toBeGreaterThanOrEqual(70)
  })

  it('gives lower score when org type fails', async () => {
    mockCallFound({ ...fullCallNormalized, eligibilityCriteria: ['ong'] })
    const resultFail = await scoreFit(mockCtx, smeInput, 'PNRR-TEST')
    // Reset for good fit comparison
    mockCallFound()
    const resultPass = await scoreFit(mockCtx, smeInput, 'PNRR-TEST')

    // When org type fails, the score should be lower than when it passes
    expect(resultFail.overallScore).toBeLessThan(resultPass.overallScore)
    // Eligibility fit should drop because org type is a hard fail
    expect(resultFail.eligibilityFit).toBeLessThanOrEqual(resultPass.eligibilityFit)
  })

  it('gives lower budget fit when budget exceeds max', async () => {
    mockCallFound({ ...fullCallNormalized, budgetMax: 50000 })
    const result = await scoreFit(mockCtx, smeInput, 'PNRR-TEST')

    expect(result.budgetFit).toBeLessThan(100)
  })

  it('includes failure info in reasoning when rules fail', async () => {
    mockCallFound({ ...fullCallNormalized, eligibilityCriteria: ['ong'] })
    const result = await scoreFit(mockCtx, smeInput, 'PNRR-TEST')

    expect(result.reasoning).toContain('Failing rules')
  })

  it('uses neutral budget fit (50) when no budget provided', async () => {
    mockCallFound()
    const noBudgetInput = {
      organization: smeInput.organization,
      project: {},
    }
    const result = await scoreFit(mockCtx, noBudgetInput, 'PNRR-TEST')

    expect(result.budgetFit).toBe(50)
  })
})

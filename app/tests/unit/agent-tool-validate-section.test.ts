// app/tests/unit/agent-tool-validate-section.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the sections service before importing tool
vi.mock('@/lib/ai/agent/services/sections', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ai/agent/services/sections')>()
  return {
    ...original,
    validateSection: vi.fn(),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { validateSection } from '@/lib/ai/agent/services/sections'
import '@/lib/ai/agent/tools/validate-section'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'
import { NotFoundError } from '@/lib/ai/agent/services/errors'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const mockCtx = {
  sessionId: SESSION_ID,
  userId: USER_ID,
  session: { outline: [] } as any,
  sections: [],
  stateVersion: 0,
  requestId: 'req-1',
  locale: 'ro' as const,
}

describe('validate_section tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'validate_section')).toBeDefined()
  })

  it('detects placeholder patterns', async () => {
    ;(validateSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      sectionKey: 'context',
      issues: [{ code: 'PLACEHOLDER', severity: 'error', message: 'Found placeholder text: "[TBD]"', sectionKey: 'context' }],
      score: 70,
      recommendedStatus: 'failed',
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, mockCtx)

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.issues.some((i: any) => i.code === 'PLACEHOLDER')).toBe(true)
    expect(data.score).toBeLessThan(80)
  })

  it('passes clean content with good length', async () => {
    ;(validateSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      sectionKey: 'context',
      issues: [],
      score: 100,
      recommendedStatus: 'needs_review',
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, mockCtx)

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.issues.filter((i: any) => i.severity === 'error')).toHaveLength(0)
    expect(data.score).toBeGreaterThanOrEqual(90)
  })

  it('warns on too-short content', async () => {
    ;(validateSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      sectionKey: 'context',
      issues: [{ code: 'TOO_SHORT', severity: 'warning', message: 'Content is 24 chars, expected at least 700 for medium sections', sectionKey: 'context' }],
      score: 90,
      recommendedStatus: 'needs_review',
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, mockCtx)

    const data = result.data as any
    expect(data.issues.some((i: any) => i.code === 'TOO_SHORT')).toBe(true)
  })

  it('fails when section not found', async () => {
    ;(validateSection as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('section', `${SESSION_ID}:nonexistent`),
    )
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'nonexistent' }, mockCtx)
    expect(result.success).toBe(false)
  })
})

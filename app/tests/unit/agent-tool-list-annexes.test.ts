import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the application service (checkMissingAnnexes) before importing tool
vi.mock('@/lib/ai/agent/services/application', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ai/agent/services/application')>()
  return {
    ...original,
    checkMissingAnnexes: vi.fn(),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { checkMissingAnnexes } from '@/lib/ai/agent/services/application'
import '@/lib/ai/agent/tools/list-missing-annexes'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const mockCtx = {
  sessionId: SESSION_ID,
  userId: USER_ID,
  session: { blueprint: null } as any,
  sections: [],
  stateVersion: 0,
  requestId: 'req-1',
  locale: 'ro' as const,
}

describe('list_missing_annexes tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'list_missing_annexes')).toBeDefined()
  })

  it('returns empty when no annexes required', async () => {
    ;(checkMissingAnnexes as ReturnType<typeof vi.fn>).mockResolvedValue({
      required: [],
      uploaded: [],
      missing: [],
    })
    const tool = getToolRegistry().find(t => t.name === 'list_missing_annexes')!
    const result = await tool.execute({}, mockCtx)
    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
  })

  it('detects missing annexes', async () => {
    ;(checkMissingAnnexes as ReturnType<typeof vi.fn>).mockResolvedValue({
      required: ['Anexa 1 - Buget', 'Anexa 2 - CV'],
      uploaded: ['Anexa 1 - Buget'],
      missing: ['Anexa 2 - CV'],
    })
    const tool = getToolRegistry().find(t => t.name === 'list_missing_annexes')!
    const result = await tool.execute({}, mockCtx)
    const data = result.data as any[]
    expect(data).toHaveLength(2)
    expect(data.find((a: any) => a.name === 'Anexa 1 - Buget').status).toBe('mentioned')
    expect(data.find((a: any) => a.name === 'Anexa 2 - CV').status).toBe('missing')
    expect(result.warnings).toBeDefined()
    expect(result.warnings![0]).toContain('1 mandatory')
  })

  it('returns no warnings when all annexes are mentioned', async () => {
    ;(checkMissingAnnexes as ReturnType<typeof vi.fn>).mockResolvedValue({
      required: ['Anexa 1 - Buget'],
      uploaded: ['Anexa 1 - Buget'],
      missing: [],
    })
    const tool = getToolRegistry().find(t => t.name === 'list_missing_annexes')!
    const result = await tool.execute({}, mockCtx)
    expect(result.warnings).toBeUndefined()
  })
})

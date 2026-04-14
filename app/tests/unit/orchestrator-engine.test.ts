import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}))

describe('Orchestrator Engine', () => {
  it('createSession creates a new workflow session', async () => {
    const { createSession } = await import('@/lib/ai/orchestrator/engine')
    const session = await createSession('user-123', 'ro', 'plus')
    expect(session).toBeDefined()
    expect(session.id).toBeDefined()
  })

  it('getAgentForStep returns correct agent', async () => {
    const { getAgentForStep } = await import('@/lib/ai/orchestrator/engine')
    const agent = getAgentForStep(1)
    expect(agent).toBeDefined()
    expect(typeof agent).toBe('function')
  })

  it('getAgentForStep throws for invalid step', async () => {
    const { getAgentForStep } = await import('@/lib/ai/orchestrator/engine')
    expect(() => getAgentForStep(0)).toThrow()
    expect(() => getAgentForStep(8)).toThrow()
  })
})

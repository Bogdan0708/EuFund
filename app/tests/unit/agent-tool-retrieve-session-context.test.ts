// app/tests/unit/agent-tool-retrieve-session-context.test.ts
import { describe, it, expect, vi } from 'vitest'

const mockKnowledgeRows = [
  { id: 'sk-1', kind: 'brief', slug: 'project-brief', title: 'Project Brief', contentMd: '# Brief\nSolar energy project', frontmatter: { program: 'PNRR' } },
  { id: 'sk-2', kind: 'section_pattern', slug: 'section-context', title: 'Context', contentMd: '## Context\nRomania needs green energy...', frontmatter: {} },
]

vi.mock('@/lib/ai/knowledge/session-knowledge', () => {
  const allRows = [
    { id: 'sk-1', kind: 'brief', slug: 'project-brief', title: 'Project Brief', contentMd: '# Brief\nSolar energy project', frontmatter: { program: 'PNRR' } },
    { id: 'sk-2', kind: 'section_pattern', slug: 'section-context', title: 'Context', contentMd: '## Context\nRomania needs green energy...', frontmatter: {} },
  ]
  return {
    getSessionKnowledge: vi.fn().mockResolvedValue(allRows),
    getSessionKnowledgeByKind: vi.fn().mockResolvedValue([allRows[0]]),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

// Import tool for side-effect registration
import '@/lib/ai/agent/tools/retrieve-session-context'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('retrieve_session_context tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: { currentPhase: 'drafting' } as any,
    sections: [],
    stateVersion: 0,
    requestId: 'req-1',
    locale: 'ro' as const,
  }

  it('is registered as a read tool', () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_session_context')
    expect(tool).toBeDefined()
    expect(tool!.category).toBe('read')
  })

  it('returns all session knowledge pages', async () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_session_context')!
    const result = await tool.execute({}, mockCtx)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(2)
  })

  it('filters by kind when provided', async () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_session_context')!
    const result = await tool.execute({ kind: 'brief' }, mockCtx)
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
  })
})

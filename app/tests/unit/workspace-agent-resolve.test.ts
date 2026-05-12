// Covers the V3-only agent fallback in resolveProjectWorkspace. Uses
// top-level vi.mock (hoisted) instead of vi.doMock + vi.resetModules to
// avoid the documented local `@/` alias flake — the same reason
// tests/integration/workspace.test.ts can't reliably exercise this path.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  withUserRLSMock,
} = vi.hoisted(() => ({
  withUserRLSMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  withUserRLS: withUserRLSMock,
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/pubsub', () => ({ persistAndPublishSectionUpdatedEvent: vi.fn() }))

import { resolveProjectWorkspace } from '@/lib/workspace'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const AGENT_SESSION_ID = '55555555-5555-4555-8555-555555555555'

// Build a tx object that returns canned results per table touched.
// `tableResults` is keyed by the table name string drizzle would receive;
// we identify the table by checking which drizzle column-bag was passed
// into .from(). The tx supports both the `.limit(N) -> Promise` shape and
// the `.orderBy() -> Promise` shape (which agentSections.orderBy uses).
interface TableQueryResult {
  rows: unknown[]
  // If true, .orderBy() resolves directly (no .limit() call). Used by the
  // agent_sections branch in workspace.ts which doesn't .limit().
  resolveOnOrderBy?: boolean
}

function buildTx(opts: {
  project: unknown
  resultsByTable: Map<string, TableQueryResult>
}) {
  // Tag tables so we know which branch we're in. We can't compare drizzle
  // column-bag identity across mocks, so we install marker properties and
  // expect the test to pass in objects with `__table` markers.
  return {
    query: {
      projects: { findFirst: vi.fn().mockResolvedValue(opts.project) },
    },
    select: vi.fn(() => {
      let currentTable: string | null = null
      const chain: Record<string, unknown> = {}
      chain.from = vi.fn((table: { __table?: string }) => {
        currentTable = table?.__table ?? null
        return chain
      })
      chain.where = vi.fn(() => chain)
      chain.orderBy = vi.fn(() => {
        const res = currentTable ? opts.resultsByTable.get(currentTable) : undefined
        if (res?.resolveOnOrderBy) {
          // Thenable: await yields the rows directly.
          return Object.assign(res.rows.slice(), {
            then: (resolve: (v: unknown) => void) => resolve(res.rows),
          })
        }
        return chain
      })
      chain.limit = vi.fn(() => {
        if (!currentTable) return Promise.resolve([])
        const res = opts.resultsByTable.get(currentTable)
        return Promise.resolve(res?.rows ?? [])
      })
      return chain
    }),
  }
}

// Stub schema by injecting __table markers on the mocked module so our
// buildTx() can distinguish branches.
vi.mock('@/lib/db/schema', () => ({
  projects: { __table: 'projects', id: 'id', deletedAt: 'deleted_at' },
  workflowSessions: { __table: 'workflow_sessions', projectId: 'project_id', userId: 'user_id', status: 'status', updatedAt: 'updated_at', id: 'id', context: 'context' },
  projectDocuments: { __table: 'project_documents', projectId: 'project_id', version: 'version' },
  sectionVersions: { __table: 'section_versions', sessionId: 'session_id', sectionId: 'section_id', version: 'version' },
  agentSessions: { __table: 'agent_sessions', id: 'id', projectId: 'project_id', userId: 'user_id', updatedAt: 'updated_at' },
  agentSections: { __table: 'agent_sections', sessionId: 'session_id', documentOrder: 'document_order' },
}))

beforeEach(() => {
  withUserRLSMock.mockReset()
})

describe('resolveProjectWorkspace — V3 agent fallback', () => {
  const mockProject = {
    id: PROJECT_ID,
    title: 'V3 Project',
    orgId: '33333333-3333-4333-8333-333333333333',
    createdBy: USER_ID,
    deletedAt: null,
  }
  const now = new Date('2026-05-12T12:00:00Z')

  it('returns mode=agent with mapped sections when only agent_sections exist', async () => {
    const agentSectionRows = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        sessionId: AGENT_SESSION_ID,
        sectionKey: 'rezumat',
        title: 'Rezumat',
        documentOrder: 0,
        generationOrder: 11,
        status: 'accepted',
        content: 'draft content',
        acceptedContent: 'final content',
        modelUsed: 'claude-sonnet-4-6',
        retryCount: 1,
        sourcesUsed: null,
        promptVersion: null,
        latencyMs: 1500,
        tokenUsage: { input: 800, output: 400 },
        errorClass: null,
        rejectionReason: null,
        updatedAt: now,
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        sessionId: AGENT_SESSION_ID,
        sectionKey: 'buget',
        title: 'Buget',
        documentOrder: 1,
        generationOrder: 12,
        status: 'draft',
        content: 'budget draft',
        acceptedContent: null,
        modelUsed: 'claude-sonnet-4-6',
        retryCount: 0,
        sourcesUsed: null,
        promptVersion: null,
        latencyMs: 1200,
        tokenUsage: null,
        errorClass: null,
        rejectionReason: null,
        updatedAt: now,
      },
    ]

    withUserRLSMock.mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({
        project: mockProject,
        resultsByTable: new Map([
          ['workflow_sessions', { rows: [], resolveOnOrderBy: true }],
          ['project_documents', { rows: [] }],
          ['agent_sessions', { rows: [{ id: AGENT_SESSION_ID }] }],
          ['agent_sections', { rows: agentSectionRows, resolveOnOrderBy: true }],
        ]),
      })),
    )

    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID)

    expect(result).not.toBeNull()
    expect(result!.mode).toBe('agent')
    expect(result!.session).toBeNull()
    expect(result!.sections).toHaveLength(2)
    // Slug-shaped id (sectionKey), not row UUID — see SLUG_RE in sections/[sectionId] routes
    expect(result!.sections[0].id).toBe('rezumat')
    expect(result!.sections[0].title).toBe('Rezumat')
    expect(result!.sections[0].content).toBe('final content') // acceptedContent preferred
    expect(result!.sections[0].state).toBe('approved') // accepted → approved
    expect(result!.sections[1].id).toBe('buget')
    expect(result!.sections[1].state).toBe('draft')
  })

  it('falls through to snapshot mode (empty) when neither workflow_session, agent_session, nor snapshot exists', async () => {
    withUserRLSMock.mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({
        project: mockProject,
        resultsByTable: new Map([
          ['workflow_sessions', { rows: [], resolveOnOrderBy: true }],
          ['project_documents', { rows: [] }],
          ['agent_sessions', { rows: [] }],
        ]),
      })),
    )

    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID)
    expect(result).not.toBeNull()
    expect(result!.mode).toBe('snapshot')
    expect(result!.sections).toEqual([])
  })

  it('returns null when the project does not exist', async () => {
    withUserRLSMock.mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({
        project: undefined,
        resultsByTable: new Map(),
      })),
    )
    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID)
    expect(result).toBeNull()
  })

  it('skips the agent_sections lookup when the linked agent_session has no rows yet', async () => {
    withUserRLSMock.mockImplementation(async (_userId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(buildTx({
        project: mockProject,
        resultsByTable: new Map([
          ['workflow_sessions', { rows: [], resolveOnOrderBy: true }],
          ['project_documents', { rows: [] }],
          ['agent_sessions', { rows: [{ id: AGENT_SESSION_ID }] }],
          ['agent_sections', { rows: [], resolveOnOrderBy: true }],
        ]),
      })),
    )

    const result = await resolveProjectWorkspace(PROJECT_ID, USER_ID)
    // No agent sections → no agent mode → fall through to empty snapshot
    expect(result!.mode).toBe('snapshot')
    expect(result!.sections).toEqual([])
  })
})

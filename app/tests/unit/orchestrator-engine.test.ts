import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('processMessage persistSectionChanges integration', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('enriches sections via persistSectionChanges before db.update', async () => {
    const SESSION_ID = '33333333-3333-4333-8333-333333333333'
    const USER_ID = '44444444-4444-4444-8444-444444444444'

    // Existing v1 section already in the session context
    const existingSection = {
      id: 'context',
      title: 'Context',
      content: 'Old content',
      order: 1,
      source: 'generated' as const,
      state: 'draft' as const,
      currentVersion: 1,
      versionCount: 1,
      contentHash: 'oldhash',
      lastStateChangeAt: '2026-04-05T00:00:00.000Z',
      lastStateChangeBy: USER_ID,
      metadata: {
        model: 'gpt-5.4',
        provider: 'openai',
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 200,
        retryCount: 0,
        fallbackUsed: false,
        generatedAt: '2026-04-05T00:00:00.000Z',
        checksum: 'abc',
      },
    }

    // Agent-produced updated section (new content)
    const newSection = {
      id: 'context',
      title: 'Context',
      content: 'New content',
      order: 1,
      source: 'edited' as const,
      state: 'draft' as const,
      currentVersion: 1,
      versionCount: 1,
      contentHash: '',
      lastStateChangeAt: '',
      lastStateChangeBy: null,
      metadata: {
        model: 'gpt-5.4',
        provider: 'openai',
        tokensIn: 120,
        tokensOut: 60,
        latencyMs: 220,
        retryCount: 0,
        fallbackUsed: false,
        generatedAt: '2026-04-05T00:01:00.000Z',
        checksum: 'def',
      },
    }

    // Spy on persistSectionChanges — pass-through so the enriched payload
    // is the agent's newSections unchanged (identity transform).
    const persistSpy = vi.fn().mockImplementation(
      async (opts: { newSections: unknown[] }) => opts.newSections,
    )

    vi.doMock('@/lib/section-versions', () => ({
      persistSectionChanges: persistSpy,
    }))
    vi.doMock('@/lib/feature-flags', () => ({
      isFeatureEnabled: vi.fn().mockResolvedValue(true),
    }))

    // Mock the agent that will run for step 5 (buildAgent) to return the
    // new sections and no checkpoint — simulating post-completion edit flow
    // (isCompleted=true below, routed through editAgent).
    const mockAgentFn = vi.fn().mockResolvedValue({
      data: { projectSections: [newSection] },
      checkpoint: null,
    })
    vi.doMock('@/lib/ai/orchestrator/agents/edit', () => ({
      editAgent: mockAgentFn,
    }))

    // Stateful DB mock. The sequence of select calls inside processMessage:
    //   1. loadSession: select from workflowSessions (returns session row with ctx)
    //   2. session status check: select { status } (returns 'completed' → routes to editAgent)
    //   3. last assistant message check: select { eventType, step } (returns [])
    // The update at the end captures the final context payload.
    const sessionRow = {
      id: SESSION_ID,
      userId: USER_ID,
      currentStep: 5,
      status: 'completed',
      context: {
        sessionId: SESSION_ID,
        userId: USER_ID,
        locale: 'ro',
        tier: 'plus',
        step: 5,
        enhancedIdea: null,
        matchedCalls: null,
        selectedCallId: null,
        callBlueprint: null,
        actionPlan: null,
        projectSections: [existingSection],
        uploadedFiles: [],
      },
    }

    let selectCallCount = 0
    const updateSetCapture = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => {
          selectCallCount += 1
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockImplementation(async () => {
                  if (selectCallCount === 1) return [sessionRow]
                  if (selectCallCount === 2) return [{ status: 'completed' }]
                  return []
                }),
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: SESSION_ID }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: updateSetCapture,
        }),
      },
    }))

    const streamSend = vi.fn()
    const stream = { send: streamSend, close: vi.fn() }
    const gateway = { chat: vi.fn() }

    const { processMessage } = await import('@/lib/ai/orchestrator/engine')
    await processMessage(SESSION_ID, 'refine this section', stream as unknown as Parameters<typeof processMessage>[2], gateway as unknown as Parameters<typeof processMessage>[3])

    // 1. persistSectionChanges was called exactly once
    expect(persistSpy).toHaveBeenCalledTimes(1)

    // 2. It was called with the correct options: previousSections from ctx,
    //    newSections from the agent, sessionId + userId populated.
    const callArgs = persistSpy.mock.calls[0][0]
    expect(callArgs.sessionId).toBe(SESSION_ID)
    expect(callArgs.userId).toBe(USER_ID)
    expect(callArgs.previousSections).toEqual([existingSection])
    expect(callArgs.newSections).toEqual([newSection])
    expect(Array.isArray(callArgs.newSections)).toBe(true)

    // reason should be the user's input on the edit path (isCompleted=true)
    expect(callArgs.reason).toBeDefined()
    expect(typeof callArgs.reason).toBe('string')
    expect(callArgs.reason).toBe('refine this section')

    // 3. db.update(workflowSessions).set(...) was called with a context that
    //    contains the enriched sections (pass-through spy returns newSections).
    expect(updateSetCapture).toHaveBeenCalled()
    const setArg = updateSetCapture.mock.calls[0][0] as { context: { projectSections: unknown } }
    expect(setArg.context).toBeDefined()
    expect(setArg.context.projectSections).toEqual([newSection])
  })

  it('uses reason=initial_generation when session is active (initial build)', async () => {
    const SESSION_ID = '55555555-5555-4555-8555-555555555555'
    const USER_ID = '66666666-6666-4666-8666-666666666666'

    // Agent-produced new section (initial build — no previous sections)
    const newSection = {
      id: 'context',
      title: 'Context',
      content: 'Initial content',
      order: 1,
      source: 'generated' as const,
      state: 'draft' as const,
      currentVersion: 1,
      versionCount: 1,
      contentHash: '',
      lastStateChangeAt: '',
      lastStateChangeBy: null,
      metadata: {
        model: 'gpt-5.4',
        provider: 'openai',
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 200,
        retryCount: 0,
        fallbackUsed: false,
        generatedAt: '2026-04-05T00:00:00.000Z',
        checksum: 'abc',
      },
    }

    const persistSpy = vi.fn().mockImplementation(
      async (opts: { newSections: unknown[] }) => opts.newSections,
    )

    vi.doMock('@/lib/section-versions', () => ({
      persistSectionChanges: persistSpy,
    }))
    vi.doMock('@/lib/feature-flags', () => ({
      isFeatureEnabled: vi.fn().mockResolvedValue(true),
    }))

    // Mock the build agent (step 5) for the active-session path.
    // isCompleted=false (status='active') routes via getAgentForStep(ctx.step=5)
    // which returns buildAgent.
    const mockBuildAgent = vi.fn().mockResolvedValue({
      data: { projectSections: [newSection] },
      checkpoint: null,
    })
    vi.doMock('@/lib/ai/orchestrator/agents/build', () => ({
      buildAgent: mockBuildAgent,
    }))

    // Session row: status 'active' so isCompleted=false, currentStep=5 so
    // getAgentForStep(5) selects buildAgent. projectSections=null (initial build).
    const sessionRow = {
      id: SESSION_ID,
      userId: USER_ID,
      currentStep: 5,
      status: 'active',
      context: {
        sessionId: SESSION_ID,
        userId: USER_ID,
        locale: 'ro',
        tier: 'plus',
        step: 5,
        enhancedIdea: null,
        matchedCalls: null,
        selectedCallId: null,
        callBlueprint: null,
        actionPlan: null,
        projectSections: null,
        uploadedFiles: [],
      },
    }

    let selectCallCount = 0
    const updateSetCapture = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockImplementation(() => {
          selectCallCount += 1
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockImplementation(async () => {
                  if (selectCallCount === 1) return [sessionRow]
                  if (selectCallCount === 2) return [{ status: 'active' }]
                  return []
                }),
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: SESSION_ID }]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: updateSetCapture,
        }),
      },
    }))

    const streamSend = vi.fn()
    const stream = { send: streamSend, close: vi.fn() }
    const gateway = { chat: vi.fn() }

    const { processMessage } = await import('@/lib/ai/orchestrator/engine')
    await processMessage(
      SESSION_ID,
      'build the proposal',
      stream as unknown as Parameters<typeof processMessage>[2],
      gateway as unknown as Parameters<typeof processMessage>[3],
    )

    expect(persistSpy).toHaveBeenCalledTimes(1)
    const callArgs = persistSpy.mock.calls[0][0]
    expect(callArgs.reason).toBe('initial_generation')
  })
})

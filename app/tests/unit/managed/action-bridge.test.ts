import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeManagedTool = vi.fn()
const trackManagedActionBridge = vi.fn()

vi.mock('@/lib/ai/agent/managed/executor', () => ({
  executeManagedTool: (...args: unknown[]) => executeManagedTool(...args),
}))

vi.mock('@/lib/monitoring/metrics', () => ({
  trackManagedActionBridge: (...args: unknown[]) => trackManagedActionBridge(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

const ctx = {
  userId: 'user-1',
  sessionId: 'session-1',
  requestId: 'request-1',
  now: new Date('2026-05-13T00:00:00Z'),
  allowWrites: true,
}

describe('bridgeStructuredAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles request_refresh as read-only without executing a tool or LLM turn', async () => {
    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')

    const result = await bridgeStructuredAction(ctx, { type: 'request_refresh' }, 7)

    expect(result).toMatchObject({
      outcome: 'no_op',
      stateVersionBumped: false,
      newStateVersion: 7,
      continueToManaged: false,
    })
    expect(executeManagedTool).not.toHaveBeenCalled()
  })

  it('rejects regenerate_section without mutating state', async () => {
    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')

    const result = await bridgeStructuredAction(
      ctx,
      { type: 'regenerate_section', sectionKey: 'intro', feedback: 'shorter' },
      2,
    )

    expect(result).toMatchObject({
      outcome: 'policy_error',
      errorCode: 'REGENERATE_ENDPOINT_REQUIRED',
      stateVersionBumped: false,
      continueToManaged: false,
    })
    expect(executeManagedTool).not.toHaveBeenCalled()
  })

  it('classifies write success only when newStateVersion advances', async () => {
    executeManagedTool.mockResolvedValueOnce({
      isError: false,
      content: JSON.stringify({ newStateVersion: 4 }),
      toolName: 'freeze_outline',
      latencyMs: 1,
    })
    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')

    const result = await bridgeStructuredAction(ctx, { type: 'approve_outline' }, 3)

    expect(result).toMatchObject({
      outcome: 'success',
      stateVersionBumped: true,
      newStateVersion: 4,
      continueToManaged: false,
    })
  })

  it('does not classify arbitrary JSON text as success or not_found', async () => {
    executeManagedTool.mockResolvedValueOnce({
      isError: false,
      content: JSON.stringify({ status: 'completed', annexStatus: 'NOT_FOUND' }),
      toolName: 'set_selected_call',
      latencyMs: 1,
    })
    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')

    const result = await bridgeStructuredAction(ctx, { type: 'select_call', callId: 'CALL-1' }, 3)

    expect(result.outcome).toBe('no_op')
    expect(result.stateVersionBumped).toBe(false)
    expect(result.errorCode).toBeUndefined()
  })

  it('uses prefix-only error classification', async () => {
    executeManagedTool.mockResolvedValueOnce({
      isError: true,
      content: '{"note":"CONCURRENCY and NOT_FOUND appear in JSON"}',
      toolName: 'approve_revision',
      latencyMs: 1,
    })
    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')

    const result = await bridgeStructuredAction(
      ctx,
      { type: 'accept_section', sectionKey: 'intro' },
      3,
    )

    expect(result.outcome).toBe('failed')
    expect(result.errorCode).toBe('UNKNOWN')
  })

  it('allocates unique tool_use ids for rapid actions', async () => {
    executeManagedTool.mockResolvedValue({
      isError: false,
      content: JSON.stringify({ newStateVersion: 4 }),
      toolName: 'freeze_outline',
      latencyMs: 1,
    })
    const { bridgeStructuredAction } = await import('@/lib/ai/agent/managed/bridge')

    await bridgeStructuredAction(ctx, { type: 'approve_outline' }, 3)
    await bridgeStructuredAction(ctx, { type: 'approve_outline' }, 3)

    const firstId = executeManagedTool.mock.calls[0][0].id
    const secondId = executeManagedTool.mock.calls[1][0].id
    expect(firstId).toMatch(/^bridge_/)
    expect(secondId).toMatch(/^bridge_/)
    expect(firstId).not.toBe(secondId)
  })
})

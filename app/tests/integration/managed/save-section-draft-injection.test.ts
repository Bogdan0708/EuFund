import { describe, it, expect, vi, beforeEach } from 'vitest'

const saveSpy = vi.fn().mockResolvedValue({ version: 1, sectionKey: 'intro' })

vi.mock('@/lib/ai/agent/services/sections', () => ({
  saveSectionDraft: saveSpy,
}))

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn(),
}))

describe('managed executor — save_section_draft section-key injection', () => {
  beforeEach(() => {
    saveSpy.mockClear()
  })

  it('uses ctx.focusedSectionKey when the model omits sectionKey', async () => {
    const { dispatchTool } = await import('@/lib/ai/agent/managed/executor')
    await dispatchTool(
      'save_section_draft',
      { content: 'body' },
      {
        userId: '11111111-1111-4111-8111-111111111111',
        sessionId: '22222222-2222-4222-8222-222222222222',
        requestId: 'req-1',
        now: new Date(),
        allowWrites: true,
        focusedSectionKey: 'intro',
        expectedStateVersion: 7,
      },
    )

    expect(saveSpy).toHaveBeenCalledTimes(1)
    const [calledCtx, calledInput] = saveSpy.mock.calls[0]
    expect(calledCtx).toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      sessionId: '22222222-2222-4222-8222-222222222222',
    })
    expect(calledInput).toMatchObject({
      sessionId: '22222222-2222-4222-8222-222222222222',
      sectionKey: 'intro',
      content: 'body',
      expectedStateVersion: 7,
    })
  })

  it('refuses model-supplied sectionKey when it does not match ctx.focusedSectionKey', async () => {
    const { dispatchTool } = await import('@/lib/ai/agent/managed/executor')
    const { ValidationError } = await import('@/lib/ai/agent/services/errors')

    let caught: unknown = null
    try {
      await dispatchTool(
        'save_section_draft',
        { content: 'body', sectionKey: 'model-picked' },
        {
          userId: '11111111-1111-4111-8111-111111111111',
          sessionId: '22222222-2222-4222-8222-222222222222',
          requestId: 'req-2',
          now: new Date(),
          allowWrites: true,
          focusedSectionKey: 'ctx-focus',
          expectedStateVersion: 7,
        },
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ValidationError)
    expect((caught as { policyCode?: string }).policyCode).toBe('WRONG_SECTION_TARGET')
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('accepts model-supplied sectionKey when it matches ctx.focusedSectionKey', async () => {
    const { dispatchTool } = await import('@/lib/ai/agent/managed/executor')
    await dispatchTool(
      'save_section_draft',
      { content: 'body', sectionKey: 'intro' },
      {
        userId: '11111111-1111-4111-8111-111111111111',
        sessionId: '22222222-2222-4222-8222-222222222222',
        requestId: 'req-2b',
        now: new Date(),
        allowWrites: true,
        focusedSectionKey: 'intro',
        expectedStateVersion: 7,
      },
    )
    const [, calledInput] = saveSpy.mock.calls[0]
    expect(calledInput).toMatchObject({ sectionKey: 'intro' })
  })

  it('throws ValidationError with policyCode=NO_SECTION_FOCUSED when neither key is available', async () => {
    const { dispatchTool } = await import('@/lib/ai/agent/managed/executor')
    const { ValidationError } = await import('@/lib/ai/agent/services/errors')

    let caught: unknown = null
    try {
      await dispatchTool(
        'save_section_draft',
        { content: 'body' },
        {
          userId: '11111111-1111-4111-8111-111111111111',
          sessionId: '22222222-2222-4222-8222-222222222222',
          requestId: 'req-3',
          now: new Date(),
          allowWrites: true,
          expectedStateVersion: 7,
        },
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ValidationError)
    expect((caught as { policyCode?: string }).policyCode).toBe('NO_SECTION_FOCUSED')
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

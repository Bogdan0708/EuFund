import { describe, it, expect } from 'vitest'
import { buildManagedSystemPrompt } from '@/lib/ai/agent/managed/prompt'

const mkSession = (opts: { phase: 'discovery'|'research'|'structuring'|'drafting'|'review', selectedCallId?: string | null }) => ({
  id: 's1', userId: 'u1', status: 'active', locale: 'ro',
  selectedCallId: opts.selectedCallId ?? null,
  currentPhase: opts.phase,
  blueprint: null, eligibility: null, outline: null,
  warnings: [], planningArtifact: null, messageSummary: null,
  stateVersion: 0, createdAt: new Date(), updatedAt: new Date(),
  outlineFrozen: false, projectId: null,
} as any)

describe('phaseBootstrapBlock — Romanian', () => {
  it('renders a structuring-branch clause when phase=structuring', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'structuring', selectedCallId: 'CALL-A' }),
      [], 'structuring', 'ro', true,
    )
    expect(p).toContain('## Punct de pornire')
    expect(p).toContain('CALL-A')
    expect(p).toContain('Blueprint-ul complet al apelului este deja disponibil în stare')
    expect(p).not.toContain('vezi `get_call_blueprint`')
  })

  it('renders a research-branch clause when phase=research with selectedCallId', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'research', selectedCallId: 'CALL-B' }),
      [], 'research', 'ro', true,
    )
    expect(p).toContain('## Punct de pornire')
    expect(p).toContain('CALL-B')
    expect(p).toContain('extrage-l folosind `get_call_blueprint`')
  })

  it('omits the block when phase=discovery', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'discovery' }), [], 'discovery', 'ro', true,
    )
    expect(p).not.toContain('## Punct de pornire')
  })

  it('omits the block when phase=structuring but selectedCallId is null', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'structuring', selectedCallId: null }),
      [], 'structuring', 'ro', true,
    )
    expect(p).not.toContain('## Punct de pornire')
  })

  it('omits the block when phase=research but selectedCallId is null', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'research', selectedCallId: null }),
      [], 'research', 'ro', true,
    )
    expect(p).not.toContain('## Punct de pornire')
  })
})

describe('phaseBootstrapBlock — English', () => {
  it('renders a structuring-branch clause when phase=structuring', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'structuring', selectedCallId: 'CALL-A' }),
      [], 'structuring', 'en', true,
    )
    expect(p).toContain('## Starting point')
    expect(p).toContain('CALL-A')
    expect(p).toContain('The full call blueprint is already available in state')
    expect(p).not.toContain('see `get_call_blueprint`')
  })

  it('renders a research-branch clause when phase=research with selectedCallId', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'research', selectedCallId: 'CALL-B' }),
      [], 'research', 'en', true,
    )
    expect(p).toContain('## Starting point')
    expect(p).toContain('CALL-B')
    expect(p).toContain('extract it using `get_call_blueprint`')
  })

  it('omits the block when phase=discovery', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'discovery' }), [], 'discovery', 'en', true,
    )
    expect(p).not.toContain('## Starting point')
  })

  it('omits the block when phase=structuring but selectedCallId is null', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'structuring', selectedCallId: null }),
      [], 'structuring', 'en', true,
    )
    expect(p).not.toContain('## Starting point')
  })

  it('omits the block when phase=research but selectedCallId is null', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'research', selectedCallId: null }),
      [], 'research', 'en', true,
    )
    expect(p).not.toContain('## Starting point')
  })
})

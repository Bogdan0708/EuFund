'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAgent } from '@/hooks/useAgent'
import { AgentConversation } from '@/components/agent/AgentConversation'
import { AgentWorkspace } from '@/components/agent/AgentWorkspace'
import { preselect, type Candidate } from '@/lib/preselect/client'
import { SelectedCallBanner } from './components/SelectedCallBanner'
import { CandidatePicker } from './components/CandidatePicker'
import { NoMatchGuidance } from './components/NoMatchGuidance'

interface NewProjectViewProps {
  locale: 'ro' | 'en'
  initialSessionId?: string
  preselectEnabled: boolean
  noAutoSend: boolean
  actionsEnabled: boolean
  generateEnabled: boolean
}

const HERO_QUERY_KEY = 'fondeu:hero-query'

type PreselectState =
  | { kind: 'idle' }
  | { kind: 'matching' }
  | {
      kind: 'selected'
      sessionId: string
      callId: string
      callTitle: string
      description: string
    }
  | {
      kind: 'ambiguous'
      candidates: Candidate[]
      description: string
      // Populated when the ambiguous response came from override-mode
      // rerank (the user clicked "Change" on an existing session).
      // When present, picking a candidate must mutate the existing
      // session via confirm-override, NOT create a new session.
      overrideContext?: {
        sessionId: string
        expectedStateVersion: number
      }
    }
  | { kind: 'no_match'; reason: string }
  | { kind: 'error'; code: string; message: string }

export function NewProjectView({
  locale,
  initialSessionId,
  preselectEnabled,
  noAutoSend,
  actionsEnabled,
  generateEnabled,
}: NewProjectViewProps) {
  const tPre = useTranslations('preselect')
  const tPage = useTranslations('projects')
  const tAgent = useTranslations('agent')
  const agent = useAgent(locale, initialSessionId)
  const [state, setState] = useState<PreselectState>({ kind: 'idle' })
  // Pre-fill from /panou's hero search via sessionStorage (not URL params —
  // keeps project descriptions out of history/logs/referrers). Read once
  // on mount, clear the key, then pass the value down to AgentConversation
  // as its initial input. We deliberately do NOT auto-send: that would
  // make a crafted authenticated link trigger preselect + LLM work the
  // moment a logged-in user clicked it. The user still has to click Send.
  const [initialInput, setInitialInput] = useState<string>('')
  const heroQueryConsumedRef = useRef(false)

  const handleSendMessage = useCallback(
    async (description: string) => {
      // Preselect is only relevant on the first send of a brand-new session.
      // If the flag is off, the session is already resumed, or we have already
      // transitioned past idle, fall through to the normal agent send.
      if (!preselectEnabled || initialSessionId || agent.sessionId) {
        await agent.sendMessage(description)
        return
      }
      if (state.kind !== 'idle' && state.kind !== 'no_match' && state.kind !== 'error') {
        await agent.sendMessage(description)
        return
      }

      setState({ kind: 'matching' })
      const result = await preselect({ description, locale })

      if ('kind' in result && result.kind === 'error') {
        setState({ kind: 'error', code: result.code, message: result.message })
        return
      }

      if (result.kind === 'no_match') {
        setState({ kind: 'no_match', reason: result.reason })
        return
      }

      if (result.kind === 'ambiguous') {
        setState({ kind: 'ambiguous', candidates: result.candidates, description })
        return
      }

      // result.kind === 'selected'
      // Update URL so a refresh resumes into the created session
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `?session=${result.sessionId}`)
      }
      // Teach useAgent about the sessionId the preselect endpoint just
      // created BEFORE sending the first turn — otherwise useAgent's
      // internal sessionId is null and /api/ai/agent would create a fresh
      // discovery session instead of continuing the preselected one.
      // Critical: we transition into 'selected' AFTER adopt resolves, so a
      // failed adoption surfaces as an error instead of stranding the UI in
      // a 'selected' state with no working agent session.
      const adopted = await agent.adoptSession(result.sessionId)
      if (!adopted) {
        setState({
          kind: 'error',
          code: 'ADOPTION_FAILED',
          message: tPre('errors.ADOPTION_FAILED'),
        })
        return
      }
      setState({
        kind: 'selected',
        sessionId: result.sessionId,
        callId: result.selectedCallId,
        callTitle: result.candidates[0]?.title ?? result.selectedCallId,
        description,
      })
      if (!noAutoSend) {
        await agent.sendMessage(description)
      }
    },
    [preselectEnabled, initialSessionId, locale, agent, state.kind, tPre, noAutoSend],
  )

  // Read the hero query out of sessionStorage exactly once on mount.
  // Skipped on resume flows (the user came back to an existing session,
  // not from a fresh hero search), and the key is cleared immediately so
  // a refresh doesn't re-populate the input.
  useEffect(() => {
    if (heroQueryConsumedRef.current || initialSessionId) return
    if (typeof window === 'undefined') return
    const queued = window.sessionStorage.getItem(HERO_QUERY_KEY)
    if (queued) {
      window.sessionStorage.removeItem(HERO_QUERY_KEY)
      setInitialInput(queued)
    }
    heroQueryConsumedRef.current = true
  }, [initialSessionId])

  const handleCandidatePick = useCallback(
    async (callId: string) => {
      if (state.kind !== 'ambiguous') return
      const description = state.description
      const overrideCtx = state.overrideContext
      setState({ kind: 'matching' })
      // If this ambiguous came from override-mode rerank, pick routes
      // through confirm-override (mutates the existing session). Otherwise,
      // it's a first-dispatch ambiguous and pick creates a new session.
      const result = await preselect({
        description,
        locale,
        confirmCandidateId: callId,
        ...(overrideCtx && {
          sessionId: overrideCtx.sessionId,
          expectedStateVersion: overrideCtx.expectedStateVersion,
        }),
      })
      if ('kind' in result && result.kind === 'error') {
        setState({ kind: 'error', code: result.code, message: result.message })
        return
      }
      if (result.kind === 'selected') {
        if (overrideCtx) {
          // Existing session was mutated — refresh its state (stateVersion
          // bumped via setSelectedCall). Do NOT touch URL; sessionId is
          // unchanged. Transition AFTER adopt resolves so a failure does
          // not strand the UI in 'selected' against a stale agent session.
          const adopted = await agent.adoptSession(result.sessionId)
          if (!adopted) {
            setState({
              kind: 'error',
              code: 'ADOPTION_FAILED',
              message: tPre('errors.ADOPTION_FAILED'),
            })
            return
          }
          setState({
            kind: 'selected',
            sessionId: result.sessionId,
            callId: result.selectedCallId,
            callTitle: result.candidates[0]?.title ?? result.selectedCallId,
            description,
          })
          return
        }
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `?session=${result.sessionId}`)
        }
        const adopted = await agent.adoptSession(result.sessionId)
        if (!adopted) {
          setState({
            kind: 'error',
            code: 'ADOPTION_FAILED',
            message: tPre('errors.ADOPTION_FAILED'),
          })
          return
        }
        setState({
          kind: 'selected',
          sessionId: result.sessionId,
          callId: result.selectedCallId,
          callTitle: result.candidates[0]?.title ?? result.selectedCallId,
          description,
        })
        if (!noAutoSend) {
          await agent.sendMessage(description)
        }
      }
    },
    [state, locale, agent, tPre, noAutoSend],
  )

  const handleChangeRequested = useCallback(async () => {
    if (state.kind !== 'selected' || !agent.sessionId) return
    const description = state.description
    const rejectedCallId = state.callId
    setState({ kind: 'matching' })
    const result = await preselect({
      description,
      locale,
      sessionId: agent.sessionId,
      expectedStateVersion: agent.stateVersion,
      excludeCallIds: [rejectedCallId],
    })
    if ('kind' in result && result.kind === 'error') {
      setState({ kind: 'error', code: result.code, message: result.message })
      return
    }
    if (result.kind === 'selected') {
      // Override mode bumped the session's stateVersion via setSelectedCall.
      // Re-hydrate from /api/ai/agent/state so the next sendMessage carries
      // the fresh stateVersion; otherwise the next managed turn will 409 on
      // CAS check. Transition AFTER adopt resolves to keep UI honest.
      const adopted = await agent.adoptSession(result.sessionId)
      if (!adopted) {
        setState({
          kind: 'error',
          code: 'ADOPTION_FAILED',
          message: tPre('errors.ADOPTION_FAILED'),
        })
        return
      }
      setState({
        kind: 'selected',
        sessionId: result.sessionId,
        callId: result.selectedCallId,
        callTitle: result.candidates[0]?.title ?? result.selectedCallId,
        description,
      })
      return
    }
    if (result.kind === 'ambiguous') {
      // Attach override context so a subsequent candidate pick targets
      // the EXISTING session via confirm-override, not a fresh session.
      setState({
        kind: 'ambiguous',
        candidates: result.candidates,
        description,
        overrideContext: {
          sessionId: agent.sessionId,
          expectedStateVersion: agent.stateVersion,
        },
      })
      return
    }
    if (result.kind === 'no_match') {
      setState({ kind: 'no_match', reason: result.reason })
    }
  }, [state, locale, agent, tPre])

  const handleNoMatchRetry = useCallback(() => {
    setState({ kind: 'idle' })
  }, [])

  const onGenerate = useCallback(async () => {
    try {
      await agent.generateSection({})
    } catch (err) {
      // Error surfaces via agent.error / status
      void err
    }
  }, [agent])

  // Map server error codes to localized messages via the preselect.errors.* namespace.
  const errorMessage = (code: string, fallback: string): string => {
    try {
      const ns = tPre.raw('errors') as Record<string, string> | undefined
      if (ns && code in ns) return ns[code]!
    } catch {
      // fall through
    }
    return fallback
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">
          {tPage(initialSessionId ? 'resumeProject' : 'newProject')}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {tPage('agentDescription')}
        </p>
      </div>

      {/* Preselect UX strip — above the main conversation/workspace */}
      {(state.kind === 'selected'
        || state.kind === 'ambiguous'
        || state.kind === 'no_match'
        || state.kind === 'matching'
        || state.kind === 'error') && (
        <div className="px-6 py-3 border-b border-gray-200 bg-white space-y-3">
          {state.kind === 'selected' && (
            <SelectedCallBanner
              callTitle={state.callTitle}
              outlineFrozen={agent.outlineFrozen}
              onChangeRequested={handleChangeRequested}
            />
          )}
          {state.kind === 'ambiguous' && (
            <CandidatePicker
              candidates={state.candidates}
              onSelect={handleCandidatePick}
            />
          )}
          {state.kind === 'no_match' && (
            <NoMatchGuidance onRetry={handleNoMatchRetry} />
          )}
          {state.kind === 'matching' && (
            <p className="text-sm text-gray-600">{tPre('matching')}</p>
          )}
          {state.kind === 'error' && (
            <p className="text-sm text-red-600">
              {errorMessage(state.code, state.message)}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-3/5 border-r border-gray-200 flex flex-col">
          <AgentConversation
            messages={agent.messages}
            status={agent.status}
            error={agent.error}
            initialInput={initialInput}
            onSendMessage={handleSendMessage}
            welcomeMessage={
              noAutoSend && state.kind === 'selected' && agent.messages.length === 0
                ? tAgent('welcomeAfterPreselect')
                : undefined
            }
          />
        </div>
        <div className="w-2/5 bg-gray-50">
          <AgentWorkspace
            phase={agent.phase}
            sections={agent.sections}
            blueprint={agent.blueprint}
            eligibility={agent.eligibility}
            warnings={agent.warnings}
            onAction={agent.sendAction}
            isBusy={agent.status === 'streaming' || agent.status === 'connecting'}
            outlineFrozen={agent.outlineFrozen}
            actionsEnabled={actionsEnabled}
            runAction={agent.runAction}
            setFocusedSectionKey={agent.setFocusedSectionKey}
            generateEnabled={generateEnabled}
            onGenerate={onGenerate}
          />
        </div>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useState } from 'react'
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
}

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
  | { kind: 'ambiguous'; candidates: Candidate[]; description: string }
  | { kind: 'no_match'; reason: string }
  | { kind: 'error'; code: string; message: string }

export function NewProjectView({
  locale,
  initialSessionId,
  preselectEnabled,
}: NewProjectViewProps) {
  const tPre = useTranslations('preselect')
  const tPage = useTranslations('projects')
  const agent = useAgent(locale, initialSessionId)
  const [state, setState] = useState<PreselectState>({ kind: 'idle' })

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
      setState({
        kind: 'selected',
        sessionId: result.sessionId,
        callId: result.selectedCallId,
        callTitle: result.candidates[0]?.title ?? result.selectedCallId,
        description,
      })
      // Update URL so a refresh resumes into the created session
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `?session=${result.sessionId}`)
      }
      // Teach useAgent about the sessionId the preselect endpoint just
      // created BEFORE sending the first turn — otherwise useAgent's
      // internal sessionId is null and /api/ai/agent would create a fresh
      // discovery session instead of continuing the preselected one.
      await agent.adoptSession(result.sessionId)
      await agent.sendMessage(description)
    },
    [preselectEnabled, initialSessionId, locale, agent, state.kind],
  )

  const handleCandidatePick = useCallback(
    async (callId: string) => {
      if (state.kind !== 'ambiguous') return
      const description = state.description
      setState({ kind: 'matching' })
      const result = await preselect({
        description,
        locale,
        confirmCandidateId: callId,
      })
      if ('kind' in result && result.kind === 'error') {
        setState({ kind: 'error', code: result.code, message: result.message })
        return
      }
      if (result.kind === 'selected') {
        setState({
          kind: 'selected',
          sessionId: result.sessionId,
          callId: result.selectedCallId,
          callTitle: result.candidates[0]?.title ?? result.selectedCallId,
          description,
        })
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `?session=${result.sessionId}`)
        }
        await agent.adoptSession(result.sessionId)
        await agent.sendMessage(description)
      }
    },
    [state, locale, agent],
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
      setState({ kind: 'ambiguous', candidates: result.candidates, description })
      return
    }
    if (result.kind === 'no_match') {
      setState({ kind: 'no_match', reason: result.reason })
    }
  }, [state, locale, agent])

  const handleNoMatchRetry = useCallback(() => {
    setState({ kind: 'idle' })
  }, [])

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
        <div className="w-1/2 border-r border-gray-200 flex flex-col">
          <AgentConversation
            messages={agent.messages}
            status={agent.status}
            error={agent.error}
            onSendMessage={handleSendMessage}
          />
        </div>
        <div className="w-1/2 bg-gray-50">
          <AgentWorkspace
            phase={agent.phase}
            sections={agent.sections}
            blueprint={agent.blueprint}
            eligibility={agent.eligibility}
            warnings={agent.warnings}
            onAction={agent.sendAction}
          />
        </div>
      </div>
    </div>
  )
}

'use client'
import { useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useEffect, useRef } from 'react'
import { useOrchestrator } from '@/hooks/useOrchestrator'
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout'

export default function AIWorkspacePage() {
  const locale = useLocale()
  const searchParams = useSearchParams()
  const idea = searchParams.get('idea')
  const sessionId = searchParams.get('session')
  const { messages, currentStep, status, sendMessage, isStreaming, resumeSession } = useOrchestrator(locale)
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    if (sessionId) {
      resumeSession(sessionId)
    } else if (idea) {
      sendMessage(idea)
    }
  }, [sessionId, idea, resumeSession, sendMessage])

  return (
    <WorkspaceLayout
      messages={messages}
      currentStep={currentStep}
      status={status}
      isStreaming={isStreaming}
      onSend={sendMessage}
    />
  )
}

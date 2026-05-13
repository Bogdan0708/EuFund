'use client'

import { Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useAgent } from '@/hooks/useAgent'
import { AgentConversation } from '@/components/agent/AgentConversation'
import { AgentWorkspace } from '@/components/agent/AgentWorkspace'

function AsistentAIInner({ locale }: { locale: string }) {
  const t = useTranslations('aiAssistant')
  const searchParams = useSearchParams()
  const initialSessionId = searchParams?.get('session') || undefined
  const agent = useAgent(locale as 'ro' | 'en', initialSessionId)

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">
          {t('curatorTitle')}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('curatorContext')}
        </p>
      </div>

      {/* Main content — conversation left, workspace right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Conversation */}
        <div className="w-3/5 border-r border-gray-200 flex flex-col">
          <AgentConversation
            messages={agent.messages}
            status={agent.status}
            error={agent.error}
            onSendMessage={agent.sendMessage}
          />
        </div>

        {/* Right panel: Workspace */}
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
            actionsEnabled={false}
            runAction={agent.runAction}
          />
        </div>
      </div>
    </div>
  )
}

export default function AsistentAIPage({
  params,
}: {
  params: { locale: string }
}) {
  return (
    <Suspense>
      <AsistentAIInner locale={params.locale} />
    </Suspense>
  )
}

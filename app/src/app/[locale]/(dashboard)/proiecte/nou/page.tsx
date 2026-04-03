'use client'

import { useTranslations } from 'next-intl'
import { useAgent } from '@/hooks/useAgent'
import { AgentConversation } from '@/components/agent/AgentConversation'
import { AgentWorkspace } from '@/components/agent/AgentWorkspace'

export default function NewProjectPage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  const t = useTranslations('projects')
  const agent = useAgent(locale as 'ro' | 'en')

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">
          {t('newProject')}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('agentDescription')}
        </p>
      </div>

      {/* Main content — conversation left, workspace right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Conversation */}
        <div className="w-1/2 border-r border-gray-200 flex flex-col">
          <AgentConversation
            messages={agent.messages}
            status={agent.status}
            error={agent.error}
            onSendMessage={agent.sendMessage}
          />
        </div>

        {/* Right panel: Workspace */}
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

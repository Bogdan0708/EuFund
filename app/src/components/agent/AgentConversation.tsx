'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentMessage, AgentStatus } from '@/hooks/useAgent'

interface Props {
  messages: AgentMessage[]
  status: AgentStatus
  error: string | null
  // Optional pre-filled input — used by /panou's hero handoff to seed the
  // chat input with the user's typed description. Pre-fill only; we do NOT
  // auto-send, the user has to click Send.
  initialInput?: string
  onSendMessage: (message: string) => void
}

export function AgentConversation({ messages, status, error, initialInput, onSendMessage }: Props) {
  const t = useTranslations('agent')
  const [input, setInput] = useState(initialInput ?? '')
  const scrollRef = useRef<HTMLDivElement>(null)
  const isBusy = status === 'streaming' || status === 'connecting'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isBusy) return
    onSendMessage(input.trim())
    setInput('')
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : msg.isToolActivity
                  ? 'bg-gray-100 text-gray-500 text-xs font-mono border border-gray-200'
                  : msg.role === 'system'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-white text-gray-900 border border-gray-200 shadow-sm'
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {isBusy && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-400 animate-pulse">
              {t('thinking')}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={isBusy ? t('waitingForResponse') : t('inputPlaceholder')}
            disabled={isBusy}
            className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('send')}
          </button>
        </div>
      </form>
    </div>
  )
}

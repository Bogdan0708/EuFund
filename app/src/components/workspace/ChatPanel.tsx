'use client'
import { useState, useRef, useEffect } from 'react'
import { GlassInput, GlassButton } from '@/components/glass'
import { MessageBubble } from './MessageBubble'
import { CheckpointInteraction } from './CheckpointInteraction'
import { Send } from 'lucide-react'

interface ChatMessage {
  id: string; role: 'user' | 'assistant'; content: string;
  eventType?: string; step?: number;
  checkpoint?: { question: string; options?: { id: string; label: string; description?: string }[]; type: 'select' | 'confirm' | 'freetext' };
}

interface ChatPanelProps {
  messages: ChatMessage[]
  onSend: (message: string) => void
  isStreaming: boolean
  status: string
}

export function ChatPanel({ messages, onSend, isStreaming, status }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return
    onSend(input.trim())
    setInput('')
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.filter(m => m.eventType !== 'step_progress').map(msg => {
          if (msg.eventType === 'step_start') return null
          if (msg.checkpoint) {
            return <CheckpointInteraction key={msg.id} checkpoint={msg.checkpoint} onRespond={onSend} disabled={isStreaming} />
          }
          if (msg.eventType === 'error') {
            return (
              <div key={msg.id} className="glass border-[var(--danger)] bg-[rgba(239,68,68,0.08)] p-3 rounded-[var(--glass-radius)] my-2">
                <p className="text-[var(--danger)] text-sm">{msg.content}</p>
              </div>
            )
          }
          return <MessageBubble key={msg.id} role={msg.role} content={msg.content} isStreaming={isStreaming && msg === messages[messages.length - 1] && msg.role === 'assistant'} />
        })}
        {status === 'connecting' && (
          <div className="flex justify-start mb-4">
            <div className="glass px-4 py-3 rounded-[var(--glass-radius)]">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-[var(--border-subtle)] p-4 flex gap-3">
        <GlassInput value={input} onChange={e => setInput(e.target.value)} placeholder="Scrie mesajul tău..." disabled={isStreaming} className="flex-1" />
        <GlassButton type="submit" disabled={isStreaming || !input.trim()}>
          <Send size={18} />
        </GlassButton>
      </form>
    </div>
  )
}

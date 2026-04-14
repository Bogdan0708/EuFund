'use client'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export function MessageBubble({ role, content, isStreaming = false }: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`
        max-w-[80%] rounded-[var(--glass-radius)] px-4 py-3
        ${isUser
          ? 'bg-[var(--accent)] text-white'
          : 'glass text-[var(--text-primary)]'
        }
      `}>
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        {isStreaming && <span className="inline-block w-1.5 h-4 bg-[var(--accent)] animate-pulse ml-1 align-middle" />}
      </div>
    </div>
  )
}

function renderMarkdown(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-[var(--bg-surface)] rounded-lg p-3 my-2 overflow-x-auto text-sm font-[var(--font-mono)]"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-[var(--bg-surface)] px-1.5 py-0.5 rounded text-sm">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

'use client'
import { ChatPanel } from './ChatPanel'
import { CanvasPanel } from './CanvasPanel'
import { StepProgressBar } from './StepProgressBar'

interface ChatMessage {
  id: string; role: 'user' | 'assistant'; content: string;
  eventType?: string; step?: number;
  checkpoint?: { question: string; options?: { id: string; label: string; description?: string }[]; type: 'select' | 'confirm' | 'freetext' };
}

interface WorkspaceLayoutProps {
  messages: ChatMessage[]
  currentStep: number
  status: string
  isStreaming: boolean
  onSend: (message: string) => void
}

export function WorkspaceLayout({ messages, currentStep, status, isStreaming, onSend }: WorkspaceLayoutProps) {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {currentStep > 0 && <StepProgressBar currentStep={currentStep} className="border-b border-outline-variant" />}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 border-r border-outline-variant">
          <ChatPanel messages={messages} onSend={onSend} isStreaming={isStreaming} status={status} />
        </div>
        <div className="hidden lg:flex w-[400px] shrink-0">
          <CanvasPanel className="w-full" />
        </div>
      </div>
    </div>
  )
}

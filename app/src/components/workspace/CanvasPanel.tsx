'use client'
import { useState } from 'react'
import { GlassChip } from '@/components/glass'

interface CanvasPanelProps {
  className?: string
}

export function CanvasPanel({ className = '' }: CanvasPanelProps) {
  const [activeTab, setActiveTab] = useState<'calls' | 'plan' | 'proposal'>('calls')

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        <GlassChip active={activeTab === 'calls'} onClick={() => setActiveTab('calls')}>Apeluri</GlassChip>
        <GlassChip active={activeTab === 'plan'} onClick={() => setActiveTab('plan')}>Plan</GlassChip>
        <GlassChip active={activeTab === 'proposal'} onClick={() => setActiveTab('proposal')}>Propunere</GlassChip>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
          {activeTab === 'calls' && 'Apelurile potrivite vor apărea aici'}
          {activeTab === 'plan' && 'Planul de acțiune va apărea aici'}
          {activeTab === 'proposal' && 'Propunerea va apărea aici'}
        </div>
      </div>
    </div>
  )
}

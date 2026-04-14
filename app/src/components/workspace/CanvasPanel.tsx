'use client'
import { useState } from 'react'
import { DsChip } from '@/components/ui/ds-chip'

interface CanvasPanelProps {
  className?: string
}

export function CanvasPanel({ className = '' }: CanvasPanelProps) {
  const [activeTab, setActiveTab] = useState<'calls' | 'plan' | 'proposal'>('calls')

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex gap-2 px-4 py-3 border-b border-outline-variant">
        <DsChip variant={activeTab === 'calls' ? 'selected' : 'default'} onClick={() => setActiveTab('calls')}>Apeluri</DsChip>
        <DsChip variant={activeTab === 'plan' ? 'selected' : 'default'} onClick={() => setActiveTab('plan')}>Plan</DsChip>
        <DsChip variant={activeTab === 'proposal' ? 'selected' : 'default'} onClick={() => setActiveTab('proposal')}>Propunere</DsChip>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-center h-full text-outline text-sm">
          {activeTab === 'calls' && 'Apelurile potrivite vor aparea aici'}
          {activeTab === 'plan' && 'Planul de actiune va aparea aici'}
          {activeTab === 'proposal' && 'Propunerea va aparea aici'}
        </div>
      </div>
    </div>
  )
}

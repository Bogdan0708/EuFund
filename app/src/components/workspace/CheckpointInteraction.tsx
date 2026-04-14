'use client'
import { useState } from 'react'
import { GlassCard, GlassButton, GlassInput } from '@/components/glass'

interface CheckpointData {
  question: string
  options?: { id: string; label: string; description?: string }[]
  type: 'select' | 'confirm' | 'freetext'
}

interface CheckpointInteractionProps {
  checkpoint: CheckpointData
  onRespond: (response: string) => void
  disabled?: boolean
}

export function CheckpointInteraction({ checkpoint, onRespond, disabled = false }: CheckpointInteractionProps) {
  const [responded, setResponded] = useState(false)
  const [freetext, setFreetext] = useState('')

  const handleRespond = (value: string) => {
    if (responded || disabled) return
    setResponded(true)
    onRespond(value)
  }

  return (
    <GlassCard hover={false} className="p-4 my-4">
      <p className="text-[var(--text-primary)] font-medium mb-3">{checkpoint.question}</p>

      {checkpoint.type === 'select' && checkpoint.options && (
        <div className="flex flex-col gap-2">
          {checkpoint.options.map(opt => (
            <GlassButton
              key={opt.id}
              variant="ghost"
              onClick={() => handleRespond(opt.label)}
              disabled={responded || disabled}
              className="justify-start text-left"
            >
              <div>
                <span>{opt.label}</span>
                {opt.description && <span className="text-xs text-[var(--text-tertiary)] ml-2">{opt.description}</span>}
              </div>
            </GlassButton>
          ))}
        </div>
      )}

      {checkpoint.type === 'confirm' && (
        <div className="flex gap-2">
          <GlassButton variant="accent" onClick={() => handleRespond('Yes')} disabled={responded || disabled}>Da / Yes</GlassButton>
          <GlassButton variant="ghost" onClick={() => handleRespond('No')} disabled={responded || disabled}>Nu / No</GlassButton>
        </div>
      )}

      {checkpoint.type === 'freetext' && (
        <form onSubmit={e => { e.preventDefault(); if (freetext.trim()) handleRespond(freetext.trim()) }} className="flex gap-2">
          <GlassInput value={freetext} onChange={e => setFreetext(e.target.value)} disabled={responded || disabled} placeholder="Scrie răspunsul..." className="flex-1" />
          <GlassButton type="submit" disabled={responded || disabled || !freetext.trim()}>Trimite</GlassButton>
        </form>
      )}
    </GlassCard>
  )
}

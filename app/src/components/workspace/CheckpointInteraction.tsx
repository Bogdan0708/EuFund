'use client'
import { useState } from 'react'
import { DsCard } from '@/components/ui/ds-card'
import { DsButton } from '@/components/ui/ds-button'
import { DsInput } from '@/components/ui/ds-input'

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
    <DsCard className="p-4 my-4">
      <p className="text-on-surface font-medium mb-3">{checkpoint.question}</p>

      {checkpoint.type === 'select' && checkpoint.options && (
        <div className="flex flex-col gap-2">
          {checkpoint.options.map(opt => (
            <DsButton
              key={opt.id}
              variant="ghost"
              size="sm"
              onClick={() => handleRespond(opt.label)}
              disabled={responded || disabled}
              className="justify-start text-left"
            >
              <div>
                <span>{opt.label}</span>
                {opt.description && <span className="text-xs text-outline ml-2">{opt.description}</span>}
              </div>
            </DsButton>
          ))}
        </div>
      )}

      {checkpoint.type === 'confirm' && (
        <div className="flex gap-2">
          <DsButton variant="primary" size="sm" onClick={() => handleRespond('Yes')} disabled={responded || disabled}>Da / Yes</DsButton>
          <DsButton variant="ghost" size="sm" onClick={() => handleRespond('No')} disabled={responded || disabled}>Nu / No</DsButton>
        </div>
      )}

      {checkpoint.type === 'freetext' && (
        <form onSubmit={e => { e.preventDefault(); if (freetext.trim()) handleRespond(freetext.trim()) }} className="flex gap-2">
          <DsInput value={freetext} onChange={e => setFreetext(e.target.value)} disabled={responded || disabled} placeholder="Scrie raspunsul..." className="flex-1" />
          <DsButton variant="primary" size="sm" type="submit" disabled={responded || disabled || !freetext.trim()}>Trimite</DsButton>
        </form>
      )}
    </DsCard>
  )
}

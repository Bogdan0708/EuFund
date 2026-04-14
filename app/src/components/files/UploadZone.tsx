'use client'
import { useTranslations } from 'next-intl'
import { GlassDropZone } from '@/components/glass'
import { Upload } from 'lucide-react'

interface UploadZoneProps {
  onUpload: (files: File[]) => void
}

export function UploadZone({ onUpload }: UploadZoneProps) {
  const t = useTranslations('files')
  return (
    <GlassDropZone onDrop={onUpload}>
      <Upload size={32} className="mx-auto text-[var(--text-tertiary)] mb-2" />
      <p className="text-[var(--text-secondary)] text-sm">{t('dropHere')}</p>
      <p className="text-[var(--text-tertiary)] text-xs mt-1">{t('supportedFormats')}</p>
    </GlassDropZone>
  )
}

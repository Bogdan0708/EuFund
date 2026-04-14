'use client'
import { useState, useCallback, type DragEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'

interface UploadZoneProps {
  onUpload: (files: File[]) => void
}

export function UploadZone({ onUpload }: UploadZoneProps) {
  const t = useTranslations('files')
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    onUpload(files)
  }, [onUpload])

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-[1rem] p-8 text-center transition-all duration-200 ${isDragging ? 'border-primary bg-primary-fixed' : 'border-outline-variant bg-surface-container'}`}
    >
      <Icon name="upload" size="lg" className="mx-auto text-outline mb-2" />
      <p className="text-on-surface-variant text-sm">{t('dropHere')}</p>
      <p className="text-outline text-xs mt-1">{t('supportedFormats')}</p>
    </div>
  )
}

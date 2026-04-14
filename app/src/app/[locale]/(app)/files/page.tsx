'use client'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { GlassSkeleton } from '@/components/glass'
import { FileCard } from '@/components/files/FileCard'
import { UploadZone } from '@/components/files/UploadZone'

interface FileItem {
  id: string
  filename: string
  mimeType: string
  size: number
  createdAt: string
}

export default function FilesPage() {
  const t = useTranslations('files')
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/files')
      .then(r => r.json())
      .then(data => {
        setFiles(data.files || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleUpload = async (newFiles: File[]) => {
    for (const file of newFiles) {
      const formData = new FormData()
      formData.append('file', file)
      try {
        const res = await fetch('/api/v1/files', { method: 'POST', body: formData })
        if (res.ok) {
          const data = await res.json()
          if (data.file) setFiles(prev => [data.file, ...prev])
        }
      } catch {
        // silently fail individual uploads
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('title')}</h1>
      <UploadZone onUpload={handleUpload} />
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <GlassSkeleton key={i} className="h-16" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <p className="text-[var(--text-tertiary)] text-center py-12">{t('noFiles')}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map(f => (
            <FileCard key={f.id} file={f} />
          ))}
        </div>
      )}
    </div>
  )
}

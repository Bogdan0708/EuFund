'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'
import { csrfFetch } from '@/lib/csrf/client'

interface UploadedDocument {
  fileId: string
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedAt: string
  docType:
    | 'ghid_solicitant' | 'bilant' | 'certificat' | 'aviz'
    | 'studiu_fezabilitate' | 'plan_afaceri' | 'deviz'
    | 'acord_parteneriat' | 'declaratie' | 'altul'
  hasText: boolean
  downloadUrl: string
}

const DOC_TYPES = [
  'ghid_solicitant', 'bilant', 'certificat', 'aviz',
  'studiu_fezabilitate', 'plan_afaceri', 'deviz',
  'acord_parteneriat', 'declaratie', 'altul',
] as const

const ACCEPT = '.pdf,.docx,.doc,.txt'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRelative(dateStr: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return rtf.format(-Math.max(minutes, 0), 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  return rtf.format(-days, 'day')
}

export function UserUploadsSection({
  projectId,
  locale,
}: {
  projectId: string
  locale: string
}) {
  // Namespace aligns with the existing documents-tab root the page already
  // uses (`useTranslations('projectDossier')` at proiecte/[id]/page.tsx:442).
  const t = useTranslations('projectDossier.userUploads')
  const tDocType = useTranslations('docType')
  const [docs, setDocs] = useState<UploadedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>('altul')
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/documents`)
      if (!res.ok) throw new Error('fetch failed')
      const body = await res.json()
      setDocs(body.data ?? [])
    } catch {
      setError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        form.append('projectId', projectId)
        form.append('docType', docType)
        const res = await csrfFetch('/api/documents/upload', {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.message ?? t('uploadError'))
        }
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('uploadError'))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleDelete(fileId: string) {
    setError(null)
    try {
      const res = await csrfFetch(`/api/documents/${fileId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(t('deleteError'))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('deleteError'))
    }
  }

  return (
    <div>
      <h3 className="text-lg font-bold mb-4">{t('title')}</h3>
      <p className="text-sm text-on-surface-variant mb-4">{t('description')}</p>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm text-on-surface-variant">{t('docTypeLabel')}</label>
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as (typeof DOC_TYPES)[number])}
          className="px-3 py-1.5 rounded-lg border border-outline-variant/30 bg-surface text-sm"
        >
          {DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>{tDocType(dt)}</option>
          ))}
        </select>
      </div>

      <label
        className={`block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          uploading ? 'opacity-60 cursor-wait' : 'hover:border-primary/60 border-outline-variant/30'
        }`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (!uploading) void handleFiles(e.dataTransfer.files)
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Icon name="cloud_upload" size="lg" className="text-primary/40 mx-auto mb-3" />
        <p className="font-bold text-on-surface mb-1">
          {uploading ? t('uploading') : t('dropzoneTitle')}
        </p>
        <p className="text-sm text-on-surface-variant">{t('dropzoneHint')}</p>
      </label>

      {error && (
        <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && docs.length > 0 && (
        <ul className="mt-6 space-y-2">
          {docs.map((d) => (
            <li
              key={d.fileId}
              className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-xl border border-outline-variant/10"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon name="description" size="sm" className="text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-on-surface truncate">{d.filename}</div>
                  <div className="text-xs text-on-surface-variant flex flex-wrap gap-x-2">
                    <span>{tDocType(d.docType)}</span>
                    <span aria-hidden>·</span>
                    <span>{formatSize(d.sizeBytes)}</span>
                    <span aria-hidden>·</span>
                    <span>{formatRelative(d.uploadedAt, locale)}</span>
                    <span aria-hidden>·</span>
                    <span>{d.hasText ? t('badgeIndexed') : t('badgeNotIndexed')}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={d.downloadUrl}
                  className="p-2 rounded-lg hover:bg-surface-container"
                  aria-label={t('download')}
                >
                  <Icon name="download" size="sm" />
                </a>
                <button
                  onClick={() => handleDelete(d.fileId)}
                  className="p-2 rounded-lg hover:bg-surface-container text-red-600"
                  aria-label={t('delete')}
                >
                  <Icon name="delete" size="sm" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && docs.length === 0 && (
        <p className="mt-6 text-sm text-on-surface-variant">{t('empty')}</p>
      )}
    </div>
  )
}

'use client'
import { GlassCard } from '@/components/glass'
import { FileText, Image, FileSpreadsheet, File } from 'lucide-react'

interface FileCardProps {
  file: {
    id: string
    filename: string
    mimeType: string
    size: number
    createdAt: string
  }
  onClick?: () => void
}

const ICON_MAP: Record<string, typeof FileText> = {
  'application/pdf': FileText,
  'image/': Image,
  'application/vnd': FileSpreadsheet,
}

function getIcon(mimeType: string) {
  for (const [key, Icon] of Object.entries(ICON_MAP)) {
    if (mimeType.startsWith(key)) return Icon
  }
  return File
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function FileCard({ file, onClick }: FileCardProps) {
  const Icon = getIcon(file.mimeType)
  return (
    <GlassCard className="p-4 flex items-center gap-3" onClick={onClick}>
      <Icon size={24} className="text-[var(--accent)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)] truncate">{file.filename}</p>
        <p className="text-xs text-[var(--text-tertiary)]">{formatSize(file.size)}</p>
      </div>
    </GlassCard>
  )
}

'use client'
import { DsCard } from '@/components/ui/ds-card'
import { Icon } from '@/components/ui/ds-icon'

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

const ICON_MAP: Record<string, string> = {
  'application/pdf': 'description',
  'image/': 'image',
  'application/vnd': 'table_chart',
}

function getIconName(mimeType: string): string {
  for (const [key, icon] of Object.entries(ICON_MAP)) {
    if (mimeType.startsWith(key)) return icon
  }
  return 'draft'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function FileCard({ file, onClick }: FileCardProps) {
  const iconName = getIconName(file.mimeType)
  return (
    <DsCard className="p-4 flex items-center gap-3 hover:shadow-lg transition-shadow cursor-pointer" onClick={onClick}>
      <Icon name={iconName} size="lg" className="text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-on-surface truncate">{file.filename}</p>
        <p className="text-xs text-outline">{formatSize(file.size)}</p>
      </div>
    </DsCard>
  )
}

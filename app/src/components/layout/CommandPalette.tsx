'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Home, FolderOpen, Search, Paperclip, Sparkles, Settings, Plus, Shield, Upload } from 'lucide-react'
import { GlassInput } from '@/components/glass'

interface CommandItem {
  id: string
  label: string
  icon: React.ReactNode
  action: () => void
  group: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('commandPalette')
  const prefix = `/${locale}`

  const navigate = useCallback((path: string) => {
    router.push(path)
    onClose()
  }, [router, onClose])

  const items: CommandItem[] = [
    { id: 'home', label: t('home'), icon: <Home size={18} />, action: () => navigate(prefix), group: t('pages') },
    { id: 'projects', label: t('projects'), icon: <FolderOpen size={18} />, action: () => navigate(`${prefix}/projects`), group: t('pages') },
    { id: 'calls', label: t('fundingCalls'), icon: <Search size={18} />, action: () => navigate(`${prefix}/calls`), group: t('pages') },
    { id: 'files', label: t('files'), icon: <Paperclip size={18} />, action: () => navigate(`${prefix}/files`), group: t('pages') },
    { id: 'ai', label: t('aiAssistant'), icon: <Sparkles size={18} />, action: () => navigate(`${prefix}/ai`), group: t('pages') },
    { id: 'settings', label: t('settings'), icon: <Settings size={18} />, action: () => navigate(`${prefix}/settings`), group: t('pages') },
    { id: 'new-project', label: t('newProject'), icon: <Plus size={18} />, action: () => navigate(`${prefix}/ai`), group: t('actions') },
    { id: 'check-eligibility', label: t('checkEligibility'), icon: <Shield size={18} />, action: () => navigate(`${prefix}/calls`), group: t('actions') },
    { id: 'upload-file', label: t('uploadFile'), icon: <Upload size={18} />, action: () => navigate(`${prefix}/files`), group: t('actions') },
  ]

  const filtered = query ? items.filter(item => item.label.toLowerCase().includes(query.toLowerCase())) : items

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => { setSelectedIndex(0) }, [query])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && filtered[selectedIndex]) { filtered[selectedIndex].action() }
    if (e.key === 'Escape') onClose()
  }, [filtered, selectedIndex, onClose])

  if (!open) return null

  const groups = [...new Set(filtered.map(i => i.group))]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass w-[560px] max-h-[400px] overflow-hidden" onKeyDown={handleKeyDown}>
        <div className="p-3 border-b border-[var(--border-subtle)]">
          <GlassInput ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} autoFocus />
        </div>
        <div className="overflow-y-auto max-h-[320px] p-2">
          {groups.map(group => (
            <div key={group}>
              <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">{group}</p>
              {filtered.filter(i => i.group === group).map(item => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <button
                    key={item.id}
                    onClick={item.action}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-[var(--btn-radius)] text-left ${globalIdx === selectedIndex ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]'}`}
                  >
                    {item.icon}
                    <span className="text-sm">{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-sm text-[var(--text-tertiary)] text-center">{t('noResults')}</p>
          )}
        </div>
      </div>
    </div>
  )
}

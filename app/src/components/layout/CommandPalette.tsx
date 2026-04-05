'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: string
  action: () => void
  group: string
  isAction?: boolean
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('commandPalette')
  const prefix = `/${locale}`

  const navigate = useCallback((path: string) => {
    router.push(path)
    onClose()
  }, [router, onClose])

  const items: CommandItem[] = [
    // Pages
    { id: 'home', label: t('home'), description: t('homeDesc'), icon: 'home', action: () => navigate(`${prefix}/panou`), group: t('pages') },
    { id: 'projects', label: t('projects'), description: t('projectsDesc'), icon: 'folder_special', action: () => navigate(`${prefix}/proiecte`), group: t('pages') },
    { id: 'calls', label: t('fundingCalls'), description: t('fundingCallsDesc'), icon: 'smart_toy', action: () => navigate(`${prefix}/asistent-ai`), group: t('pages') },
    { id: 'files', label: t('files'), description: t('filesDesc'), icon: 'description', action: () => navigate(`${prefix}/documente`), group: t('pages') },
    { id: 'ai', label: t('aiAssistant'), description: t('aiAssistantDesc'), icon: 'auto_awesome', action: () => navigate(`${prefix}/asistent-ai`), group: t('pages') },
    { id: 'settings', label: t('settings'), description: t('settingsDesc'), icon: 'settings', action: () => navigate(`${prefix}/setari`), group: t('pages') },
    // Recent Projects
    { id: 'project-1', label: t('recentProject1'), description: t('recentProject1Desc'), icon: 'rocket_launch', action: () => navigate(`${prefix}/proiecte`), group: t('recentProjects') },
    { id: 'project-2', label: t('recentProject2'), description: t('recentProject2Desc'), icon: 'wb_sunny', action: () => navigate(`${prefix}/proiecte`), group: t('recentProjects') },
    // Actions
    { id: 'new-project', label: t('newProject'), icon: 'add', action: () => navigate(`${prefix}/proiecte`), group: t('actions'), isAction: true },
    { id: 'search-calls', label: t('searchCalls'), icon: 'manage_search', action: () => navigate(`${prefix}/asistent-ai`), group: t('actions') },
    { id: 'upload-file', label: t('uploadFile'), icon: 'upload_file', action: () => navigate(`${prefix}/documente`), group: t('actions') },
    { id: 'start-chat', label: t('startChat'), icon: 'chat_bubble', action: () => navigate(`${prefix}/asistent-ai`), group: t('actions') },
  ]

  const filtered = query
    ? items.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
    : items

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => { setSelectedIndex(0) }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (!scrollContainerRef.current) return
    const selectedEl = scrollContainerRef.current.querySelector(`[data-index="${selectedIndex}"]`)
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      filtered[selectedIndex].action()
    }
    if (e.key === 'Escape') onClose()
  }, [filtered, selectedIndex, onClose])

  if (!open) return null

  const groups = [...new Set(filtered.map(i => i.group))]

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 md:pt-32 px-4">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-on-background/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative glass-card w-full max-w-[560px] rounded-[1rem] shadow-2xl border border-white/20 overflow-hidden flex flex-col ring-1 ring-black/5"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Header */}
        <div className="flex items-center px-5 py-4 gap-4 border-b border-surface-container-highest/30">
          <Icon name="search" size="lg" className="text-outline" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-lg font-medium text-on-surface placeholder:text-on-surface-variant/70"
            autoFocus
          />
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded bg-surface-container-high border border-outline-variant/20 text-xs font-semibold text-on-surface-variant tracking-widest shadow-sm">
            <span>&#8984;</span><span>K</span>
          </div>
        </div>

        {/* Scrollable Content */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto max-h-[480px] p-2 space-y-1"
        >
          {groups.map(group => {
            const groupItems = filtered.filter(i => i.group === group)
            return (
              <div key={group}>
                <div className="px-3 pt-4 pb-2">
                  <span className="text-[10px] font-bold tracking-[0.1em] text-on-surface-variant uppercase px-2">
                    {group}
                  </span>
                </div>
                {groupItems.map(item => {
                  const currentIndex = filtered.indexOf(item)
                  const isSelected = currentIndex === selectedIndex
                  const isCreateAction = item.isAction

                  return (
                    <button
                      key={item.id}
                      data-index={currentIndex}
                      onClick={item.action}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[0.75rem] transition-all duration-200 ${
                        isSelected
                          ? 'bg-surface-container-high'
                          : 'hover:bg-surface-container-high group'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                            isCreateAction
                              ? 'bg-primary/10 text-primary'
                              : isSelected
                                ? 'bg-surface-container-lowest text-primary'
                                : 'bg-surface-container-low text-outline group-hover:bg-surface-container-lowest group-hover:text-primary'
                          }`}
                        >
                          <Icon name={item.icon} size="md" />
                        </div>
                        <span
                          className={`font-medium ${
                            isCreateAction
                              ? 'text-primary font-semibold'
                              : 'text-on-surface'
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>
                      {item.description && (
                        <span
                          className={`text-xs transition-colors ${
                            isSelected
                              ? 'text-on-surface-variant'
                              : 'text-on-surface-variant group-hover:text-on-surface-variant'
                          }`}
                        >
                          {item.description}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-sm text-on-surface-variant text-center">
              {t('noResults')}
            </p>
          )}
        </div>

        {/* Footer Hints */}
        <div className="px-5 py-3 bg-surface-container-low/50 border-t border-surface-container-highest/30 flex items-center justify-between">
          <div className="flex items-center gap-4 text-[11px] font-medium text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant shadow-sm ring-1 ring-inset ring-outline-variant/30">
                &#8593;&#8595;
              </span>
              <span>{t('navigate')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant shadow-sm ring-1 ring-inset ring-outline-variant/30">
                &#8629;
              </span>
              <span>{t('open')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant shadow-sm ring-1 ring-inset ring-outline-variant/30">
                Esc
              </span>
              <span>{t('close')}</span>
            </div>
          </div>
          <div className="text-[10px] font-bold text-primary tracking-widest opacity-80">
            FONDEU
          </div>
        </div>
      </div>
    </div>
  )
}

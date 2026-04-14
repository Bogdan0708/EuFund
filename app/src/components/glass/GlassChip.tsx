'use client'

interface GlassChipProps {
  active?: boolean
  onClick?: () => void
  children: React.ReactNode
  className?: string
}

export function GlassChip({ active = false, onClick, children, className = '' }: GlassChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-full transition-all duration-[var(--transition-fast)] ${active ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]' : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'} ${className}`}
    >
      {children}
    </button>
  )
}

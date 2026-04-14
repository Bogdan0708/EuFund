'use client'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'accent'

interface GlassBadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-surface)] text-[var(--text-secondary)]',
  success: 'bg-[rgba(34,197,94,0.12)] text-[var(--success)]',
  warning: 'bg-[rgba(245,158,11,0.12)] text-[var(--warning)]',
  danger: 'bg-[rgba(239,68,68,0.12)] text-[var(--danger)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
}

export function GlassBadge({ variant = 'default', children, className = '' }: GlassBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-[var(--badge-radius)] ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  )
}

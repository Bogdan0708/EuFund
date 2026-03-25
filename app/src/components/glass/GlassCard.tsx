'use client'
import { forwardRef, type HTMLAttributes } from 'react'

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean
  accent?: boolean
  provisional?: boolean
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className = '', hover = true, accent = false, provisional = false, children, ...props }, ref) => {
    const baseClasses = 'glass transition-all'
    const hoverClasses = hover ? 'hover:border-[rgba(255,255,255,0.15)] cursor-pointer' : ''
    const accentClasses = accent ? 'border-[var(--accent)] border-opacity-50' : ''
    const provisionalClasses = provisional ? 'provisional' : ''
    return (
      <div ref={ref} className={`${baseClasses} ${hoverClasses} ${accentClasses} ${provisionalClasses} ${className}`} {...props}>
        {children}
      </div>
    )
  }
)
GlassCard.displayName = 'GlassCard'

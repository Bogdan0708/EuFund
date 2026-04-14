'use client'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'accent' | 'ghost' | 'danger'

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses: Record<ButtonVariant, string> = {
  accent: 'bg-[var(--accent)] text-white hover:brightness-110',
  ghost: 'bg-transparent border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]',
  danger: 'bg-transparent border border-[var(--danger)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.1)]',
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-[15px]',
  lg: 'px-6 py-3 text-base',
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ variant = 'accent', size = 'md', className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center font-medium rounded-[var(--btn-radius)] transition-all duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  }
)
GlassButton.displayName = 'GlassButton'

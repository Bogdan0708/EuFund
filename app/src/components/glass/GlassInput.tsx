'use client'
import { forwardRef, type InputHTMLAttributes } from 'react'

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  large?: boolean
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  ({ className = '', large = false, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full bg-[var(--bg-glass)] backdrop-blur-glass border border-[var(--border-subtle)] rounded-[var(--input-radius)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--border-focus)] transition-colors duration-[var(--transition-fast)] ${large ? 'px-6 py-4 text-lg' : 'px-4 py-2.5 text-[15px]'} ${className}`}
        {...props}
      />
    )
  }
)
GlassInput.displayName = 'GlassInput'

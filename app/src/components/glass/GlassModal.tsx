'use client'
import { useEffect, type ReactNode } from 'react'

interface GlassModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

export function GlassModal({ open, onClose, children, className = '' }: GlassModalProps) {
  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative glass max-w-lg w-full mx-4 p-6 animate-in fade-in zoom-in-95 duration-200 ${className}`}>
        {children}
      </div>
    </div>
  )
}

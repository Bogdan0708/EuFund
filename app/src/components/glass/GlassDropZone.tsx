'use client'
import { useState, useCallback, type DragEvent, type ReactNode } from 'react'

interface GlassDropZoneProps {
  onDrop: (files: File[]) => void
  accept?: string
  maxSize?: number
  children: ReactNode
  className?: string
}

export function GlassDropZone({ onDrop, children, className = '' }: GlassDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    onDrop(files)
  }, [onDrop])

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-[var(--glass-radius)] p-8 text-center transition-all duration-[var(--transition-fast)] ${isDragging ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'} ${className}`}
    >
      {children}
    </div>
  )
}

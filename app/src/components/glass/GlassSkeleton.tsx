'use client'

interface GlassSkeletonProps {
  className?: string
}

export function GlassSkeleton({ className = '' }: GlassSkeletonProps) {
  return (
    <div className={`animate-pulse bg-[var(--bg-surface)] rounded-[var(--glass-radius)] ${className}`} />
  )
}

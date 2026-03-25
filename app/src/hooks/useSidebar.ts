'use client'
import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'fondeu-sidebar-collapsed'

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') setCollapsed(true)
  }, [])

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return { collapsed, toggle }
}

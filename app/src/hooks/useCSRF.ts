'use client'
import { useState, useEffect } from 'react'

export function useCSRF() {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health', { method: 'GET', credentials: 'same-origin' })
      .then(res => {
        const csrfToken = res.headers.get('x-csrf-token')
        if (csrfToken) setToken(csrfToken)
      })
      .catch(() => {})
  }, [])

  return token
}

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { csrfFetch } from '@/lib/csrf/client'
import type {
  AgentEvent, AgentRequest, StructuredAction, UIStateSnapshot,
  Phase, Warning, SectionStatus,
} from '@/lib/ai/agent/types'

// ── Types ───────────────────────────────────────────────────────

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolName?: string
  isToolActivity?: boolean
  timestamp: number
}

export interface AgentSectionState {
  sectionKey: string
  title: string
  status: SectionStatus
  documentOrder: number
}

export type AgentStatus = 'idle' | 'connecting' | 'streaming' | 'error'

// ── Hook ────────────────────────────────────────────────────────

export function useAgent(locale: 'ro' | 'en', initialSessionId?: string) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('discovery')
  const [stateVersion, setStateVersion] = useState(0)
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [sections, setSections] = useState<AgentSectionState[]>([])
  const [blueprint, setBlueprint] = useState<unknown>(null)
  const [eligibility, setEligibility] = useState<unknown>(null)

  const abortRef = useRef<AbortController | null>(null)
  const stateVersionRef = useRef(0)
  stateVersionRef.current = stateVersion

  // ── Event handler ──────────────────────────────────────────

  const applyFinalState = useCallback((state: UIStateSnapshot) => {
    setSessionId(state.sessionId)
    setPhase(state.phase)
    setStateVersion(state.stateVersion)
    setWarnings(state.warnings)
    setSections(state.sections)
    setBlueprint(state.blueprint)
    setEligibility(state.eligibility)
  }, [])

  const handleEvent = useCallback((
    event: AgentEvent,
    currentMsgId: string | null,
    setMsgId: (id: string) => void,
  ) => {
    switch (event.type) {
      case 'text_delta': {
        const id = currentMsgId || `assistant-${Date.now()}`
        if (!currentMsgId) setMsgId(id)
        setMessages(prev => {
          const existing = prev.find(m => m.id === id)
          if (existing) {
            return prev.map(m => m.id === id ? { ...m, content: m.content + event.content } : m)
          }
          return [...prev, { id, role: 'assistant', content: event.content, timestamp: Date.now() }]
        })
        break
      }

      case 'tool_start':
        setMessages(prev => [...prev, {
          id: `tool-${event.tool}-${Date.now()}`,
          role: 'system',
          content: `Using ${event.tool}...`,
          toolName: event.tool,
          isToolActivity: true,
          timestamp: Date.now(),
        }])
        break

      case 'tool_result':
        setMessages(prev => {
          const toolMsg = [...prev].reverse().find(m => m.toolName === event.tool && m.isToolActivity)
          if (toolMsg) {
            return prev.map(m => m.id === toolMsg.id
              ? { ...m, content: `${event.tool}: ${event.success ? 'completed' : event.summary}` }
              : m
            )
          }
          return prev
        })
        break

      case 'phase_changed':
        setPhase(event.to)
        break

      case 'section_status':
        setSections(prev => {
          const idx = prev.findIndex(s => s.sectionKey === event.sectionKey)
          if (idx >= 0) {
            return prev.map((s, i) => i === idx ? { ...s, status: event.status } : s)
          }
          return [...prev, { sectionKey: event.sectionKey, title: event.sectionKey, status: event.status, documentOrder: prev.length }]
        })
        break

      case 'state_update':
        if (event.patch.phase) setPhase(event.patch.phase)
        if (event.patch.stateVersion != null) {
          setStateVersion(event.patch.stateVersion)
          stateVersionRef.current = event.patch.stateVersion
        }
        if (event.patch.warnings) setWarnings(event.patch.warnings)
        if (event.patch.sections) setSections(event.patch.sections)
        break

      case 'policy_violation':
        setMessages(prev => [...prev, {
          id: `policy-${Date.now()}`,
          role: 'system',
          content: `⚠ ${event.reason}`,
          timestamp: Date.now(),
        }])
        break

      case 'checkpoint':
        // Checkpoints are informational — no UI action needed
        break

      case 'error':
        setError(event.message)
        if (!event.retryable) setStatus('error')
        break

      case 'done':
        applyFinalState(event.finalState)
        break
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFinalState])

  // ── Send message or action ──────────────────────────────────

  const sendRequest = useCallback(async (request: Partial<AgentRequest>) => {
    // Abort any in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    setStatus('connecting')
    setError(null)

    const fullRequest: AgentRequest = {
      sessionId: sessionId ?? undefined,
      message: request.message,
      action: request.action,
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      locale,
      stateVersion: stateVersionRef.current,
    }

    // Add user message to UI immediately
    if (request.message) {
      setMessages(prev => [...prev, {
        id: `user-${Date.now()}`,
        role: 'user',
        content: request.message!,
        timestamp: Date.now(),
      }])
    }

    try {
      const response = await csrfFetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullRequest),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(errBody.error || `HTTP ${response.status}`)
      }

      setStatus('streaming')

      // Parse SSE stream
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let assistantMsgId: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6).trim()
          if (!json) continue

          try {
            const event: AgentEvent = JSON.parse(json)
            handleEvent(event, assistantMsgId, (id) => { assistantMsgId = id })
          } catch {
            // Skip malformed events
          }
        }
      }

      setStatus('idle')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      abortRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, locale, handleEvent])

  // ── Reconnect ──────────────────────────────────────────────

  const reconnect = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await csrfFetch(`/api/ai/agent/state?sessionId=${sessionId}`)
      if (res.ok) {
        const state: UIStateSnapshot = await res.json()
        applyFinalState(state)
      }
    } catch {
      // Best effort
    }
  }, [sessionId, applyFinalState])

  // ── Resume from initialSessionId ──────────────────────────────
  useEffect(() => {
    if (!initialSessionId || initialSessionId === sessionId) return

    let cancelled = false

    async function resumeSession() {
      setStatus('connecting')
      setError(null)
      // Clear prior state
      setMessages([])
      setSections([])
      setWarnings([])
      setBlueprint(null)
      setEligibility(null)
      setPhase('discovery')
      setSessionId(initialSessionId!)

      try {
        // Fetch workspace state + messages in parallel
        const [stateRes, msgsRes] = await Promise.all([
          csrfFetch(`/api/ai/agent/state?sessionId=${initialSessionId}`),
          csrfFetch(`/api/ai/agent/sessions/${initialSessionId}/messages`),
        ])

        if (cancelled) return

        if (stateRes.ok) {
          const state: UIStateSnapshot = await stateRes.json()
          applyFinalState(state)
        }

        if (msgsRes.ok) {
          const { data } = await msgsRes.json()
          const restored: AgentMessage[] = (data as Array<{
            id: string; role: string; content: string;
            toolName?: string; createdAt: string;
          }>).map((m) => ({
            id: m.id,
            role: m.role === 'tool' ? 'system' as const : m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            toolName: m.toolName || undefined,
            isToolActivity: m.role === 'tool',
            timestamp: new Date(m.createdAt).getTime(),
          }))
          if (!cancelled) setMessages(restored)
        }

        if (!cancelled) setStatus('idle')
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Failed to resume session')
        }
      }
    }

    resumeSession()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId])

  // ── Public API ──────────────────────────────────────────────

  const sendMessage = useCallback((message: string) => {
    return sendRequest({ message })
  }, [sendRequest])

  const sendAction = useCallback((action: StructuredAction) => {
    return sendRequest({ action })
  }, [sendRequest])

  return {
    // State
    messages,
    status,
    error,
    sessionId,
    phase,
    stateVersion,
    warnings,
    sections,
    blueprint,
    eligibility,
    // Actions
    sendMessage,
    sendAction,
    reconnect,
  }
}

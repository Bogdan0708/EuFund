'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { csrfFetch, bootstrapCSRFToken } from '@/lib/csrf/client';
import type { MatchedCall, ActionPlan, SectionResult, WorkflowContext } from '@/lib/ai/orchestrator/types';

// ─── Types ───────────────────────────────────────────────────────

export interface CheckpointData {
  question: string;
  options?: { id: string; label: string; description?: string }[];
  type: 'select' | 'confirm' | 'freetext';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  eventType?: string;
  step?: number;
  checkpoint?: CheckpointData;
  timestamp?: string;
}

export interface CanvasState {
  matchedCalls: MatchedCall[] | null;
  actionPlan: ActionPlan | null;
  proposalSections: SectionResult[] | null;
  activeTab: 'calls' | 'plan' | 'proposal';
}

function deriveActiveTab(step: number): 'calls' | 'plan' | 'proposal' {
  if (step >= 7) return 'proposal';
  if (step >= 6) return 'plan';
  return 'calls';
}

type SSEEvent = { eventId: number } & (
  | { type: 'step_start'; step: number; label: string }
  | { type: 'step_progress'; step: number; message: string }
  | { type: 'ai_chunk'; step: number; content: string }
  | {
      type: 'checkpoint';
      step: number;
      data: CheckpointData;
    }
  | { type: 'step_complete'; step: number; summary: string; context?: Partial<WorkflowContext> }
  | { type: 'discovery'; items: unknown[] }
  | { type: 'error'; step: number; message: string; retryable: boolean }
  | { type: 'done'; projectId?: string }
);

type Status = 'idle' | 'connecting' | 'streaming' | 'error';

// ─── Hook ────────────────────────────────────────────────────────

export function useOrchestrator(locale: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [canvasState, setCanvasState] = useState<CanvasState>({
    matchedCalls: null,
    actionPlan: null,
    proposalSections: null,
    activeTab: 'calls',
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<number>(0);
  // Buffer for accumulating ai_chunk content into a single assistant message
  const chunkBufferRef = useRef<string>('');
  const streamingMsgIdRef = useRef<string | null>(null);
  // Ref to avoid stale closure in reconnect timeout
  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;
  // Exponential backoff for SSE reconnect
  const reconnectAttemptsRef = useRef<number>(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  // ─── SSE Connection ──────────────────────────────────────────

  const connectSSE = useCallback(
    (sessionId: string) => {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setStatus('connecting');

      let url = `/api/ai/orchestrator/stream?sessionId=${encodeURIComponent(sessionId)}`;
      if (lastEventIdRef.current > 0) {
        url += `&lastEventId=${lastEventIdRef.current}`;
      }

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStatus('streaming');
        setIsStreaming(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      es.onmessage = (event) => {
        try {
          const data: SSEEvent = JSON.parse(event.data);
          lastEventIdRef.current = data.eventId;
          handleSSEEvent(data);
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        setIsStreaming(false);

        // Exponential backoff with max retries
        if (sessionId && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(2000 * 2 ** reconnectAttemptsRef.current, 30000);
          reconnectAttemptsRef.current += 1;
          setTimeout(() => {
            if (activeSessionIdRef.current === sessionId) {
              connectSSE(sessionId);
            }
          }, delay);
        } else {
          setStatus('error');
          setError('Connection lost. Please refresh to retry.');
        }
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'step_start':
        setCurrentStep(event.step);
        // Flush any chunk buffer from previous step
        flushChunkBuffer();
        // Add a step indicator message
        setMessages((prev) => [
          ...prev,
          {
            id: `step-${event.step}-${Date.now()}`,
            role: 'assistant',
            content: event.label,
            eventType: 'step_start',
            step: event.step,
          },
        ]);
        break;

      case 'step_progress':
        setCurrentStep(event.step);
        setMessages((prev) => [
          ...prev,
          {
            id: `progress-${event.step}-${Date.now()}`,
            role: 'assistant',
            content: event.message,
            eventType: 'step_progress',
            step: event.step,
          },
        ]);
        break;

      case 'ai_chunk': {
        // Accumulate chunks into a single message
        if (!streamingMsgIdRef.current) {
          streamingMsgIdRef.current = `ai-${event.step}-${Date.now()}`;
          chunkBufferRef.current = event.content;
          setMessages((prev) => [
            ...prev,
            {
              id: streamingMsgIdRef.current!,
              role: 'assistant',
              content: event.content,
              eventType: 'ai_chunk',
              step: event.step,
            },
          ]);
        } else {
          chunkBufferRef.current += event.content;
          const msgId = streamingMsgIdRef.current;
          const buffered = chunkBufferRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, content: buffered } : m,
            ),
          );
        }
        break;
      }

      case 'checkpoint':
        flushChunkBuffer();
        setMessages((prev) => [
          ...prev,
          {
            id: `checkpoint-${event.step}-${Date.now()}`,
            role: 'assistant',
            content: event.data.question,
            eventType: 'checkpoint',
            step: event.step,
            checkpoint: event.data,
          },
        ]);
        setIsStreaming(false);
        break;

      case 'step_complete':
        flushChunkBuffer();
        setMessages((prev) => [
          ...prev,
          {
            id: `complete-${event.step}-${Date.now()}`,
            role: 'assistant',
            content: event.summary,
            eventType: 'step_complete',
            step: event.step,
          },
        ]);
        // Update canvas state from context snapshot if present
        if ('context' in event && event.context) {
          const ctx = event.context as Partial<WorkflowContext>;
          setCanvasState((prev) => ({
            matchedCalls: ctx.matchedCalls ?? prev.matchedCalls,
            actionPlan: ctx.actionPlan ?? prev.actionPlan,
            proposalSections: ctx.projectSections ?? prev.proposalSections,
            activeTab: deriveActiveTab(event.step),
          }));
        } else {
          setCanvasState((prev) => ({
            ...prev,
            activeTab: deriveActiveTab(event.step),
          }));
        }
        break;

      case 'discovery':
        // Discovery events carry data but no visible message; skip for now
        break;

      case 'error':
        flushChunkBuffer();
        setError(event.message);
        setStatus('error');
        setIsStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${event.step}-${Date.now()}`,
            role: 'assistant',
            content: event.message,
            eventType: 'error',
            step: event.step,
          },
        ]);
        break;

      case 'done':
        flushChunkBuffer();
        setIsStreaming(false);
        setStatus('idle');
        // Close the SSE connection — session is complete
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        break;
    }
  }, []);

  function flushChunkBuffer() {
    chunkBufferRef.current = '';
    streamingMsgIdRef.current = null;
  }

  // ─── Load message history ──────────────────────────────────────

  const loadHistory = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(
        `/api/ai/orchestrator/messages?sessionId=${encodeURIComponent(sessionId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && Array.isArray(data.messages)) {
        const history: ChatMessage[] = data.messages.map(
          (m: { id?: string; role: string; content: string; eventType?: string; step?: number; checkpoint?: CheckpointData; createdAt?: string }, i: number) => ({
            id: m.id || `hist-${i}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            eventType: m.eventType,
            step: m.step,
            checkpoint: m.checkpoint,
            timestamp: m.createdAt,
          }),
        );
        setMessages(history);
      }
      if (data.session?.currentStep) {
        setCurrentStep(data.session.currentStep);
      }
      if (data.session?.context) {
        const ctx = data.session.context as Partial<WorkflowContext>;
        setCanvasState({
          matchedCalls: ctx.matchedCalls ?? null,
          actionPlan: ctx.actionPlan ?? null,
          proposalSections: ctx.projectSections ?? null,
          activeTab: deriveActiveTab(data.session.currentStep || 1),
        });
      }
    } catch {
      // Fail silently — user can still send new messages
    }
  }, []);

  // ─── Send message ──────────────────────────────────────────────

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;

      // Add user message to UI
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setError(null);
      setStatus('connecting');

      try {
        // Bootstrap CSRF if needed
        await bootstrapCSRFToken();

        const body: Record<string, string> = { message, locale };
        if (activeSessionId) {
          body.sessionId = activeSessionId;
        }

        const res = await csrfFetch('/api/ai/orchestrator/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const resData = await res.json();

        // If this was a new session, capture the sessionId and connect SSE
        if (resData.sessionId && resData.sessionId !== activeSessionId) {
          const newSessionId = resData.sessionId;
          setActiveSessionId(newSessionId);
          connectSSE(newSessionId);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setIsStreaming(false);
        setStatus('error');
        setError(errorMessage);
        // Remove the user message that was never processed and add error as visible chat message
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userMsg.id),
          {
            id: `error-send-${Date.now()}`,
            role: 'assistant',
            content: errorMessage,
            eventType: 'error',
            step: 0,
          },
        ]);
      }
    },
    [activeSessionId, locale, connectSSE],
  );

  // ─── Start new session ─────────────────────────────────────────

  const startNewSession = useCallback(() => {
    // Close existing SSE
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setActiveSessionId(null);
    setMessages([]);
    setCurrentStep(0);
    setStatus('idle');
    setError(null);
    setIsStreaming(false);
    lastEventIdRef.current = 0;
    flushChunkBuffer();
    setCanvasState({
      matchedCalls: null,
      actionPlan: null,
      proposalSections: null,
      activeTab: 'calls',
    });
  }, []);

  // ─── Resume session ────────────────────────────────────────────

  const resumeSession = useCallback(
    (sessionId: string) => {
      startNewSession();
      setActiveSessionId(sessionId);
      loadHistory(sessionId);
      connectSSE(sessionId);
    },
    [startNewSession, loadHistory, connectSSE],
  );

  // ─── Cleanup on unmount ────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return {
    messages,
    currentStep,
    status,
    sendMessage,
    activeSessionId,
    isStreaming,
    startNewSession,
    resumeSession,
    error,
    canvasState,
  };
}
